import { describe, test, expect, afterAll } from "bun:test";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ArchiveState } from "../../archive/state";
import { ingest } from "./ingest";
import { byteTwinPair, ffmpegTone } from "../../test-support/audio-fixtures";
import { tempDir } from "../../test-support/testutil";

/**
 * MD5 twin dedupe (Back To Friends trap, Sep 9 2026): a byte-identical
 * file under a DIFFERENT name ("Extended Mix" = copy of the Radio Edit)
 * used to pass identity dedupe (artist+title differ) and get ingested
 * twice. Same size + same MD5 must quarantine the twin.
 */

const t = tempDir("megadj-md5-dedupe-").rippable();
const DB_DIR = t.dir();
const ARCHIVE = join(DB_DIR, "DJ-Imports");

afterAll(() => {
  t.rippleAll();
});

describe("ingest content-hash dedupe", () => {
  test("byte-identical twin under a different name quarantines", async () => {
    const dump = join(DB_DIR, "dump");
    byteTwinPair(dump, ["Track [Radio Edit].wav", "Track [Extended Mix].wav"], {
      title: "Track",
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
      .map((e) => e.name);
    expect(batch.length).toBe(1);
    const files = readdirSync(join(ARCHIVE, batch[0]!)).filter((f) =>
      f.endsWith(".aiff"),
    );
    // Exactly ONE of the twins survived in the batch folder.
    expect(files.length).toBe(1);
    // The twin was dropped in the dedupe phase — quarantined as-is (a WAV),
    // never converted/ingested.
    const quarantine = join(ARCHIVE, ".ingest-duplicates");
    expect(existsSync(quarantine)).toBe(true);
    const quarantined = readdirSync(quarantine);
    expect(quarantined.length).toBe(1);
    expect(quarantined[0]).toMatch(/\.wav$/i);
  }, 240000); // ffmpeg encode + fpcalc ingest — 5s default dies under load

  test("same size but DIFFERENT content keeps both (size is not a dupe)", async () => {
    const dump = join(DB_DIR, "diff dump");
    for (const [name, freq] of [
      ["A [Radio Edit].wav", 440],
      ["A [Extended Mix].wav", 880],
    ] as const) {
      ffmpegTone(join(dump, name), { freq, title: name });
    }
    const state = new ArchiveState(join(DB_DIR, "archive.db"));
    await ingest({
      state,
      musicDir: ARCHIVE,
      folder: dump,
      minDuration: 10,
    });
    state.close();
    const batch = readdirSync(ARCHIVE, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.includes("diff dump"))
      .map((e) => e.name)[0]!;
    // Both survive — different audio, same size must keep both.
    const files = readdirSync(join(ARCHIVE, batch)).filter((f) =>
      f.endsWith(".aiff"),
    );
    expect(files.length).toBe(2);
  }, 240000);
});
