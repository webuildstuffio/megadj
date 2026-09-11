/**
 * Upgrade replacement must reuse the existing row (Sep 11 2026).
 *
 * A quality-upgrade re-ingest of a file whose path is ALREADY registered
 * used to insert a second (path-keyed ext-id) row next to the original —
 * same file, two DB rows, the older one keeping all beats/mood/cues
 * ledger history while the new one became the visible duplicate. Five
 * such twin rows appeared after the Sep 11 full-archive re-ingest.
 *
 * Regression: ingest a batch, then re-ingest a HIGHER-QUALITY copy of the
 * same track (same archive path). The track count must stay 1 and the
 * surviving row must be the ORIGINAL (ledger history preserved).
 */
import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ArchiveState } from "../../archive/state";
import { ingest } from "./ingest";

const DB_DIR = mkdtempSync("/tmp/megadj-upgrade-row-");
const ARCHIVE = join(DB_DIR, "DJ-Imports");
const BATCH = join(ARCHIVE, "2026-09-11 intake");

afterAll(() => {
  rmSync(DB_DIR, { recursive: true, force: true });
});

/** Real AIFF via ffmpeg (probeFile must see it) with the given tone freq. */
function makeTrack(name: string, freq: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
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
    "pcm_s16be",
    "-b:a",
    "1411k",
    "-metadata",
    `title=${name}`,
    "-metadata",
    `artist=Upgrade Row ${name}`,
    join(dest, `${name}.aiff`),
  ]);
}

describe("ingest quality-upgrade row replacement", () => {
  test("upgrade of an in-archive file reuses the row (no shadow twin)", async () => {
    const state = new ArchiveState(join(DB_DIR, "archive.db"));

    // run 1 — register the original 440 Hz file
    makeTrack("Upgrade Target", "440", BATCH);
    await ingest({ state, musicDir: ARCHIVE, folder: BATCH, minDuration: 10 });
    const first = state
      .allTracks()
      .filter((t) => t.file_path?.includes("Upgrade Target"));
    expect(first.length).toBe(1);
    const originalId = first[0]!.video_id;

    // run 2 — same identity, higher quality (880 kHz tone → higher
    // qualityScore), SAME archive path (self-ingest upgrade shape)
    makeTrack("Upgrade Target", "880", BATCH);
    await ingest({ state, musicDir: ARCHIVE, folder: BATCH, minDuration: 10 });

    // The old implementation left TWO rows (the shadow carried the new
    // path-keyed ext- id); the fix keeps exactly one.
    const rows = state
      .allTracks()
      .filter((t) => t.file_path?.includes("Upgrade Target"));
    expect(rows.length).toBe(1);
    // The SURVIVING row is the original — ledger-bearing identity kept.
    expect(rows[0]!.video_id).toBe(originalId);
    expect(existsSync(rows[0]!.file_path as string)).toBe(true);
    state.close();
  }, 240000); // two ffmpeg encodes + two full ingest passes
});
