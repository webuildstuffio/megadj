// similar.test.ts — I49 "sounds like": embeddings ledger + cosine kNN.
// Covers the pure engine (cosineSimilarity/similarTracks) and the DB
// round-trip (setEmbeddingRecord → embeddingCorpus → similarTracks).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { ArchiveState, cosineSimilarity, similarTracks } from "../state";

const dir = mkdtempSync(join(tmpdir(), "megadj-similar-"));
const state = new ArchiveState(join(dir, "archive.db"));
afterAll(() => {
  state.close();
  rmSync(dir, { recursive: true, force: true });
});

function track(id: string, title: string): void {
  state.upsertTrackFromPlaylist(id, 0, title, "test");
  state.markDownloaded(id, {
    title,
    artist: null,
    album: null,
    formatId: null,
    bitrateKbps: 256,
    codec: "mp4a",
    filePath: `/tmp/${id}.m4a`,
    fileSizeBytes: 1024,
    durationS: 180,
  });
}

describe("cosineSimilarity (pure)", () => {
  test("identical vectors → 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });
  test("orthogonal vectors → 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
  test("opposite vectors → -1 (direction is real: 0-norm guard is separate)", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });
  test("zero vector → 0 (no direction, no similarity claim)", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
  test("length mismatch → 0, never throws", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe("similarTracks (pure kNN)", () => {
  const corpus = [
    { videoId: "a", title: "A", artist: "x", vec: [1, 0] },
    { videoId: "b", title: "B", artist: "x", vec: [0.9, 0.1] },
    { videoId: "c", title: "C", artist: "y", vec: [0, 1] },
    { videoId: "d", title: "D", artist: "y", vec: [-1, 0] },
  ];
  test("nearest first, query excluded, k respected", () => {
    const hits = similarTracks(corpus, "a", [1, 0], 2);
    expect(hits.map((h) => h.videoId)).toEqual(["b", "c"]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });
  test("dimension-mismatched rows are skipped, not crashed", () => {
    const weird = [
      ...corpus,
      { videoId: "z", title: "Z", artist: null, vec: [1, 2, 3, 4, 5] },
    ];
    const hits = similarTracks(weird, "a", [1, 0], 10);
    expect(hits.map((h) => h.videoId)).not.toContain("z");
  });
  test("k=0 → empty", () => {
    expect(similarTracks(corpus, "a", [1, 0], 0)).toEqual([]);
  });
});

describe("embeddings ledger round-trip", () => {
  test("set → record → corpus, corrupt row skipped", () => {
    track("t1", "One");
    track("t2", "Two");
    state.setEmbeddingRecord({
      videoId: "t1",
      vec: [1, 0, 0],
      sourcePath: "/tmp/one.mp3",
    });
    state.setEmbeddingRecord({
      videoId: "t2",
      vec: [0.99, 0.1, 0],
      sourcePath: "/tmp/two.mp3",
    });
    // idempotent re-run: replaces, not duplicates
    state.setEmbeddingRecord({
      videoId: "t1",
      vec: [1, 0, 0],
      sourcePath: "/tmp/one.mp3",
    });
    const rec = state.embeddingRecord("t1");
    expect(rec?.vec).toEqual([1, 0, 0]);
    const corpus = state.embeddingCorpus();
    expect(corpus.length).toBe(2);
    const hits = similarTracks(corpus, "t1", [1, 0, 0], 5);
    expect(hits[0]!.videoId).toBe("t2");
    expect(hits[0]!.score).toBeGreaterThan(0.99);
  });
  test("embeddingRecord on a corrupt JSON row reads as absent", () => {
    // simulate a corrupt write via raw SQL on the same underlying file
    const raw = new Database(join(dir, "archive.db"));
    raw.exec(
      `INSERT INTO embeddings (video_id, dim, vec_json, source_path, analyzed_at)
       VALUES ('bad', 3, '{not json', '/tmp/x', 'now')
       ON CONFLICT(video_id) DO UPDATE SET vec_json = excluded.vec_json`,
    );
    raw.close();
    expect(state.embeddingRecord("bad")).toBeNull();
    // and the corpus skips it too
    expect(state.embeddingCorpus().some((c) => c.videoId === "bad")).toBe(
      false,
    );
  });
  test("non-downloaded tracks stay out of the corpus", () => {
    state.upsertTrackFromPlaylist("gone", 0, "Gone", "test");
    state.setEmbeddingRecord({
      videoId: "gone",
      vec: [1, 1, 1],
      sourcePath: "/tmp/gone.mp3",
    });
    expect(state.embeddingCorpus().some((c) => c.videoId === "gone")).toBe(
      false,
    );
  });
});
