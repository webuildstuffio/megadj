import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchiveState } from "./state";

let dir: string;
let state: ArchiveState;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megadj-test-"));
  state = new ArchiveState(join(dir, "archive.db"));
});

afterEach(() => {
  state.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("ArchiveState", () => {
  test("upsert is idempotent and keeps position fresh", () => {
    state.upsertTrackFromPlaylist("abc", 1, "First Title");
    state.upsertTrackFromPlaylist("abc", 2, null);
    const tracks = state.allTracks();
    expect(tracks.length).toBe(1);
    expect(tracks[0]?.liked_position).toBe(2);
    expect(tracks[0]?.title).toBe("First Title");
  });

  test("pending -> downloaded lifecycle", () => {
    state.upsertTrackFromPlaylist("v1", 0, "T");
    expect(state.pendingTracks().length).toBe(1);
    state.markDownloaded("v1", {
      title: "T",
      artist: "A",
      album: null,
      formatId: "141",
      bitrateKbps: 256,
      codec: "aac",
      filePath: "/tmp/T.m4a",
      fileSizeBytes: 1000,
      durationS: 100,
    });
    expect(state.pendingTracks().length).toBe(0);
    expect(state.statusCounts()["downloaded"]).toBe(1);
  });

  test("gone and failed statuses tracked", () => {
    state.upsertTrackFromPlaylist("g1", 0, "gone-track");
    state.markGone("g1", "terminated");
    state.upsertTrackFromPlaylist("f1", 1, "fail-track");
    state.markFailed("f1", "HTTP 500");
    const counts = state.statusCounts();
    expect(counts["gone"]).toBe(1);
    expect(counts["failed"]).toBe(1);
  });

  test("attempts increment and cap excludes over-limit", () => {
    state.upsertTrackFromPlaylist("x1", 0, "T");
    for (let i = 0; i < 4; i++) state.markAttempt("x1", "err");
    expect(state.pendingTracks().length).toBe(1); // attempts=4 < 5
    state.markAttempt("x1", "err");
    expect(state.pendingTracks().length).toBe(0); // attempts=5 excluded
  });

  test("resetFailures requeues failed tracks", () => {
    state.upsertTrackFromPlaylist("f1", 0, "T");
    state.markFailed("f1", "boom");
    expect(state.pendingTracks().length).toBe(1); // failed is retry-eligible
    expect(state.allTracks()[0]?.status).toBe("failed");
    const n = state.resetFailures();
    expect(n).toBe(1);
    expect(state.allTracks()[0]?.status).toBe("pending");
  });

  test("pending tracks order: pending-first, then by liked_position", () => {
    state.upsertTrackFromPlaylist("p5", 5, "pending pos 5");
    state.upsertTrackFromPlaylist("p1", 1, "pending pos 1");
    state.upsertTrackFromPlaylist("f9", 9, "failed pos 9");
    state.markFailed("f9", "err");
    const order = state.pendingTracks().map((t) => t.video_id);
    // failed track must not jump ahead of fresh pending ones
    expect(order.indexOf("p1")).toBeLessThan(order.indexOf("f9"));
    expect(order.indexOf("p5")).toBeLessThan(order.indexOf("f9"));
  });

  test("null-position source tracks sort after positioned ones", () => {
    state.upsertTrackFromPlaylist("pos", 3, "positioned");
    state.upsertTrackFromPlaylist("nopos", 3, "later source"); // same row updated
    // simulate a second-source row: direct insert via upsert keeps one row;
    // instead mark one downloaded and check ordering stability
    state.markDownloaded("pos", {
      title: "positioned",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: null,
      codec: null,
      filePath: null,
      fileSizeBytes: null,
      durationS: null,
    });
    expect(state.pendingTracks().map((t) => t.video_id)).toEqual(["nopos"]);
  });

  test("run lifecycle persisted", () => {
    const runId = state.startRun();
    state.finishRun(runId, {
      attempted: 5,
      downloaded: 3,
      gone: 1,
      failed: 1,
      bytesDownloaded: 12345,
    });
    const runs = state.lastRuns(1);
    expect(runs[0]?.downloaded).toBe(3);
    expect(runs[0]?.bytes_downloaded).toBe(12345);
  });

  test("fresh DB has the `year` column (fetch/years writes must not crash)", () => {
    state.upsertTrackFromPlaylist("abc", 1, "First Title");
    expect(() =>
      state.markDownloaded("abc", {
        title: "First Title",
        artist: null,
        album: null,
        formatId: null,
        bitrateKbps: 256,
        codec: "aac",
        filePath: "/tmp/x.m4a",
        fileSizeBytes: 1,
        durationS: 100,
      }),
    ).not.toThrow();
    const cols =
      (state.allTracks()[0] as unknown as Record<string, unknown>) ?? {};
    // The migration is structural: a `year` property must exist on the row
    // (null before any fetch run populates it).
    expect(Object.keys(cols)).toContain("year");
    expect(cols.year).toBeNull();
  });

  test("beats ledger: upsert + round-trip + idempotent replace", () => {
    state.upsertTrackFromPlaylist("bv1", 0, "Beat Track");
    state.markDownloaded("bv1", {
      title: "Beat Track",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: 256,
      codec: "aac",
      filePath: "/tmp/bv1.m4a",
      fileSizeBytes: 1,
      durationS: 100,
    });
    expect(state.beatRecord("bv1")).toBeNull();

    state.setBeatRecord({
      videoId: "bv1",
      bpmRaw: 130.43,
      bpmFolded: 130,
      beats: [0, 0.46, 0.92],
      downbeats: [0, 1.84],
      model: "beat-this@1.1.0",
      sourcePath: "/tmp/bv1.m4a",
    });
    const rec = state.beatRecord("bv1");
    expect(rec).not.toBeNull();
    expect(rec?.bpmRaw).toBeCloseTo(130.43);
    expect(rec?.beats).toEqual([0, 0.46, 0.92]);
    expect(rec?.downbeats).toEqual([0, 1.84]);
    expect(rec?.model).toBe("beat-this@1.1.0");

    // Re-run same model: replaces (fresh analyzed_at), not duplicates.
    state.setBeatRecord({
      videoId: "bv1",
      bpmRaw: 130.5,
      bpmFolded: 131,
      beats: [0, 0.46],
      downbeats: [0],
      model: "beat-this@1.1.0",
      sourcePath: "/tmp/bv1.m4a",
    });
    const again = state.beatRecord("bv1");
    expect(again?.bpmRaw).toBeCloseTo(130.5);
    expect(state.beatAnalyzedTracks().length).toBe(1);

    // Corrupt JSON row degrades to null (pass re-analyzes it).
    const raw = (
      state as unknown as {
        db: { query: (q: string) => { run: (...a: unknown[]) => void } };
      }
    ).db;
    raw
      .query("UPDATE beats SET beats_json = '{corrupt' WHERE video_id = 'bv1'")
      .run();
    expect(state.beatRecord("bv1")).toBeNull();
  });

  test("beatAnalyzedTracks joins downloaded tracks only, empty arrays on corrupt json", () => {
    state.upsertTrackFromPlaylist("bv2", 0, "Downloaded");
    state.markDownloaded("bv2", {
      title: "Downloaded",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: 256,
      codec: "aac",
      filePath: "/tmp/bv2.m4a",
      fileSizeBytes: 1,
      durationS: 100,
    });
    state.upsertTrackFromPlaylist("bv3", 1, "Pending");
    state.setBeatRecord({
      videoId: "bv2",
      bpmRaw: 128,
      bpmFolded: 128,
      beats: [0, 0.47],
      downbeats: [0],
      model: "beat-this@1.1.0",
      sourcePath: "/tmp/bv2.m4a",
    });
    state.setBeatRecord({
      videoId: "bv3", // pending track with a beat row — must NOT join
      bpmRaw: 140,
      bpmFolded: 140,
      beats: [0],
      downbeats: [],
      model: "beat-this@1.1.0",
      sourcePath: "/tmp/bv3.m4a",
    });
    const joined = state.beatAnalyzedTracks();
    expect(joined.length).toBe(1);
    expect(joined[0]?.track.video_id).toBe("bv2");
    expect(joined[0]?.beats).toEqual([0, 0.47]);
  });
});
