import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runCli, cliEnv } from "../test-support/cli-run";
import { tempDir, tempState } from "../test-support/testutil";
import type { ArchiveState } from "../core/state";
import { drop, missedEntry, type DropSummary } from "./drop";
import { setScSetIdsForTest } from "../getdat/soundcloud";

/**
 * K61 `megadj drop` — the one-shot pipeline. Regression guards:
 * - --json emits ONE summary object (P1) with per-stage accounting
 * - a folder with nothing new still completes all stages (idempotence)
 * - a URL failure is contained (exit 1, later stages skipped, no crash)
 * - dry-run never touches the archive DB state
 * - #277/#276: a set rip reports its misses — count on the stage detail,
 *   classified per-entry evidence on the stage + JSON epilogue
 */

const t = tempDir("megadj-drop-test-").rippable();
const st = tempState("megadj-drop-state-");
const enc = (s: string) => new TextEncoder().encode(s);
afterAll(() => t.rippleAll());

function runDrop(args: string[], env: Record<string, string>) {
  return runCli(args, env, ["drop"]);
}

function freshEnv() {
  const dir = t.dir();
  return { dir, env: cliEnv(dir) };
}

let dropState: ArchiveState;
beforeAll(() => {
  dropState = st.next().state;
});
afterAll(() => {
  dropState.close();
});

