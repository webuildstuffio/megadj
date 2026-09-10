import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ArchiveState } from "../state";
import { convertArchive } from "./convert";

/**
 * megadj convert — archive-wide wav→aiff (legacy WAVs have no art on the
 * booth and float/32-bit ones don't even load). The pass must convert,
 * keep DB paths in sync, and leave the source WAV only on failure.
 */

const DB_DIR = mkdtempSync("/tmp/megadj-convert-");
const ARCHIVE = join(DB_DIR, "DJ-Imports");

afterAll(async () => {
  await $`rm -rf ${DB_DIR}`.quiet().nothrow();
});

function makeWav(dir: string, name: string, freq = "440"): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  Bun.spawnSync([
    "ffmpeg",
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${freq}:duration=65`,
    "-c:a",
    "pcm_s16le",
    "-metadata",
    `title=${name}`,
    p,
  ]);
  return p;
}

describe("convertArchive", () => {
  test("converts wavs to aiff, removes sources, follows db paths", async () => {
    const batch = "2026-01-01 test batch";
    const wavPath = makeWav(join(ARCHIVE, batch), "Old Track.wav");
    const state = new ArchiveState(join(DB_DIR, "archive.db"));
    state.upsertTrackFromPlaylist("ext-test1", 0, "Old Track", "ingest");
    state.markDownloaded("ext-test1", {
      title: "Old Track",
      artist: null,
      album: null,
      genre: null,
      formatId: null,
      bitrateKbps: null,
      codec: "pcm_s16le",
      filePath: wavPath,
      fileSizeBytes: null,
      durationS: 65,
    });

    const report = await convertArchive({ state, musicDir: ARCHIVE });

    expect(report.total).toBe(1);
    expect(report.converted).toBe(1);
    expect(report.failed).toHaveLength(0);
    // Source WAV gone, AIFF in its place, in the SAME batch folder.
    expect(existsSync(wavPath)).toBe(false);
    const files = readdirSync(join(ARCHIVE, batch));
    expect(files).toContain("Old Track.aiff");
    // DB row now points at the AIFF.
    const rows = state.downloadedWithFiles();
    expect(rows[0]!.file_path?.endsWith(".aiff")).toBe(true);
    expect(existsSync(rows[0]!.file_path!)).toBe(true);
    state.close();
  });

  test("no wavs → zero-work summary", async () => {
    const state = new ArchiveState(join(DB_DIR, "second.db"));
    const report = await convertArchive({ state, musicDir: ARCHIVE });
    // The first test converted the only WAV.
    expect(report.total).toBe(0);
    expect(report.converted).toBe(0);
    state.close();
  });
});
