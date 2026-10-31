// similar.test.ts — I49 "sounds like": embeddings ledger + cosine kNN.
// Covers the pure engine (cosineSimilarity/similarTracks) and the DB
// round-trip (setEmbeddingRecord → embeddingCorpus → similarTracks).
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { stateIn, tempDir, tempState } from "../../test-support/testutil";
import { cosineSimilarity, similarTracks } from "../../core/state";
import {
  ensureVecF32Schema,
  parseEmbeddingVector,
  VEC_F32_USER_VERSION,
} from "../../core/similar-storage";

const ts = tempState("megadj-similar-");
const { dir, state } = ts.next();
afterAll(() => {
  ts.done({ dir, state });
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
    const weird = [...corpus, { videoId: "z", title: "Z", artist: null, vec: [1, 2, 3, 4, 5] }];
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
      model: "effnet-test",
    });
    state.setEmbeddingRecord({
      videoId: "t2",
      vec: [0.99, 0.1, 0],
      sourcePath: "/tmp/two.mp3",
      model: "effnet-test",
    });
    // idempotent re-run: replaces, not duplicates
    state.setEmbeddingRecord({
      videoId: "t1",
      vec: [1, 0, 0],
      sourcePath: "/tmp/one.mp3",
      model: "effnet-test",
    });
    const rec = state.embeddingRecord("t1");
    expect(rec?.vec).toEqual([1, 0, 0]);
    expect(rec?.model).toBe("effnet-test");
    const corpus = state.embeddingCorpus();
    expect(corpus.length).toBe(2);
    const hits = similarTracks(corpus, "t1", [1, 0, 0], 5);
    expect(hits[0]!.videoId).toBe("t2");
    expect(hits[0]!.score).toBeGreaterThan(0.99);
  });
  test("embeddingRecord on a corrupt vec_f32 blob reads as absent", () => {
    // simulate a corrupt write via raw SQL on the same underlying file
    const raw = new Database(join(dir, "archive.db"));
    raw.exec(
      `INSERT INTO embeddings (video_id, dim, vec_json, vec_f32, source_path, analyzed_at)
       VALUES ('bad', 3, '{not json', X'00', '/tmp/x', 'now')
       ON CONFLICT(video_id) DO UPDATE SET vec_f32 = excluded.vec_f32`,
    );
    raw.close();
    expect(state.embeddingRecord("bad")).toBeNull();
    // and the corpus skips it too
    expect(state.embeddingCorpus().some((c) => c.videoId === "bad")).toBe(false);
  });
  test("structurally invalid vectors are rejected with the row id", () => {
    track("bad-shape", "Bad shape");
    const raw = new Database(join(dir, "archive.db"));
    // two little-endian float32 NaNs: readable blob, non-finite payload
    raw.exec(
      `INSERT INTO embeddings (video_id, dim, vec_json, vec_f32, source_path, analyzed_at)
       VALUES ('bad-shape', 2, '[1,"oops",3]', X'0000C07F0000C07F', '/tmp/x', 'now')
       ON CONFLICT(video_id) DO UPDATE SET vec_f32 = excluded.vec_f32`,
    );
    raw.close();
    const diagnostics: string[] = [];
    const previous = console.error;
    console.error = (...args: unknown[]) => diagnostics.push(args.join(" "));
    try {
      expect(state.embeddingRecord("bad-shape")).toBeNull();
      expect(state.embeddingCorpus().some((c) => c.videoId === "bad-shape")).toBe(false);
    } finally {
      console.error = previous;
    }
    expect(diagnostics.some((line) => line.includes("bad-shape"))).toBe(true);
    expect(diagnostics.some((line) => line.includes("finite numbers"))).toBe(true);
  });
  test("schema migration backfills vec_f32 from legacy vec_json rows (#562)", () => {
    const legacy = tempDir("megadj-similar-legacy-");
    const legacyDir = legacy.dir();
    // old-schema DB: embeddings predates vec_f32 — one analyzable row,
    // one poison row (its blob must stay NULL and read as absent)
    const raw = new Database(join(legacyDir, "archive.db"));
    raw.exec(`CREATE TABLE embeddings (
      video_id TEXT PRIMARY KEY, dim INTEGER NOT NULL,
      vec_json TEXT NOT NULL, source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL)`);
    raw.exec(`INSERT INTO embeddings VALUES ('legacy', 2, '[3,4]', '/tmp/l', 'now')`);
    raw.exec(`INSERT INTO embeddings VALUES ('poison', 2, '[1,"x"]', '/tmp/l', 'now')`);
    raw.close();
    const legacyState = stateIn(legacyDir);
    try {
      expect(legacyState.embeddingRecord("legacy")?.vec).toEqual([3, 4]);
      // vec_json stays populated — the debugging tools still read it
      const kept = new Database(join(legacyDir, "archive.db"), { readonly: true })
        .query("SELECT vec_json FROM embeddings WHERE video_id = 'legacy'")
        .get() as { vec_json: string };
      expect(JSON.parse(kept.vec_json)).toEqual([3, 4]);
      expect(legacyState.embeddingRecord("poison")).toBeNull();
    } finally {
      legacyState.close();
      legacy.dispose(legacyDir);
    }
  });
  test("ensureVecF32Schema migrates a legacy DB without ArchiveState (standalone-reader path)", () => {
    // the section bench opens the archive read-only and never builds an
    // ArchiveState — it runs the migration seam itself on a writable handle
    const legacy = tempDir("megadj-similar-benchmig-");
    const legacyDir = legacy.dir();
    try {
      const raw = new Database(join(legacyDir, "archive.db"));
      raw.exec(`CREATE TABLE embeddings (
        video_id TEXT PRIMARY KEY, dim INTEGER NOT NULL,
        vec_json TEXT NOT NULL, source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL)`);
      raw.exec(`INSERT INTO embeddings VALUES ('legacy', 2, '[5,6]', '/tmp/l', 'now')`);
      ensureVecF32Schema(raw);
      const row = raw.query("SELECT vec_f32 FROM embeddings WHERE video_id = 'legacy'").get() as {
        vec_f32: Uint8Array | null;
      };
      expect(parseEmbeddingVector(row.vec_f32, "legacy")).toEqual([5, 6]);
      raw.close();
    } finally {
      legacy.dispose(legacyDir);
    }
  });
  test("ensureVecF32Schema gates the backfill on user_version — at most once per DB", () => {
    // the backfill SELECT is an unindexable full walk of both embedding
    // tables; after the marker is written, later opens must skip it
    const legacy = tempDir("megadj-similar-migrate-once-");
    const legacyDir = legacy.dir();
    try {
      const raw = new Database(join(legacyDir, "archive.db"));
      raw.exec(`CREATE TABLE embeddings (
        video_id TEXT PRIMARY KEY, dim INTEGER NOT NULL,
        vec_json TEXT NOT NULL, source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL)`);
      raw.exec(`INSERT INTO embeddings VALUES ('legacy', 2, '[7,8]', '/tmp/l', 'now')`);
      ensureVecF32Schema(raw);
      expect(
        (raw.query("PRAGMA user_version").get() as { user_version: number }).user_version,
      ).toBe(VEC_F32_USER_VERSION);
      // a json-only row appearing AFTER the marker is not re-scanned —
      // every in-repo writer embeds the blob (the python section cache
      // tool stores vec_f32 too), so only a marker bump re-runs the scan
      raw.exec(
        `INSERT INTO embeddings (video_id, dim, vec_json, source_path, analyzed_at)
         VALUES ('late', 2, '[9,10]', '/tmp/l', 'now')`,
      );
      ensureVecF32Schema(raw);
      const late = raw.query("SELECT vec_f32 FROM embeddings WHERE video_id = 'late'").get() as {
        vec_f32: Uint8Array | null;
      };
      expect(late.vec_f32).toBeNull();
      raw.close();
    } finally {
      legacy.dispose(legacyDir);
    }
  });
  test("a DB below the current marker re-runs the backfill (v2 repair pass)", () => {
    // the python section cache tool used to INSERT OR REPLACE rows without
    // vec_f32 (also erasing backfilled blobs); the marker bump re-runs the
    // backfill once so archives already at v1 pick those rows up
    const legacy = tempDir("megadj-similar-v2-repair-");
    const legacyDir = legacy.dir();
    try {
      const raw = new Database(join(legacyDir, "archive.db"));
      raw.exec(`CREATE TABLE section_embeddings (
        video_id TEXT NOT NULL, model TEXT NOT NULL,
        dim INTEGER NOT NULL, vec_json TEXT NOT NULL,
        source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL,
        section_start REAL, section_end REAL,
        PRIMARY KEY (video_id, model))`);
      raw.exec(
        `INSERT INTO section_embeddings (video_id, model, dim, vec_json, source_path, analyzed_at)
         VALUES ('sec1', 'effnet-discogs-1280-section-1', 2, '[1,2]', '/tmp/s', 'now')`,
      );
      raw.exec(`PRAGMA user_version = ${VEC_F32_USER_VERSION - 1}`);
      ensureVecF32Schema(raw);
      const row = raw
        .query("SELECT vec_f32 FROM section_embeddings WHERE video_id = 'sec1'")
        .get() as { vec_f32: Uint8Array | null };
      expect(parseEmbeddingVector(row.vec_f32, "sec1")).toEqual([1, 2]);
      raw.close();
    } finally {
      legacy.dispose(legacyDir);
    }
  });
  test("backfill walks >batch legacy tables via rowid pagination — poison rows never wedge it", () => {
    // 1049 consecutive poison rows would hand a bare `LIMIT 1000` loop the
    // same first batch forever; the rowid cursor walks past them and the
    // good row at the tail still gets its blob
    const legacy = tempDir("megadj-similar-backfill-batches-");
    const legacyDir = legacy.dir();
    try {
      const raw = new Database(join(legacyDir, "archive.db"));
      raw.exec(`CREATE TABLE embeddings (
        video_id TEXT PRIMARY KEY, dim INTEGER NOT NULL,
        vec_json TEXT NOT NULL, source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL)`);
      raw.exec("BEGIN");
      const insert = raw.query(
        `INSERT INTO embeddings (video_id, dim, vec_json, source_path, analyzed_at)
         VALUES (?, 2, ?, '/tmp/l', 'now')`,
      );
      for (let i = 0; i < 1050; i++) {
        insert.run(`row${i}`, i < 1049 ? '[1,"poison"]' : "[1049,1050]");
      }
      raw.exec("COMMIT");
      const diagnostics: string[] = [];
      const previous = console.warn;
      console.warn = (...args: unknown[]) => diagnostics.push(args.join(" "));
      try {
        ensureVecF32Schema(raw);
      } finally {
        console.warn = previous;
      }
      const counts = raw
        .query("SELECT COUNT(*) AS total, SUM(vec_f32 IS NOT NULL) AS withBlob FROM embeddings")
        .get() as { total: number; withBlob: number };
      expect(counts.total).toBe(1050);
      expect(counts.withBlob).toBe(1);
      expect(
        parseEmbeddingVector(
          (
            raw.query("SELECT vec_f32 FROM embeddings WHERE video_id = 'row1049'").get() as {
              vec_f32: Uint8Array | null;
            }
          ).vec_f32,
          "row1049",
        ),
      ).toEqual([1049, 1050]);
      expect(diagnostics.filter((line) => line.includes("non-finite")).length).toBe(1049);
      raw.close();
    } finally {
      legacy.dispose(legacyDir);
    }
  });
  test("non-downloaded tracks stay out of the corpus", () => {
    state.upsertTrackFromPlaylist("gone", 0, "Gone", "test");
    state.setEmbeddingRecord({
      videoId: "gone",
      vec: [1, 1, 1],
      sourcePath: "/tmp/gone.mp3",
      model: "effnet-test",
    });
    expect(state.embeddingCorpus().some((c) => c.videoId === "gone")).toBe(false);
  });
});
