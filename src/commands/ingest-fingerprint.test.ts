import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ArchiveState } from "../state";
import { ingest } from "./ingest";

/**
 * Acoustic-fingerprint dedupe (name-blind): the same recording re-encoded
 * to a different container (wav→mp3 here — also changes bytes AND size,
 * so neither the identity key nor the MD5 pass can catch it) must
 * quarantine the inferior copy. Mirrors shelf-dupescan's guarantee at
 * intake time.
 */

const DB_DIR = mkdtempSync("/tmp/megadj-fp-dedupe-");
const ARCHIVE = join(DB_DIR, "DJ-Imports");

afterAll(async () => {
  await $`rm -rf ${DB_DIR}`.quiet().nothrow();
});

describe("ingest fingerprint dedupe", () => {
  test("same recording as mp3 re-encode quarantines vs the wav original", async () => {
    const dump = join(DB_DIR, "dump");
    mkdirSync(dump, { recursive: true });
    const wav = join(dump, "Good Track [Radio Edit].wav");
    Bun.spawnSync([
      "ffmpeg",
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=65",
      "-c:a",
      "pcm_s16le",
      "-metadata",
      "title=Good Track",
      wav,
    ]);
    // Re-encode to mp3: different container, different bytes, different
    // size, different extension — but the SAME decoded recording.
    Bun.spawnSync([
      "ffmpeg",
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      wav,
      "-c:a",
      "libmp3lame",
      "-b:a",
      "320k",
      "-metadata",
      "title=Good Track (rip)",
      join(dump, "good track rip.mp3"),
    ]);

    const state = new ArchiveState(join(DB_DIR, "archive.db"));
    await ingest({
      state,
      musicDir: ARCHIVE,
      folder: dump,
      minDuration: 10,
    });
    state.close();

    const batch = readdirSync(ARCHIVE, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)[0]!;
    const kept = readdirSync(join(ARCHIVE, batch));
    // Exactly one survivor in the archive — the lossless one (higher
    // quality score), whichever extension it kept.
    const audio = kept.filter((f) => /\.(aiff|mp3)$/i.test(f));
    expect(audio.length).toBe(1);
    expect(audio[0]).toMatch(/\.aiff$/i); // lossless wins the score race
    // The mp3 re-encode is in quarantine.
    const q = readdirSync(join(dump, "ingest-duplicates"));
    expect(q.some((f) => f.endsWith(".mp3"))).toBe(true);
  }, 240000);
});
