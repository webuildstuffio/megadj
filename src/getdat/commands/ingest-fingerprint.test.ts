import { describe, test, expect, afterAll } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ArchiveState } from "../../archive/state";
import { ingest } from "./ingest";
import { ffmpegTone } from "../../../src/test-support/audio-fixtures";
import { tempDir } from "../../test-support/testutil";

/**
 * Acoustic-fingerprint dedupe (name-blind): the same recording re-encoded
 * to a different container (wav→mp3 here — also changes bytes AND size,
 * so neither the identity key nor the MD5 pass can catch it) must
 * quarantine the inferior copy. Mirrors shelf-dupescan's guarantee at
 * intake time.
 */

const t = tempDir("megadj-fp-dedupe-").rippable();
const DB_DIR = t.dir();
const ARCHIVE = join(DB_DIR, "DJ-Imports");

afterAll(() => {
  t.rippleAll();
});

describe("ingest fingerprint dedupe", () => {
  test("same recording as mp3 re-encode quarantines vs the wav original", async () => {
    const dump = join(DB_DIR, "dump");
    const wav = ffmpegTone(join(dump, "Good Track [Radio Edit].wav"), {
      title: "Good Track",
    });
    // Re-encode to mp3: different container, different bytes, different
    // size, different extension — but the SAME decoded recording.
    ffmpegTone(join(dump, "good track rip.mp3"), {
      from: wav,
      codec: "libmp3lame",
      bitrate: "320k",
      title: "Good Track (rip)",
    });

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
    // The mp3 re-encode is in quarantine (archive-root dot-folder now).
    const q = readdirSync(join(ARCHIVE, ".ingest-duplicates"));
    expect(q.some((f) => f.endsWith(".mp3"))).toBe(true);
  }, 240000);
});
