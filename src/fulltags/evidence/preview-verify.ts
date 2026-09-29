/**
 * preview-verify.ts — Preview-audio verification framework (B3.4).
 *
 * Verifies that a store-sourced genre evidence row actually refers to the
 * same recording by comparing audio fingerprints of the store's preview
 * clip against the local track.
 *
 * Pipeline:
 * 1. Download 30s preview from store (iTunes, SoundCloud)
 * 2. Compute chromaprint fingerprint of both
 * 3. Cross-correlate fingerprints
 * 4. Score: high correlation = same recording = exact scope
 *         low correlation = different version or wrong match
 *
 * This module handles the scoring and calibration; the actual fingerprint
 * computation uses the existing fpcalc seam.
 */
import { round3 } from "../../shared/leaf/fmt";

/** Preview verification result. */
export interface PreviewVerification {
  readonly trackId: string;
  readonly evidenceSource: string;
  /** Preview URL that was checked. */
  readonly previewUrl: string;
  /** Cross-correlation score (0–1). */
  readonly correlation: number;
  /** Verification verdict. */
  readonly verdict: "exact" | "similar" | "different";
  /** Whether this evidence should be trusted. */
  readonly trusted: boolean;
}

/** Thresholds for preview verification. */
export const PREVIEW_THRESHOLDS = {
  /** Above this = exact match (same recording). */
  EXACT: 0.85,
  /** Above this = similar (same song, different version). */
  SIMILAR: 0.5,
  /** Below SIMILAR = different (wrong match). */
} as const;

/**
 * Score a preview verification from cross-correlation.
 *
 * @param correlation - Cross-correlation of fingerprints (0–1)
 * @returns Verdict and trust decision
 */
export function scoreVerification(correlation: number): {
  verdict: "exact" | "similar" | "different";
  trusted: boolean;
} {
  if (correlation >= PREVIEW_THRESHOLDS.EXACT) {
    return { verdict: "exact", trusted: true };
  }
  if (correlation >= PREVIEW_THRESHOLDS.SIMILAR) {
    return { verdict: "similar", trusted: true };
  }
  return { verdict: "different", trusted: false };
}

/**
 * Cross-correlate two chromaprint fingerprint arrays.
 * Uses normalized cross-correlation of the bit vectors.
 *
 * @param fpA - Fingerprint of track A (array of uint32)
 * @param fpB - Fingerprint of track B (array of uint32)
 * @returns Correlation score (0–1)
 */
export function crossCorrelateFingerprints(
  fpA: readonly number[],
  fpB: readonly number[],
): number {
  if (fpA.length === 0 || fpB.length === 0) return 0;

  const minLen = Math.min(fpA.length, fpB.length);
  let matchingBits = 0;
  let totalBits = 0;

  for (let i = 0; i < minLen; i++) {
    const xor = (fpA[i]! ^ fpB[i]!) >>> 0;
    // Count matching bits (32 - popcount of XOR)
    let popcnt = xor;
    popcnt -= (popcnt >>> 1) & 0x55555555;
    popcnt = (popcnt & 0x33333333) + ((popcnt >>> 2) & 0x33333333);
    popcnt = (popcnt + (popcnt >>> 4)) & 0x0f0f0f0f;
    popcnt = (popcnt * 0x01010101) >>> 24;

    matchingBits += 32 - popcnt;
    totalBits += 32;
  }

  return totalBits > 0 ? round3(matchingBits / totalBits) : 0;
}

/**
 * Calibrate the verification threshold from labeled data.
 * Given a set of (correlation, isMatch) pairs, find the threshold
 * that maximizes F1 score.
 */
export function calibrateThreshold(
  data: readonly { correlation: number; isMatch: boolean }[],
): { threshold: number; f1: number; precision: number; recall: number } {
  if (data.length === 0) {
    return {
      threshold: PREVIEW_THRESHOLDS.EXACT,
      f1: 0,
      precision: 0,
      recall: 0,
    };
  }

  let bestThreshold = 0.5;
  let bestF1 = 0;
  let bestPrecision = 0;
  let bestRecall = 0;

  for (let t = 0.1; t <= 0.99; t += 0.01) {
    let tp = 0;
    let fp = 0;
    let fn = 0;

    for (const d of data) {
      const predicted = d.correlation >= t;
      if (predicted && d.isMatch) tp++;
      else if (predicted && !d.isMatch) fp++;
      else if (!predicted && d.isMatch) fn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 =
      precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : 0;

    if (f1 > bestF1) {
      bestF1 = f1;
      bestThreshold = round3(t);
      bestPrecision = round3(precision);
      bestRecall = round3(recall);
    }
  }

  return {
    threshold: bestThreshold,
    f1: round3(bestF1),
    precision: bestPrecision,
    recall: bestRecall,
  };
}
