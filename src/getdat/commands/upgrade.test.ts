// upgrade.test.ts — D24 LOWQ re-fetch: the pure gate logic + the CLI
// contract. The download/swap itself needs yt-dlp + network; the gates
// (isLowq floor rule, dry-run shape) are what can regress silently.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { ArchiveState } from "../../archive/state";
import { isLowq } from "./upgrade";

async function runCli(args: string[], env: Record<string, string>) {
  const proc = await $`bun run ${join(import.meta.dir, "../../cli.ts")} ${args}`
    .env({ ...process.env, ...env })
    .quiet()
    .nothrow();
  return { code: proc.exitCode, stdout: new TextDecoder().decode(proc.stdout) };
}

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
});

describe("upgrade CLI contract", () => {
  const dir = mkdtempSync("/tmp/megadj-upgrade-test-");
  const state = new ArchiveState(join(dir, "archive.db"));
  afterAll(() => {
    state.close();
    rmSync(dir, { recursive: true, force: true });
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
      MEGADJ_DB: join(dir, "archive.db"),
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
      MEGADJ_DB: join(dir, "archive.db"),
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
