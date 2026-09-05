import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchiveState } from "./state";

/** Roadmap rev 6.1 #4: the mood ledger — same contract family as the beats
 * ledger (upsert idempotent by video_id, summary aggregate, corrupt-free). */

let dir: string;
let state: ArchiveState;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megadj-mood-test-"));
  state = new ArchiveState(join(dir, "archive.db"));
});

afterEach(() => {
  state.close();
  rmSync(dir, { recursive: true, force: true });
});

function addDownloaded(s: ArchiveState, videoId: string, path: string): void {
  s.upsertTrackFromPlaylist(videoId, 1, "t");
  s.markDownloaded(videoId, {
    title: "t",
    artist: null,
    album: null,
    formatId: null,
    bitrateKbps: null,
    codec: null,
    filePath: path,
    fileSizeBytes: null,
    durationS: null,
  });
}

describe("mood ledger", () => {
  test("setMoodRecord upserts idempotently; moodRecord reads it back", () => {
    addDownloaded(state, "mood1", "/x/y.wav");
    const rec = {
      videoId: "mood1",
      dance: 0.99,
      aggressive: 0.5,
      happy: 0.3,
      electronic: 0.98,
      party: 0.9,
      valence: 4.2,
      arousal: 5.1,
      sourcePath: "/x/y.wav",
    };
    state.setMoodRecord(rec);
    state.setMoodRecord({ ...rec, dance: 0.5 }); // re-run replaces, never dupes
    const back = state.moodRecord("mood1");
    expect(back?.dance).toBe(0.5);
    expect(back?.valence).toBeCloseTo(4.2);
    expect(state.moodRecord("missing")).toBeNull();
  });

  test("moodSummary averages across records", () => {
    addDownloaded(state, "m1", "/a");
    addDownloaded(state, "m2", "/b");
    state.setMoodRecord({
      videoId: "m1",
      dance: 1,
      aggressive: 0,
      happy: 0,
      electronic: 1,
      party: 1,
      valence: 4,
      arousal: 5,
      sourcePath: "/a",
    });
    state.setMoodRecord({
      videoId: "m2",
      dance: 0,
      aggressive: 1,
      happy: 1,
      electronic: 0,
      party: 0,
      valence: 6,
      arousal: 7,
      sourcePath: "/b",
    });
    const sum = state.moodSummary();
    expect(sum.available).toBe(true);
    expect(sum.analyzed).toBe(2);
    expect(sum.avg.dance).toBe(0.5);
    expect(sum.avg.valence).toBe(5);
    expect(sum.avg.arousal).toBe(6);
  });

  test("moodSummary with no rows is zeros, not NaN", () => {
    const sum = state.moodSummary();
    expect(sum.analyzed).toBe(0);
    expect(sum.avg.dance).toBe(0);
    expect(Number.isNaN(sum.avg.valence)).toBe(false);
  });
});
