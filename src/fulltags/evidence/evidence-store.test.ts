import { Database } from "bun:sqlite";
import { describe, test, expect } from "bun:test";
import {
  migrateEvidenceTable,
  upsertEvidence,
  loadEvidence,
  loadEvidenceBatch,
  evidenceStats,
  type GenreEvidence,
} from "./evidence-store";

function freshDb(): Database {
  const db = new Database(":memory:");
  migrateEvidenceTable(db);
  return db;
}

function makeEvidence(overrides: Partial<GenreEvidence> = {}): GenreEvidence {
  return {
    trackId: "t1",
    annotatorId: "beatport:exact_recording",
    scope: "exact_recording",
    genreFamily: "house",
    genreSubgenre: "deep house",
    confidence: 0.95,
    verified: false,
    audioMatch: null,
    sourceUrl: "https://beatport.com/track/123",
    evidence: null,
    createdAt: "2026-09-29T12:00:00Z",
    ...overrides,
  };
}

describe("evidence-store", () => {
  test("migration is idempotent", () => {
    const db = freshDb();
    migrateEvidenceTable(db);
    migrateEvidenceTable(db);
    const tables = db
      .query(`SELECT name FROM sqlite_master WHERE type='table' AND name='genre_evidence'`)
      .all();
    expect(tables).toHaveLength(1);
  });

  test("upsert inserts new rows", () => {
    const db = freshDb();
    const count = upsertEvidence(db, [
      makeEvidence(),
      makeEvidence({ trackId: "t2", genreFamily: "techno" }),
    ]);
    expect(count).toBe(2);
    const rows = loadEvidence(db, "t1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.genreFamily).toBe("house");
    expect(rows[0]!.genreSubgenre).toBe("deep house");
  });

  test("upsert updates on conflict", () => {
    const db = freshDb();
    upsertEvidence(db, [makeEvidence({ confidence: 0.5 })]);
    upsertEvidence(db, [makeEvidence({ confidence: 0.99, verified: true })]);
    const rows = loadEvidence(db, "t1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.confidence).toBe(0.99);
    expect(rows[0]!.verified).toBe(true);
  });

  test("loadEvidence filters by scope", () => {
    const db = freshDb();
    upsertEvidence(db, [
      makeEvidence({ scope: "exact_recording" }),
      makeEvidence({ annotatorId: "sc:artist", scope: "artist", genreFamily: "edm" }),
    ]);
    const exact = loadEvidence(db, "t1", "exact_recording");
    expect(exact).toHaveLength(1);
    expect(exact[0]!.scope).toBe("exact_recording");
    const artist = loadEvidence(db, "t1", "artist");
    expect(artist).toHaveLength(1);
    expect(artist[0]!.genreFamily).toBe("edm");
  });

  test("loadEvidence returns empty for unknown track", () => {
    const db = freshDb();
    expect(loadEvidence(db, "nonexistent")).toHaveLength(0);
  });

  test("loadEvidenceBatch returns grouped results", () => {
    const db = freshDb();
    upsertEvidence(db, [
      makeEvidence({ trackId: "t1" }),
      makeEvidence({ trackId: "t2", genreFamily: "techno" }),
      makeEvidence({ trackId: "t2", annotatorId: "sc:exact_recording", genreFamily: "tech house" }),
    ]);
    const batch = loadEvidenceBatch(db, ["t1", "t2", "t3"]);
    expect(batch.get("t1")).toHaveLength(1);
    expect(batch.get("t2")).toHaveLength(2);
    expect(batch.has("t3")).toBe(false);
  });

  test("loadEvidenceBatch handles empty input", () => {
    const db = freshDb();
    expect(loadEvidenceBatch(db, []).size).toBe(0);
  });

  test("evidenceStats groups by annotator", () => {
    const db = freshDb();
    upsertEvidence(db, [
      makeEvidence({ verified: true }),
      makeEvidence({ trackId: "t2", genreFamily: "techno", verified: false }),
      makeEvidence({ trackId: "t3", annotatorId: "sc:exact_recording", genreFamily: "edm" }),
    ]);
    const stats = evidenceStats(db);
    expect(stats.length).toBeGreaterThanOrEqual(2);
    const bp = stats.find((s) => s.annotatorId === "beatport:exact_recording");
    expect(bp).toBeDefined();
    expect(bp!.count).toBe(2);
  });

  test("scope check constraint rejects invalid values", () => {
    const db = freshDb();
    expect(() => upsertEvidence(db, [makeEvidence({ scope: "invalid" as never })])).toThrow();
  });

  test("confidence ordered DESC in loadEvidence", () => {
    const db = freshDb();
    upsertEvidence(db, [
      makeEvidence({ annotatorId: "a1", confidence: 0.3, genreFamily: "house" }),
      makeEvidence({ annotatorId: "a2", confidence: 0.9, genreFamily: "techno" }),
      makeEvidence({ annotatorId: "a3", confidence: 0.6, genreFamily: "edm" }),
    ]);
    const rows = loadEvidence(db, "t1");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.confidence).toBe(0.9);
    expect(rows[1]!.confidence).toBe(0.6);
    expect(rows[2]!.confidence).toBe(0.3);
  });
});