describe("megadj drop (K61 one-shot pipeline)", () => {
  test("SoundCloud acquisition link stops before processing the archive", async () => {
    const { dir, env } = freshEnv();
    const bin = join(dir, "bin");
    mkdirSync(bin);
    mkdirSync(env.MEGADJ_MUSIC_DIR);
    const marker = join(env.MEGADJ_MUSIC_DIR, "keep.mp3");
    writeFileSync(marker, "existing archive contents");
    const link = "https://example.invalid/buy-track";
    writeFileSync(
      join(bin, "yt-dlp"),
      `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ id: "12345", purchase_url: link })}'\n`,
      { mode: 0o755 },
    );
    const { code, stdout } = await runDrop(
      [
        "https://soundcloud.com/artist/track",
        "--no-fetch",
        "--no-mood",
        "--json",
      ],
      { ...env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    );
    const parsed = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as {
      ok: boolean;
      stages: { stage: string; status: string; detail?: string }[];
    };
    expect(code).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.stages[0]).toMatchObject({
      stage: "download",
      status: "skipped",
    });
    expect(parsed.stages[0]?.detail).toContain(link);
    expect(parsed.stages).toHaveLength(10);
    expect(parsed.stages.every((stage) => stage.status === "skipped")).toBe(
      true,
    );
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(readdirSync(env.MEGADJ_MUSIC_DIR)).toEqual(["keep.mp3"]);
    expect(readFileSync(marker, "utf8")).toBe("existing archive contents");
  });

  test("--json on a folder with no audio: full pipeline, every stage ok/skipped", async () => {
    const { dir, env } = freshEnv();
    const empty = join(dir, "empty-inbox");
    mkdirSync(empty);
    writeFileSync(join(empty, "readme.txt"), "not audio");
    const { code, stdout } = await runDrop([empty, "--no-mood", "--json"], {
      ...env,
      // no network in the local gate: beats stage would try beat_this
      // on zero candidates → must still complete without spawning
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as {
      command: string;
      ok: boolean;
      stages: { stage: string; status: string }[];
    };
    expect(parsed.command).toBe("drop");
    expect(parsed.ok).toBe(true);
    const byStage = Object.fromEntries(
      parsed.stages.map((s) => [s.stage, s.status]),
    );
    expect(byStage.ingest).toBe("ok");
    expect(byStage.fetch).toBe("ok");
    expect(byStage.years).toBe("ok");
    expect(byStage.beats).toBe("ok");
    expect(byStage.mood).toBe("skipped"); // --no-mood
    expect(byStage.cues).toBe("ok");
    expect(byStage.organize).toBe("ok");
    expect(byStage["tag-check"]).toBe("ok");
    expect(byStage.audit).toBe("ok");
  });

  // .timeout(30000): the URL-failure path waits for yt-dlp to exhaust DNS
  // resolution for example.invalid (~5–9s warm); bun's 5s default kills
  // the test before yt-dlp returns. The root bunfig.toml timeout raise is
  // untracked personal config, not a contract other machines (or other
  // invocation CWDs) can rely on.
  test("URL download failure: contained, exit 1, stages after download skipped", async () => {
    const { env } = freshEnv();
    const { code, stdout } = await runDrop(
      ["https://example.invalid/x", "--no-mood", "--json"],
      env,
    );
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as {
      ok: boolean;
      stages: { stage: string; status: string }[];
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.stages[0]?.stage).toBe("download");
    expect(parsed.stages[0]?.status).toBe("failed");
    expect(parsed.stages.filter((s) => s.status === "skipped").length).toBe(9);
  }, 30_000);

  test("missing target: usage error, exit 2 (bad input = zero work)", async () => {
    const { env } = freshEnv();
    const { code, stderr } = await runDrop([], env);
    expect(code).toBe(2);
    expect(stderr).toContain("drop: pass a folder or URL");
  });

  // #277/#276: the set-rip loop must carry failure evidence. Hermetic:
  // canned set ids (setScSetIdsForTest) + a PATH-stubbed yt-dlp whose
  // behavior keys off the URL's track id (ok / walled 403 / gone 404).
  test("set rip surfaces missed count + classified per-entry evidence", async () => {
    const { dir, env } = freshEnv();
    const bin = join(dir, "bin");
    mkdirSync(bin);
    mkdirSync(env.MEGADJ_MUSIC_DIR);
    const ytdlpBin = join(bin, "yt-dlp");
    // id 1 → ok; id 2 → walled (PROTECTED-CCS = permanent); id 3 → gone 404.
    writeFileSync(
      ytdlpBin,
      `#!/bin/sh
case "$*" in
  *tracks/1*) exit 0 ;;
  *tracks/2*)
    echo "ERROR: [soundcloud] a/b: This track is not available (PROTECTED-CCS)" >&2
    exit 1 ;;
  *tracks/3*)
    echo "ERROR: [soundcloud] c/d: Unable to download JSON metadata: HTTP Error 404: Not Found" >&2
    exit 1 ;;
esac
exit 1`,
      { mode: 0o755 },
    );
    const restore = setScSetIdsForTest({
      ok: true,
      trackIds: ["1", "2", "3"],
    });
    const logs: string[] = [];
    try {
      await drop({
        state: dropState,
        musicDir: env.MEGADJ_MUSIC_DIR,
        target: "https://soundcloud.com/artist/sets/demo",
        // Hermetic binary override (parity with SyncOptions.ytdlpBin) —
        // bun caches PATH lookup at process start, so a PATH prepend
        // does NOT work for in-process drop(); the option does.
        ytdlpBin,
        noFetch: true,
        noMood: true,
        json: true,
        onProgress: (m) => logs.push(m),
      });
    } finally {
      restore();
    }
    // The human surface carries one line per miss with class + tail.
    const missedLines = logs.filter((l) => l.includes("missed "));
    expect(missedLines).toHaveLength(2);
    expect(missedLines.some((l) => l.includes("(permanent)"))).toBe(true);
    expect(missedLines.some((l) => l.includes("(gone)"))).toBe(true);
  });

  // #276: the JSON epilogue must carry the misses — count in the stage
  // detail + the classified per-entry array on the download stage.
  test("set-rip summary JSON: stage detail + missedDetail on download", async () => {
    const { dir, env } = freshEnv();
    const bin = join(dir, "bin");
    mkdirSync(bin);
    mkdirSync(env.MEGADJ_MUSIC_DIR);
    const ytdlpBin = join(bin, "yt-dlp");
    writeFileSync(
      ytdlpBin,
      `#!/bin/sh
case "$*" in
  *tracks/1*) exit 0 ;;
  *tracks/2*)
    echo "ERROR: [soundcloud] a/b: This track is not available (PROTECTED-CCS)" >&2
    exit 1 ;;
  *tracks/3*) exit 0 ;;
esac
exit 1`,
      { mode: 0o755 },
    );
    // Re-run with a captured console.log (writeJson's in-process seam:
    // console.log !== native → writeJson routes through console.log).
    const restore = setScSetIdsForTest({
      ok: true,
      trackIds: ["1", "2", "3"],
    });
    const origLog = console.log;
    const captured: string[] = [];
    console.log = (line: string) => {
      captured.push(line);
    };
    try {
      await drop({
        state: dropState,
        musicDir: env.MEGADJ_MUSIC_DIR,
        target: "https://soundcloud.com/artist/sets/json-demo",
        ytdlpBin,
        noFetch: true,
        noMood: true,
        json: true,
        onProgress: () => {},
      });
    } finally {
      restore();
      console.log = origLog;
    }
    const jsonLine = captured[captured.length - 1];
    expect(jsonLine).toBeTruthy();
    const summary = JSON.parse(jsonLine!) as DropSummary;
    const dl = summary.stages.find((s) => s.stage === "download");
    expect(dl?.status).toBe("ok");
    expect(dl?.detail).toBe("2 tracks from set, 1 missed");
    expect(dl?.missedDetail).toEqual([
      {
        trackId: "2",
        class: "permanent",
        detail:
          "ERROR: [soundcloud] a/b: This track is not available (PROTECTED-CCS)",
      },
    ]);
  });

  test("missedEntry classifies the #255 classes and bounds the tail", async () => {
    const gone = missedEntry(
      "9",
      1,
      enc(
        "ERROR: [soundcloud] x/y: Unable to download JSON metadata: HTTP Error 404: Not Found",
      ),
    );
    expect(gone.class).toBe("gone");
    const walled = missedEntry(
      "8",
      1,
      enc(
        "ERROR: [soundcloud] x/y: This track is not available (PROTECTED-CCS)",
      ),
    );
    expect(walled.class).toBe("permanent");
    const retry = missedEntry("7", 1, enc("HTTP Error 500: server choked"));
    expect(retry.class).toBe("retryable");
    const silent = missedEntry("6", 1, enc(""));
    expect(silent.class).toBe("unknown");
    expect(silent.detail).toBe("yt-dlp exit 1");
    // The tail is bounded at 160 chars.
    const long = missedEntry("5", 1, enc(`x`.repeat(500)));
    expect(long.detail.length).toBeLessThanOrEqual(160);
  });
});
