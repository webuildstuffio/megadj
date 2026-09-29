/**
 * energy-bands.ts — Percentile energy bands vs frozen reference (B7.3).
 *
 * Computes energy percentile bands from a frozen reference distribution.
 * The reference is the library's energy score distribution at a given date;
 * new tracks are banded against this frozen reference so that energy
 * bands are stable (adding/removing tracks doesn't shift bands).
 */
import { round3 } from "../../shared/leaf/fmt";

/** A frozen reference distribution of energy scores. */
export interface EnergyReference {
  /** Percentile thresholds (10 values: p10, p20, ..., p90). */
  readonly percentiles: readonly number[];
  /** Number of tracks in the reference set. */
  readonly trackCount: number;
  /** Date the reference was frozen. */
  readonly frozenAt: string;
}

/**
 * Build a frozen reference from raw energy scores.
 *
 * @param scores - All track energy scores (0–1 range)
 * @returns Reference with 9 percentile thresholds (p10–p90)
 */
export function buildEnergyReference(
  scores: readonly number[],
): EnergyReference {
  if (scores.length === 0) {
    return {
      percentiles: Array.from({ length: 9 }, () => 0),
      trackCount: 0,
      frozenAt: new Date().toISOString(),
    };
  }

  const sorted = [...scores].toSorted((a, b) => a - b);
  const percentiles: number[] = [];
  for (let p = 10; p <= 90; p += 10) {
    const idx = Math.floor((p / 100) * sorted.length);
    percentiles.push(round3(sorted[Math.min(idx, sorted.length - 1)]!));
  }

  return {
    percentiles,
    trackCount: scores.length,
    frozenAt: new Date().toISOString(),
  };
}

/**
 * Band a score against a frozen reference.
 *
 * @param score - Energy score (0–1)
 * @param reference - Frozen reference
 * @returns Band 1–10
 */
export function bandFromReference(
  score: number,
  reference: EnergyReference,
): number {
  if (reference.trackCount === 0) return 5;

  for (let i = 0; i < reference.percentiles.length; i++) {
    if (score <= reference.percentiles[i]!) {
      return i + 1;
    }
  }
  return 10;
}
