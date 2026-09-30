/**
 * drop-finder.ts — Find the genre-defining section of a track using the
 * beats/cues ledger.
 *
 * The "drop" is the loudest/densest 32-bar window — the section that
 * defines what genre a track IS (intros and outros are genre-ambiguous).
 * Uses the downbeat timestamps from `megadj beats` to identify windows,
 * and prefers the section starting ~25–75% into the track (where drops
 * live in standard EDM structure).
 *
 * Pure — no DB, no IO; the caller supplies downbeats.
 */

/** The drop/peak section of a track. */
export interface DropSection {
  /** Start time in seconds. */
  readonly startSec: number;
  /** End time in seconds. */
  readonly endSec: number;
  /** Duration in seconds. */
  readonly durationSec: number;
  /** Start bar (1-based). */
  readonly startBar: number;
  /** Number of bars in the section. */
  readonly lengthBars: number;
}

/** Preferred section length in bars (32 bars ≈ 60–90s at 120–150 BPM). */
const TARGET_BARS = 32;
/** Minimum usable section in bars (16 bars ≈ 30–45s). */
const MIN_BARS = 16;

/**
 * Find the peak/drop section from downbeat timestamps.
 *
 * Strategy: slide a 32-bar window across the track. Score each window by
 * position preference (25–75% of the track = likely drop/peak) and density
 * (shorter bar intervals = higher energy). Return the highest-scoring window.
 *
 * Falls back to the middle 32 bars when no clear winner exists.
 *
 * @param downbeats - Array of downbeat timestamps in seconds (1 per bar)
 * @param trackDurationS - Total track duration in seconds (optional, for position scoring)
 * @returns The peak section, or null if the track is too short
 */
export function findDropSection(
  downbeats: number[],
  trackDurationS?: number | null,
): DropSection | null {
  if (downbeats.length < MIN_BARS) return null;

  const totalBars = downbeats.length;
  const sectionBars = Math.min(TARGET_BARS, totalBars);
  const dur = trackDurationS ?? downbeats[downbeats.length - 1]! + 2;

  let bestScore = -Infinity;
  let bestStart = 0;

  for (let start = 0; start + sectionBars <= totalBars; start++) {
    // Position score: prefer the middle of the track (25–75%)
    const midBar = start + sectionBars / 2;
    const posFraction = midBar / totalBars;
    // Bell curve peaking at 50%, falling off toward 0% and 100%
    const posScore = 1 - 4 * (posFraction - 0.5) ** 2;

    // Density score: shorter bar intervals = higher energy content.
    // Compute mean bar interval within this window (lower = faster = louder).
    let intervalSum = 0;
    let intervalCount = 0;
    for (let i = start; i < start + sectionBars - 1; i++) {
      const interval = downbeats[i + 1]! - downbeats[i]!;
      if (interval > 0) {
        intervalSum += interval;
        intervalCount++;
      }
    }
    // Normalize: a typical bar at 128 BPM is ~1.875s; faster bars score higher
    const meanInterval = intervalCount > 0 ? intervalSum / intervalCount : 2;
    const densityScore = 2.0 / Math.max(0.5, meanInterval);

    // Combined score (position matters more than density for genre ID)
    const score = posScore * 0.7 + densityScore * 0.3;

    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  const startSec = downbeats[bestStart]!;
  const endIdx = Math.min(bestStart + sectionBars, totalBars - 1);
  // End at the last downbeat in the window + one bar duration estimate
  const lastBarDur =
    endIdx > 0 ? downbeats[endIdx]! - downbeats[endIdx - 1]! : 2;
  const endSec = Math.min(downbeats[endIdx]! + lastBarDur, dur);

  return {
    startSec,
    endSec,
    durationSec: endSec - startSec,
    startBar: bestStart + 1,
    lengthBars: sectionBars,
  };
}
