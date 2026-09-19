// upgrade.test.ts — D24 LOWQ re-fetch: the pure gate logic + the CLI
// contract. The download/swap itself needs yt-dlp + network; the gates
// (isLowq floor rule, dry-run shape) are what can regress silently.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { isLowq, parseFfprobeKbps, replaceFileAtomically } from "./upgrade";
import { runCli } from "../../test-support/cli-run";
import { tempDir, tempState } from "../../test-support/testutil";

describe("isLowq (the same floor rule as CrateDeck's lowqQueue)", () => {
  test("mp4a/aac below 256", () => {
    expect(isLowq({ bitrate_kbps: 128, codec: "mp4a" })).toBe(true);
    expect(isLowq({ bitrate_kbps: 256, codec: "mp4a" })).toBe(false);
    expect(isLowq({ bitrate_kbps: 130, codec: "aac" })).toBe(true);
  });
  test("mp3 floor is 320", () => {
    expect(isLowq({ bitrate_kbps: 320, codec: "mp3" })).toBe(false);
    expect(isLowq({ bitrate_kbps: 256, codec: "mp3" })).toBe(true);
  });
  test("unknown codec / null bitrate → not lowq (never guess)", () => {
    expect(isLowq({ bitrate_kbps: 64, codec: "opus" })).toBe(false);
    expect(isLowq({ bitrate_kbps: null, codec: "mp4a" })).toBe(false);
  });
  // #258: soundcloud rows floor at the PLATFORM CEILING, not the YT bar.
  test("soundcloud rows use the SC ceiling (160 aac / 128 mp3)", () => {
    expect(
      isLowq({ bitrate_kbps: 160, codec: "aac", source: "soundcloud" }),
    ).toBe(false);
    expect(
      isLowq({ bitrate_kbps: 160, codec: "mp4a", source: "soundcloud" }),
    ).toBe(false);
    expect(
      isLowq({ bitrate_kbps: 96, codec: "aac", source: "soundcloud" }),
    ).toBe(true);
    expect(
      isLowq({ bitrate_kbps: 128, codec: "mp3", source: "soundcloud" }),
    ).toBe(false);
    expect(
      isLowq({ bitrate_kbps: 96, codec: "mp3", source: "soundcloud" }),
    ).toBe(true);
    // YT rows keep the legacy floors byte-identical.
    expect(isLowq({ bitrate_kbps: 255, codec: "aac" })).toBe(true);
    expect(isLowq({ bitrate_kbps: 256, codec: "aac" })).toBe(false);
  });
});

describe("upgrade replacement", () => {
  test("malformed ffprobe JSON is reported at the file boundary", () => {
    const diagnostics: string[] = [];
    expect(
      parseFfprobeKbps("not-json", "/tmp/bad.m4a", (message) =>
        diagnostics.push(message),
      ),
    ).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toStartWith(
      "ffprobe returned malformed JSON for /tmp/bad.m4a",
    );
  });
  test("keeps the incumbent when the staged rename fails", () => {
    const t = tempDir("megadj-upgrade-swap-");
    const dir = t.dir();
    const incumbent = join(dir, "track.m4a");
    const staged = join(dir, ".track.m4a.upgrade");
    writeFileSync(incumbent, "old");
    writeFileSync(staged, "new");
    expect(() =>
      replaceFileAtomically(staged, incumbent, () => {
        throw new Error("rename failed");
      }),
    ).toThrow("rename failed");
    expect(existsSync(incumbent)).toBe(true);
    expect(Bun.file(incumbent).text()).resolves.toBe("old");
    t.dispose(dir);
  });
});

describe("upgrade CLI contract", () => {
  const t = tempDir("megadj-upgrade-test-");
  const dir = t.dir();
  // tempState owns the DB dir; the child CLI must open THAT path via
  // MEGADJ_DB, not the fixture dir (two dirs, two roles).
  const ts = tempState("megadj-upgrade-state-");
  const { dir: stateDir, state } = ts.next();
  afterAll(() => {
    state.close();
    t.dispose(dir);
    ts.done({ dir: stateDir, state });
  });

  test("--dry-run --json: lists candidates, attempts nothing, exits 0", async () => {
    state.upsertTrackFromPlaylist("lowq1", 0, "Low Quality Track", "test");
    state.markDownloaded("lowq1", {
      title: "Low Quality Track",
      artist: null,
      album: null,
      formatId: "140",
      bitrateKbps: 128,
      codec: "mp4a",
      filePath: join(dir, "lowq1.m4a"), // nonexistent file → filtered out
      fileSizeBytes: 1,
      durationS: 10,
    });
    const { code, stdout } = await runCli(["upgrade", "--dry-run", "--json"], {
      MEGADJ_DB: join(stateDir, "archive.db"),
      MEGADJ_MUSIC_DIR: dir,
      MEGADJ_COOKIES: "",
    });
    expect(code).toBe(0);
    const lines = stdout.trim().split("\n");
    const parsed = JSON.parse(lines[lines.length - 1]!) as {
      command: string;
      candidates: number;
      attempted: number;
      dryRun: boolean;
    };
    expect(parsed.command).toBe("upgrade");
    // the candidate file doesn't exist on disk → correctly excluded
    expect(parsed.candidates).toBe(0);
    expect(parsed.dryRun).toBe(true);
  });

  test("--dry-run --json counts a real below-floor file as a candidate", async () => {
    const p = join(dir, "real-lowq.m4a");
    writeFileSync(p, "not really audio but exists");
    state.upsertTrackFromPlaylist("lowq2", 0, "Real Lowq", "test");
    state.markDownloaded("lowq2", {
      title: "Real Lowq",
      artist: null,
      album: null,
      formatId: "140",
      bitrateKbps: 128,
      codec: "mp4a",
      filePath: p,
      fileSizeBytes: 30,
      durationS: 10,
    });
    const { code, stdout } = await runCli(["upgrade", "--dry-run", "--json"], {
      MEGADJ_DB: join(stateDir, "archive.db"),
      MEGADJ_MUSIC_DIR: dir,
      MEGADJ_COOKIES: "",
    });
    expect(code).toBe(0);
    const lines = stdout.trim().split("\n");
    const parsed = JSON.parse(lines[lines.length - 1]!) as {
      candidates: number;
      details: { outcome: string; detail: string }[];
    };
    expect(parsed.candidates).toBe(1);
    expect(parsed.details[0]!.detail).toContain("dry run");
  });
});
