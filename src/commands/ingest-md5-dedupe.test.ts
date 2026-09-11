import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ArchiveState } from "../state";
import { ingest } from "./ingest";

/**
 * MD5 twin dedupe (Back To Friends trap, Sep 9 2026): a byte-identical
 * file under a DIFFERENT name ("Extended Mix" = copy of the Radio Edit)
 * used to pass identity dedupe (artist+title differ) and get ingested
 * twice. Same size + same MD5 must quarantine the twin.
 */

const DB_DIR = mkdtempSync("/tmp/megadj-md5-dedupe-");
const ARCHIVE = join(DB_DIR, "DJ-Imports");

afterAll(async () => {
  await $`rm -rf ${DB_DIR}`.quiet().nothrow();
});

/** Two WAVs: identical PCM, different metadata (so tags ≠ byte stream). */
function makeWavPair(dir: string): void {
  mkdirSync(dir, { recursive: true });
  // Identical PCM: encode once, then copy with a different name — ffmpeg
  // writes the title into the LIST/INFO header, so two "same command, new
  // name" files differ in bytes AND size (metadata rides in the header).
  const first = join(dir, "Track [Radio Edit].wav");
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
    "title=Track",
    first,
  ]);
  const { copyFileSync } = require("node:fs") as typeof import("node:fs");
  copyFileSync(first, join(dir, "Track [Extended Mix].wav"));
}

describe("ingest content-hash dedupe", () => {
  test("byte-identical twin under a different name quarantines", async () => {
    const dump = join(DB_DIR, "dump");
    makeWavPair(dump);

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
    mkdirSync(dump, { recursive: true });
    for (const [name, freq] of [
      ["A [Radio Edit].wav", "440"],
      ["A [Extended Mix].wav", "880"],
    ] as const) {
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
        join(dump, name),
      ]);
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
