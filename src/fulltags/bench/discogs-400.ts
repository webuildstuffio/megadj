/**
 * discogs-400.ts — Discogs-400 head as standalone L3 voter (B9.3).
 *
 * The Discogs-400 classification head (from the Essentia / MAEST family)
 * provides direct 400-class genre predictions mapped to Discogs styles.
 *
 * This module evaluates the Discogs-400 head as a standalone L3 voter
 * in the genre evidence pipeline — it can produce an L3 subgenre vote
 * without any store API calls, purely from audio.
 */
import { round3 } from "../../shared/leaf/fmt";
import { mapToFamily, type GenreFamily } from "../genre/taxonomy-v3";

/** Discogs-400 head output for a single track. */
export interface Discogs400Output {
  readonly trackId: string;
  /** Top-K predictions with Discogs style labels. */
  readonly predictions: readonly { label: string; probability: number }[];
}

/** L3 vote derived from Discogs-400 head. */
export interface Discogs400Vote {
  readonly trackId: string;
  /** L2 family from the best-mapped prediction. */
  readonly family: GenreFamily | null;
  /** L3 subgenre (the Discogs style that mapped). */
  readonly subgenre: string | null;
  /** Confidence of the vote. */
  readonly confidence: number;
  /** Weight for the genre election (audio-only = moderate). */
  readonly weight: number;
}

/** Default vote weight for audio-only genre evidence. */
export const DISCOGS_400_VOTE_WEIGHT = 0.4;

/**
 * Derive L3 votes from Discogs-400 head predictions.
 */
export function deriveVotes(outputs: readonly Discogs400Output[]): Discogs400Vote[] {
  return outputs.map((o) => {
    const sorted = o.predictions.toSorted((a, b) => b.probability - a.probability);

    let family: GenreFamily | null = null;
    let subgenre: string | null = null;
    let confidence = 0;

    for (const p of sorted) {
      const f = mapToFamily(p.label);
      if (f !== null) {
        family = f;
        subgenre = p.label.toLowerCase();
        confidence = p.probability;
        break;
      }
    }

    return {
      trackId: o.trackId,
      family,
      subgenre,
      confidence: round3(confidence),
      weight: DISCOGS_400_VOTE_WEIGHT,
    };
  });
}

/** Evaluation result for Discogs-400 voter. */
export interface Discogs400EvalResult {
  readonly total: number;
  /** Agreement rate with elected L2 family. */
  readonly familyAgreement: number;
  /** Agreement rate at L3 (subgenre exact match). */
  readonly l3Agreement: number;
  /** Rate of unmapped predictions. */
  readonly unmappedRate: number;
}

/**
 * Evaluate Discogs-400 votes against ground truth.
 */
export function evaluateDiscogs400(
  votes: readonly Discogs400Vote[],
  groundTruth: ReadonlyMap<string, { family: GenreFamily; subgenre: string | null }>,
): Discogs400EvalResult {
  if (votes.length === 0) {
    return { total: 0, familyAgreement: 0, l3Agreement: 0, unmappedRate: 0 };
  }

  let familyMatch = 0;
  let l3Match = 0;
  let unmapped = 0;
  let matched = 0;

  for (const v of votes) {
    const gt = groundTruth.get(v.trackId);
    if (gt === undefined) continue;
    matched++;

    if (v.family === null) {
      unmapped++;
      continue;
    }

    if (v.family === gt.family) familyMatch++;
    if (v.subgenre !== null && gt.subgenre !== null && v.subgenre === gt.subgenre) l3Match++;
  }

  return {
    total: matched,
    familyAgreement: matched > 0 ? round3(familyMatch / matched) : 0,
    l3Agreement: matched > 0 ? round3(l3Match / matched) : 0,
    unmappedRate: matched > 0 ? round3(unmapped / matched) : 0,
  };
}
