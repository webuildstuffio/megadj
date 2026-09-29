/**
 * evidence-store.ts — Genre evidence ledger (B4.1).
 *
 * The genre_evidence table replaces the JSON-blob `tracks.genre_votes`
 * column with a normalized, queryable evidence store. Each row is one
 * piece of evidence from one source about one track's genre.
 *
 * Evidence is NOT votes — it's raw observations with scope and
 * verification status. The estimator (WS5) reads evidence and produces
 * posteriors; the old W-table vote ladder becomes one more annotator.
 */
import type { Database } from "bun:sqlite";

/**
 * Evidence scope: how closely the source material matches the exact
 * recording in the library.
 */
export type EvidenceScope =
  | "exact_recording"
  | "same_song_other_version"
  | "artist"
  | "remixer"
  | "label"
  | "uploader"
  | "user";

export interface GenreEvidence {
  readonly trackId: string;
  readonly annotatorId: string;
  readonly scope: EvidenceScope;
  readonly genreFamily: string;
  readonly genreSubgenre: string | null;
  readonly confidence: number;
  readonly verified: boolean;
  readonly audioMatch: number | null;
  readonly sourceUrl: string | null;
  readonly evidence: string | null;
  readonly createdAt: string;
}

/**
 * Create the genre_evidence table if it doesn't exist.
 * Idempotent — safe to call on every open.
 */
export function migrateEvidenceTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS genre_evidence (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id      TEXT NOT NULL,
      annotator_id  TEXT NOT NULL,
      scope         TEXT NOT NULL CHECK (scope IN (
        'exact_recording','same_song_other_version',
        'artist','remixer','label','uploader','user'
      )),
      genre_family  TEXT NOT NULL,
      genre_subgenre TEXT,
      confidence    REAL NOT NULL DEFAULT 1.0,
      verified      INTEGER NOT NULL DEFAULT 0,
      audio_match   REAL,
      source_url    TEXT,
      evidence      TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (track_id, annotator_id, scope, genre_family)
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_track
      ON genre_evidence(track_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_annotator
      ON genre_evidence(annotator_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_family
      ON genre_evidence(genre_family);
  `);
}

/**
 * Insert or update evidence rows. Uses UPSERT on the natural key
 * (track_id, annotator_id, scope, genre_family).
 */
export function upsertEvidence(
  db: Database,
  rows: readonly GenreEvidence[],
): number {
  if (rows.length === 0) return 0;
  const stmt = db.prepare(`
    INSERT INTO genre_evidence
      (track_id, annotator_id, scope, genre_family, genre_subgenre,
       confidence, verified, audio_match, source_url, evidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (track_id, annotator_id, scope, genre_family) DO UPDATE SET
      genre_subgenre = excluded.genre_subgenre,
      confidence = excluded.confidence,
      verified = excluded.verified,
      audio_match = excluded.audio_match,
      source_url = excluded.source_url,
      evidence = excluded.evidence,
      created_at = excluded.created_at
  `);
  let count = 0;
  for (const r of rows) {
    stmt.run(
      r.trackId,
      r.annotatorId,
      r.scope,
      r.genreFamily,
      r.genreSubgenre,
      r.confidence,
      r.verified ? 1 : 0,
      r.audioMatch,
      r.sourceUrl,
      r.evidence,
      r.createdAt,
    );
    count++;
  }
  return count;
}

/**
 * Load all evidence for a track, optionally filtered by scope.
 */
export function loadEvidence(
  db: Database,
  trackId: string,
  scope?: EvidenceScope | undefined,
): GenreEvidence[] {
  const query = scope
    ? `SELECT * FROM genre_evidence WHERE track_id = ? AND scope = ? ORDER BY confidence DESC`
    : `SELECT * FROM genre_evidence WHERE track_id = ? ORDER BY confidence DESC`;
  const rows = scope
    ? (db.query(query).all(trackId, scope) as EvidenceDbRow[])
    : (db.query(query).all(trackId) as EvidenceDbRow[]);
  return rows.map(hydrateRow);
}

/**
 * Load evidence for multiple tracks at once (batch query).
 */
export function loadEvidenceBatch(
  db: Database,
  trackIds: readonly string[],
): Map<string, GenreEvidence[]> {
  if (trackIds.length === 0) return new Map();
  const placeholders = trackIds.map(() => "?").join(",");
  const rows = db
    .query(
      `SELECT * FROM genre_evidence
       WHERE track_id IN (${placeholders})
       ORDER BY track_id, confidence DESC`,
    )
    .all(...trackIds) as EvidenceDbRow[];

  const result = new Map<string, GenreEvidence[]>();
  for (const r of rows) {
    const hydrated = hydrateRow(r);
    const arr = result.get(hydrated.trackId) ?? [];
    arr.push(hydrated);
    result.set(hydrated.trackId, arr);
  }
  return result;
}

/**
 * Count evidence rows grouped by annotator.
 */
export function evidenceStats(
  db: Database,
): { annotatorId: string; count: number; verifiedCount: number }[] {
  const rows = db
    .query(
      `SELECT annotator_id, count(*) AS n,
              sum(verified) AS verified_n
       FROM genre_evidence
       GROUP BY annotator_id
       ORDER BY n DESC`,
    )
    .all() as {
    annotator_id: string;
    n: number;
    verified_n: number;
  }[];
  return rows.map((r) => ({
    annotatorId: r.annotator_id,
    count: r.n,
    verifiedCount: r.verified_n,
  }));
}

interface EvidenceDbRow {
  id: number;
  track_id: string;
  annotator_id: string;
  scope: EvidenceScope;
  genre_family: string;
  genre_subgenre: string | null;
  confidence: number;
  verified: number;
  audio_match: number | null;
  source_url: string | null;
  evidence: string | null;
  created_at: string;
}

function hydrateRow(r: EvidenceDbRow): GenreEvidence {
  return {
    trackId: r.track_id,
    annotatorId: r.annotator_id,
    scope: r.scope,
    genreFamily: r.genre_family,
    genreSubgenre: r.genre_subgenre,
    confidence: r.confidence,
    verified: r.verified === 1,
    audioMatch: r.audio_match,
    sourceUrl: r.source_url,
    evidence: r.evidence,
    createdAt: r.created_at,
  };
}
