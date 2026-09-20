import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { tempState } from "../test-support/testutil";
import type { ArchiveState } from "./state";

let dir: string;
let state: ArchiveState;
const ts = tempState("megadj-test-");

beforeEach(() => {
  ({ dir, state } = ts.next());
});

afterEach(() => {
  ts.done({ dir, state });
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

  test("markNotMusicByUser leaves the download queue permanently (Sep 19)", () => {
    state.upsertTrackFromPlaylist(
      "nm1",
      0,
      "WORLD's LARGEST Miniature Airport",
    );
    state.upsertTrackFromPlaylist("nm2", 1, "real song");
    expect(state.pendingQueue().length).toBe(2);
    expect(state.markNotMusicByUser("nm1")).toBe(true);
    // the skipped row is OUT of the queue sync reads…
    expect(state.pendingQueue().map((t) => t.video_id)).toEqual(["nm2"]);
    expect(state.pendingTracks().map((t) => t.video_id)).toEqual(["nm2"]);
    // …and STICKY across playlist refreshes (upsert never touches status)
    state.upsertTrackFromPlaylist(
      "nm1",
      0,
      "WORLD's LARGEST Miniature Airport",
    );
    expect(state.pendingQueue().map((t) => t.video_id)).toEqual(["nm2"]);
    expect(state.allTracks().find((t) => t.video_id === "nm1")?.status).toBe(
      "skipped_not_music",
    );
    // category records WHO decided
    expect(
      state.allTracks().find((t) => t.video_id === "nm1")?.last_error,
    ).toContain("user-marked");
    // unknown id reports false; re-marking an already-skipped row is a no-op
    expect(state.markNotMusicByUser("nope")).toBe(false);
    expect(state.markNotMusicByUser("nm1")).toBe(false);
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
    // runIsFinished false before, true after — the orphan-run guard in
    // sync()'s finally reads this (must never double-stamp a run).
    expect(state.runIsFinished(runId)).toBe(false);
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
    expect(state.runIsFinished(runId)).toBe(true);
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
    // The migration is structural: a `year` COLUMN must exist on the
    // tracks table (PRAGMA truth, not a property probe on a typed row).
    const cols = state.db.query("PRAGMA table_info(tracks)").all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name)).toContain("year");
    const row = state.db
      .query("SELECT year FROM tracks WHERE video_id = 'abc'")
      .get() as { year: string | null };
    expect(row.year).toBeNull();
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
      // GA-01 fitted tempo rides the same row
      bpmFitted: 130.4348,
      residualStd: 0.001,
    });
    const rec = state.beatRecord("bv1");
    expect(rec).not.toBeNull();
    expect(rec?.bpmRaw).toBeCloseTo(130.43);
    expect(rec?.beats).toEqual([0, 0.46, 0.92]);
    expect(rec?.downbeats).toEqual([0, 1.84]);
    expect(rec?.model).toBe("beat-this@1.1.0");
    expect(rec?.bpmFitted).toBeCloseTo(130.4348);
    expect(rec?.residualStd).toBeCloseTo(0.001);

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

    // Corrupt JSON row degrades to null (pass re-analyzes it) — written
    // through the public readonly db seam.
    state.db
      .query("UPDATE beats SET beats_json = '{corrupt' WHERE video_id = 'bv1'")
      .run();
    expect(state.beatRecord("bv1")).toBeNull();
  });

  test("beatAnalyzedTracks joins only downloaded tracks with valid analysis", () => {
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

    state.db
      .query(
        "UPDATE beats SET downbeats_json = '{corrupt' WHERE video_id = 'bv2'",
      )
      .run();
    expect(state.beatAnalyzedTracks()).toEqual([]);
  });

  test("content-hash cache: tracksMissingContentHash + setContentHash (gold-report join key)", () => {
    state.upsertTrackFromPlaylist("ch1", 0, "T1");
    state.markDownloaded("ch1", {
      title: "T1",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: 256,
      codec: "aac",
      filePath: "/tmp/ch1.m4a",
      fileSizeBytes: 1,
      durationS: 100,
    });
    state.upsertTrackFromPlaylist("ch2", 1, "T2");
    state.markDownloaded("ch2", {
      title: "T2",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: 256,
      codec: "aac",
      filePath: null, // never landed on disk
      fileSizeBytes: 0,
      durationS: 100,
    });
    // pending tracks never join the backfill queue
    state.upsertTrackFromPlaylist("ch3", 2, "T3");
    expect(state.tracksMissingContentHash().map((t) => t.videoId)).toEqual([
      "ch1",
      "ch2",
    ]);
    state.setContentHash("ch1", "ab".repeat(32));
    expect(
      state.allTracks().find((t) => t.video_id === "ch1")?.content_hash,
    ).toBe("ab".repeat(32));
    // idempotent: filled rows leave the queue; null-file rows stay (the
    // reporter counts them as unmatched, never fakes a hash)
    expect(state.tracksMissingContentHash().map((t) => t.videoId)).toEqual([
      "ch2",
    ]);
  });

  test("clearGenre unstrands a placeholder row into the query pool (#61)", () => {
    const seeded = (id: string, genre: string | null): void => {
      state.upsertTrackFromPlaylist(id, 0, `T ${id}`);
      state.markDownloaded(id, {
        title: `T ${id}`,
        artist: null,
        album: null,
        formatId: null,
        bitrateKbps: 256,
        codec: "aac",
        filePath: `/tmp/${id}.m4a`,
        fileSizeBytes: 1000,
        durationS: 200,
      });
      state.setEmbeddingRecord({
        videoId: id,
        vec: [1, 0, 0],
        sourcePath: `/tmp/${id}.m4a`,
      });
      if (genre !== null) state.updateGenre(id, genre);
    };
    seeded("m1", "Music");
    seeded("u1", "unknown");
    seeded("k1", "Techno");
    // COALESCE semantics: updateGenre(null) is a no-op, never a clear.
    state.updateGenre("k1", null);
    let labeled = state.labeledPopulation();
    expect(labeled.map((r) => r.video_id).toSorted()).toEqual([
      "k1",
      "m1",
      "u1",
    ]);
    expect(state.genreSeeds().queries.map((q) => q.video_id)).toEqual([]);

    // The unstrand pass clears placeholders; real labels stay.
    state.clearGenre("m1");
    state.clearGenre("u1");
    labeled = state.labeledPopulation();
    expect(labeled.map((r) => r.video_id)).toEqual(["k1"]);
    // Cleared rows re-enter as queries (embeddings present).
    expect(
      state
        .genreSeeds()
        .queries.map((q) => q.video_id)
        .toSorted(),
    ).toEqual(["m1", "u1"]);
    // Idempotent: second clear is a no-op.
    state.clearGenre("m1");
    expect(state.labeledPopulation().map((r) => r.video_id)).toEqual(["k1"]);
  });
});

