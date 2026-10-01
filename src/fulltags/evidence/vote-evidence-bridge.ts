/**
 * vote-evidence-bridge.ts — converts genre ladder votes into evidence rows.
 *
 * The bridge writes evidence from each fetch run's genreVotes[] into the
 * genre_evidence table. This populates the evidence store for the
 * Dawid-Skene estimator without changing the vote pipeline's behaviour.
 *
 * Each vote rung becomes an annotator_id. Scope is determined by the
 * rung type: Beatport/Bandcamp/Discogs are exact_recording; SC search
 * hits are artist-level; MusicBrainz is recording-level; Last.fm is
 * user-level community data; AI is artist-level inference.
 */
import type { Database } from "bun:sqlite";
import type { GenreVote, GenreVoteRung } from "../genre/genre-vote";
import { mapToFamily } from "../genre/taxonomy-v3";
import { familyOf } from "../genre/genre-vocab";
import {
  migrateEvidenceTable,
  upsertEvidence,
  type EvidenceScope,
  type GenreEvidence,
} from "./evidence-store";

const RUNG_SCOPE: Record<GenreVoteRung, EvidenceScope> = {
  bp: "exact_recording",
  file: "exact_recording",
  discogs: "exact_recording",
  bc: "exact_recording",
  ai: "artist",
  mb: "same_song_other_version",
  sc: "artist",
  lastfm: "user",
  sync: "user",
  imprint: "label",
};

const RUNG_CONFIDENCE: Record<GenreVoteRung, number> = {
  bp: 0.9,
  file: 0.85,
  discogs: 0.85,
  bc: 0.8,
  ai: 0.7,
  mb: 0.75,
  sc: 0.5,
  lastfm: 0.6,
  sync: 0.3,
  imprint: 0.4,
};

/** Normalize familyOf (genre-vocab) returns to taxonomy-v3 family names. */
const FAMILY_NORMALIZE = new Map<string, string>([
  ["hiphop", "hip hop"],
  ["groove", "funk"],
  ["mood", "ambient"],
  ["edm", "electro"],
]);

const migratedDbs = new WeakSet<Database>();

/**
 * Convert genre votes to evidence rows and persist them.
 * Idempotent — UPSERT on (track_id, annotator_id, scope, genre_family).
 */
export function bridgeVotesToEvidence(
  db: Database,
  trackId: string,
  votes: readonly GenreVote[],
): number {
  if (votes.length === 0) return 0;

  if (!migratedDbs.has(db)) {
    migrateEvidenceTable(db);
    migratedDbs.add(db);
  }

  const rows: GenreEvidence[] = [];
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  for (const v of votes) {
    // mapToFamily (taxonomy-v3) is strict — umbrellas abstain (EDM/Dance/
    // Electronic → null). familyOf (genre-vocab) maps them to a family
    // for scoring. Evidence needs the broader mapping: a Beatport vote for
    // "EDM" is still evidence the track is in the edm family.
    const rawFamily = mapToFamily(v.genre) ?? familyOf(v.genre);
    if (!rawFamily) continue;
    const family = FAMILY_NORMALIZE.get(rawFamily) ?? rawFamily;

    rows.push({
      trackId,
      annotatorId: `vote:${v.rung}`,
      scope: RUNG_SCOPE[v.rung],
      genreFamily: family,
      genreSubgenre: v.genre !== family ? v.genre : null,
      confidence: RUNG_CONFIDENCE[v.rung],
      verified: false,
      audioMatch: null,
      sourceUrl: null,
      evidence: v.detail ?? null,
      createdAt: now,
    });
  }

  return upsertEvidence(db, rows);
}
