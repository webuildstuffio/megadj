/**
 * backfill-votes.ts — Backfill genre_evidence from tracks.genre_votes (B4.1).
 *
 * The old W-table vote ladder stored per-track genre breakdowns as a JSON
 * blob in tracks.genre_votes. This module reads those blobs and writes
 * normalized evidence rows into the genre_evidence table.
 *
 * Each vote becomes one evidence row with:
 * - annotator_id = source:scope (e.g. "soundcloud:exact_recording")
 * - scope = "exact_recording" (the old ladder didn't distinguish)
 * - confidence = normalized weight from the vote
 */
import type { Database } from "bun:sqlite";
import {
  migrateEvidenceTable,
  upsertEvidence,
  type GenreEvidence,
} from "./evidence-store";
import { mapToFamily } from "../genre/taxonomy-v3";

interface VotesRow {
  video_id: string;
  genre_votes: string | null;
}

interface VoteEntry {
  source?: string;
  genre?: string;
  weight?: number;
  provenance?: string;
}

/**
 * Backfill genre_evidence from the JSON blobs in tracks.genre_votes.
 * Idempotent — upserts on the natural key.
 */
export function backfillFromVotes(db: Database): {
  tracksRead: number;
  evidenceWritten: number;
  errors: number;
} {
  migrateEvidenceTable(db);

  const rows = db
    .query(
      `SELECT video_id, genre_votes FROM tracks
       WHERE genre_votes IS NOT NULL AND genre_votes != ''`,
    )
    .all() as VotesRow[];

  let evidenceWritten = 0;
  let errors = 0;
  const now = new Date().toISOString();

  for (const row of rows) {
    if (!row.genre_votes) continue;
    let votes: VoteEntry[];
    try {
      const parsed: unknown = JSON.parse(row.genre_votes);
      if (!Array.isArray(parsed)) continue;
      votes = parsed as VoteEntry[];
    } catch {
      errors++;
      continue;
    }

    const evidenceRows: GenreEvidence[] = [];
    for (const vote of votes) {
      if (!vote.genre || typeof vote.genre !== "string") continue;
      const source = vote.source ?? vote.provenance ?? "unknown";
      const weight =
        typeof vote.weight === "number" && Number.isFinite(vote.weight)
          ? vote.weight
          : 1.0;

      const family = mapToFamily(vote.genre) ?? vote.genre.toLowerCase();
      evidenceRows.push({
        trackId: row.video_id,
        annotatorId: `${source}:exact_recording`,
        scope: "exact_recording",
        genreFamily: family,
        genreSubgenre: null,
        confidence: Math.min(1, Math.max(0, weight / 10)),
        verified: false,
        audioMatch: null,
        sourceUrl: null,
        evidence: JSON.stringify(vote),
        createdAt: now,
      });
    }

    if (evidenceRows.length > 0) {
      evidenceWritten += upsertEvidence(db, evidenceRows);
    }
  }

  return {
    tracksRead: rows.length,
    evidenceWritten,
    errors,
  };
}
