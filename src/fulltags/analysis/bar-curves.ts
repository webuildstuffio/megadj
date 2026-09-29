/**
 * bar-curves.ts — Per-patch Essentia heads → per-bar curves (B2.2).
 *
 * Aggregates per-patch (short-time) Essentia feature vectors into
 * per-bar feature curves for use in phrase detection and section
 * classification. Each bar's feature is the mean of its constituent
 * patches, weighted by proximity to the beat grid.
 */
import { round3 } from "../../shared/leaf/fmt";

/** A single patch (short-time) feature vector. */
export interface PatchFeature {
  /** Time offset in seconds from track start. */
  readonly timeSeconds: number;
  /** Feature values (e.g. MFCC, spectral centroid, energy). */
  readonly features: readonly number[];
}

/** A single bar's aggregated feature vector. */
export interface BarFeature {
  /** Bar index (0-based). */
  readonly barIndex: number;
  /** Start time in seconds. */
  readonly startTime: number;
  /** End time in seconds. */
  readonly endTime: number;
  /** Aggregated feature vector. */
  readonly features: readonly number[];
}

/**
 * Aggregate patches into bars using a beat grid.
 *
 * @param patches - Time-stamped patch features
 * @param barBoundaries - Bar start times in seconds (ascending)
 * @returns Per-bar aggregated features
 */
export function patchesToBars(
  patches: readonly PatchFeature[],
  barBoundaries: readonly number[],
): BarFeature[] {
  if (patches.length === 0 || barBoundaries.length < 2) return [];

  const bars: BarFeature[] = [];

  for (let bi = 0; bi < barBoundaries.length - 1; bi++) {
    const start = barBoundaries[bi]!;
    const end = barBoundaries[bi + 1]!;

    // Find patches in this bar
    const barPatches = patches.filter(
      (p) => p.timeSeconds >= start && p.timeSeconds < end,
    );

    if (barPatches.length === 0) continue;

    const dim = barPatches[0]!.features.length;
    const mean = new Float64Array(dim);
    for (const p of barPatches) {
      for (let d = 0; d < dim; d++) {
        mean[d] = (mean[d] ?? 0) + (p.features[d] ?? 0);
      }
    }
    for (let d = 0; d < dim; d++) {
      mean[d] = round3((mean[d] ?? 0) / barPatches.length);
    }

    bars.push({
      barIndex: bi,
      startTime: start,
      endTime: end,
      features: [...mean],
    });
  }

  return bars;
}

/**
 * Extract a single dimension from bar features as a curve.
 */
export function extractCurve(
  bars: readonly BarFeature[],
  dimension: number,
): { barIndex: number; value: number }[] {
  return bars.map((b) => ({
    barIndex: b.barIndex,
    value: b.features[dimension] ?? 0,
  }));
}
