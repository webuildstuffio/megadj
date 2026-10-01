/**
 * energy-model.ts — Pairwise energy model from user judgments (B7.2).
 *
 * Learns energy levels from pairwise comparisons ("track A is more
 * energetic than track B") using the Bradley-Terry model.
 *
 * The model produces a continuous energy score per track, which is then
 * binned into the 1–10 energy band for the comment string.
 */
import { round3 } from "../../shared/leaf/fmt";

/** A pairwise energy judgment. */
export interface EnergyPair {
  /** Track that was judged MORE energetic. */
  readonly winnerId: string;
  /** Track that was judged LESS energetic. */
  readonly loserId: string;
}

/** Energy score for one track. */
export interface EnergyScore {
  readonly trackId: string;
  /** Continuous score (higher = more energetic). */
  readonly score: number;
  /** Energy band 1–9 (E1–E9). */
  readonly band: number;
}

/**
 * Fit a Bradley-Terry model from pairwise energy comparisons.
 *
 * Uses iterative maximum-likelihood estimation.
 *
 * @param pairs - Pairwise judgments
 * @param maxIterations - Max iterations (default: 100)
 * @param epsilon - Convergence threshold (default: 1e-6)
 * @returns Energy scores for all tracks in the pairs
 */
export function fitEnergyModel(
  pairs: readonly EnergyPair[],
  maxIterations = 100,
  epsilon = 1e-6,
): EnergyScore[] {
  if (pairs.length === 0) return [];

  // Collect all track IDs
  const trackIds = [
    ...new Set([
      ...pairs.map((p) => p.winnerId),
      ...pairs.map((p) => p.loserId),
    ]),
  ];
  const n = trackIds.length;
  const idx = new Map(trackIds.map((id, i) => [id, i]));

  // Initialize scores uniformly
  const scores = new Float64Array(n).fill(1.0);

  // Count wins and matchups
  const wins = new Float64Array(n);
  for (const p of pairs) {
    const wi = idx.get(p.winnerId);
    if (wi !== undefined) wins[wi] = (wins[wi] ?? 0) + 1;
  }

  // Bradley-Terry iterative update
  for (let iter = 0; iter < maxIterations; iter++) {
    const newScores = new Float64Array(n);
    let maxDelta = 0;

    for (let i = 0; i < n; i++) {
      let denom = 0;
      for (const p of pairs) {
        const wi = idx.get(p.winnerId);
        const li = idx.get(p.loserId);
        if (wi === undefined || li === undefined) continue;
        if (wi === i || li === i) {
          const si = scores[i]!;
          const sj = wi === i ? scores[li]! : scores[wi]!;
          denom += 1 / (si + sj);
        }
      }
      newScores[i] = denom > 0 ? wins[i]! / denom : scores[i]!;
    }

    // Normalize so max = 1
    const maxScore = Math.max(...newScores);
    if (maxScore > 0) {
      for (let i = 0; i < n; i++) {
        newScores[i]! /= maxScore;
      }
    }

    for (let i = 0; i < n; i++) {
      const delta = Math.abs(newScores[i]! - scores[i]!);
      if (delta > maxDelta) maxDelta = delta;
      scores[i] = newScores[i]!;
    }

    if (maxDelta < epsilon) break;
  }

  // Convert to energy bands (1–10)
  return trackIds.map((trackId, i) => ({
    trackId,
    score: round3(scores[i]!),
    band: scoreToBand(scores[i]!),
  }));
}

/**
 * Convert a continuous 0–1 score to a 1–9 energy band (E1–E9).
 * Uses equal-width binning. Capped at 9 per plan spec.
 */
export function scoreToBand(score: number): number {
  const band = Math.ceil(score * 9);
  return Math.max(1, Math.min(9, band));
}