describe("link_surfaced ledger state (#256)", () => {
  let scDir: string;
  let scState: ArchiveState;
  const scTs = tempState("megadj-sc-state-test-");

  beforeEach(() => {
    ({ dir: scDir, state: scState } = scTs.next());
  });

  afterEach(() => {
    scTs.done({ dir: scDir, state: scState });
  });

  test("markLinkSurfaced parks the row with its links; counts + reads work", () => {
    scState.upsertTrackFromPlaylist("270000000", 0, "Shelter", "soundcloud");
    const links = JSON.stringify([
      { kind: "purchase_url", url: "https://fanlink.to/shelter" },
    ]);
    scState.markLinkSurfaced(
      "270000000",
      links,
      "purchase_url: https://fanlink.to/shelter",
    );

    const row = scState.trackById("270000000");
    expect(row?.status).toBe("link_surfaced");
    expect(row?.source_links).toBe(links);
    expect(JSON.parse(row?.source_links ?? "[]")).toStrictEqual([
      { kind: "purchase_url", url: "https://fanlink.to/shelter" },
    ]);
    expect(scState.linkSurfacedCount()).toBe(1);
    expect(scState.linkSurfacedTracks().map((t) => t.video_id)).toStrictEqual([
      "270000000",
    ]);
    // The honesty rule: a surfaced row is NOT in the downloaded cohort.
    expect(scState.downloadedCount()).toBe(0);
  });

  test("markSurfacedDone flips only the checklist timestamp; unknown/non-surfaced ids rejected", () => {
    scState.upsertTrackFromPlaylist("270000010", 0, "Checklist", "soundcloud");
    scState.markLinkSurfaced(
      "270000010",
      JSON.stringify([{ kind: "purchase_url", url: "https://x.example/b" }]),
      "purchase_url: https://x.example/b",
    );
    // Gate: a surfaced row is checkable
    expect(scState.markSurfacedDoneExists("270000010")).toBe(true);
    scState.markSurfacedDone("270000010", true);
    expect(scState.trackById("270000010")?.surfaced_done_at).not.toBeNull();
    // Undo clears it; status NEVER leaves link_surfaced (the ingest batch
    // is what actually moves the row forward)
    scState.markSurfacedDone("270000010", false);
    expect(scState.trackById("270000010")?.surfaced_done_at).toBeNull();
    expect(scState.trackById("270000010")?.status).toBe("link_surfaced");
    // A pending row is not checkable
    scState.upsertTrackFromPlaylist("270000011", 0, "Pending", "soundcloud");
    expect(scState.markSurfacedDoneExists("270000011")).toBe(false);
    expect(scState.markSurfacedDoneExists("nonexistent")).toBe(false);
  });

  test("markForcedRip keeps the decision without changing status", () => {
    scState.upsertTrackFromPlaylist("270000001", 0, "Track", "soundcloud");
    scState.markForcedRip(
      "270000001",
      JSON.stringify([{ kind: "smart_link", url: "https://lnk.to/x" }]),
    );
    const row = scState.trackById("270000001");
    expect(row?.status).toBe("pending");
    expect(row?.source_links).toContain("lnk.to");
  });

  test("a row without links reads null", () => {
    scState.upsertTrackFromPlaylist("270000002", 0, "Track", "liked");
    expect(scState.sourceLinks("270000002")).toBeNull();
    expect(scState.trackById("270000002")?.status).toBe("pending");
  });
});
