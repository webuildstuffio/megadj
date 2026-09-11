/**
 * Self-match guard (Sep 10 2026 UI re-run incident): a batch folder lives
 * INSIDE musicDir, so ingesting it a second time walks files whose
 * identities are already registered with file_path pointing at those very
 * files. Phase C must treat a self-match ("existing row IS this file") as
 * "already ingested, nothing to do" — it used to fall through to the
 * quarantine branch and renamed the archive's only copy into
 * ingest-duplicates, leaving 14 DB rows pointing at missing paths.
 *
 * Regression: ingest the same in-archive folder twice; the second run must
 * change nothing on disk (no quarantines) and ingest 0 files.
 */
import { describe, test, expect, afterAll } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { ArchiveState } from "../../archive/state";
import { ingest } from "./ingest";

const DB_DIR = mkdtempSync("/tmp/megadj-selfmatch-");
const ARCHIVE = join(DB_DIR, "DJ-Imports");
// The batch folder INSIDE the archive — the UI's candidate list is exactly
// these folders, so this shape is the supported re-run path.
const BATCH = join(ARCHIVE, "2026-09-10 batch import");

afterAll(() => {
  rmSync(DB_DIR, { recursive: true, force: true });
});

/** One real AIFF per track. Distinct frequencies: the acoustic-fingerprint
 *  pass quarantines fp-equal + name-similar pairs, and two identical sines
 *  WOULD fp-collide — the fixture must not trip that (real) pass. */
let tone = 300;
function makeTrack(name: string): void {
  mkdirSync(BATCH, { recursive: true });
  tone += 140;
  Bun.spawnSync([
    "ffmpeg",
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${tone}:duration=65`,
    "-c:a",
    "pcm_s16be",
    "-metadata",
    `title=${name}`,
    "-metadata",
    `artist=Self Match ${name}`,
    join(BATCH, `${name}.aiff`),
  ]);
}

describe("ingest self-match guard (re-run of an in-archive batch)", () => {
  test("second ingest of the same batch folder changes nothing on disk", async () => {
    makeTrack("Self Match One");
    makeTrack("Self Match Two");

    const state = new ArchiveState(join(DB_DIR, "archive.db"));
    // run 1 — the intake that registers the rows (folder inside archive)
    await ingest({
      state,
      musicDir: ARCHIVE,
      folder: BATCH,
      minDuration: 10,
    });

    const quarantine = join(ARCHIVE, ".ingest-duplicates");
    expect(existsSync(quarantine)).toBe(false);
    const afterFirst = readdirSync(BATCH).filter((f) =>
      f.endsWith(".aiff"),
    ).length;
    expect(afterFirst).toBe(2);

    // run 2 — re-Process the same folder from the UI
    await ingest({
      state,
      musicDir: ARCHIVE,
      folder: BATCH,
      minDuration: 10,
    });
    // the rows must still resolve: every registered path exists on disk
    const rows = state
      .allTracks()
      .filter((t) => t.file_path?.startsWith(`${BATCH}/`));
    expect(rows.length).toBe(2);
    for (const r of rows) expect(existsSync(r.file_path as string)).toBe(true);
    state.close();

    // ...and nothing was quarantined — the archive copies must survive
    // at their registered paths (the Sep 10 incident broke 14 rows here).
    expect(existsSync(quarantine)).toBe(false);
    const onDisk = readdirSync(BATCH).filter((f) => f.endsWith(".aiff"));
    expect(onDisk.toSorted()).toEqual(
      ["Self Match One.aiff", "Self Match Two.aiff"].toSorted(),
    );
  }, 240000); // ffmpeg encode ×2 + two full ingest passes
});
