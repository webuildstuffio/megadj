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
 * When optional per-bar RMS values are supplied (P6), loudness peaks
 * dominate the scoring — picking actual energy peaks instead of relying
 * on position heuristics alone.
 *
 * Pure — no DB, no IO; the caller supplies downbeats (and optionally RMS).
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
  /** Heuristic score (higher = more likely to be the genre-defining section). */
  readonly score: number;
}

/** Preferred section length in bars (32 bars ≈ 60–90s at 120–150 BPM). */
const TARGET_BARS = 32;
/** Minimum usable section in bars (16 bars ≈ 30–45s). */
const MIN_BARS = 16;
/** Minimum gap between returned candidates (bars). Prevents near-duplicate
 * overlapping windows from dominating the top-N. */
const MIN_CANDIDATE_GAP_BARS = 8;

/** Normalize an array to [0, 1] by its min–max range. Returns zeros when
 * the range is effectively zero (all values equal). */
function minMaxNorm(values: number[]): number[] {
  if (values.length === 0) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo;
  if (range < 1e-12) return values.map(() => 0);
  return values.map((v) => (v - lo) / range);
}

/** Score every non-overlapping 32-bar window. Internal — used by both
 * `findDropSection` and `findDropCandidates`.
 *
 * When `rmsPerBar` is supplied, RMS-loudness becomes the primary signal
 * (weight 0.50) and position drops to 0.35, density to 0.15.
 * Without RMS: position 0.70, density 0.30 (original behavior). */
function scoreWindows(
  downbeats: number[],
  _trackDurationS: number,
  rmsPerBar?: number[],
): { start: number; score: number; sectionBars: number }[] {
  const totalBars = downbeats.length;
  const sectionBars = Math.min(TARGET_BARS, totalBars);
  const scored: { start: number; score: number; sectionBars: number }[] = [];

  const hasRms =
    rmsPerBar !== undefined && rmsPerBar.length >= totalBars;

  // Pre-compute raw window means for each signal, then min-max normalize.
  const rawPos: number[] = [];
  const rawDensity: number[] = [];
  const rawRms: number[] = [];

  for (let start = 0; start + sectionBars <= totalBars; start++) {
    const midBar = start + sectionBars / 2;
    const posFraction = midBar / totalBars;
    rawPos.push(1 - 4 * (posFraction - 0.5) ** 2);

    let intervalSum = 0;
    let intervalCount = 0;
    for (let i = start; i < start + sectionBars - 1; i++) {
      const interval = downbeats[i + 1]! - downbeats[i]!;
      if (interval > 0) {
        intervalSum += interval;
        intervalCount++;
      }
    }
    const meanInterval = intervalCount > 0 ? intervalSum / intervalCount : 2;
    rawDensity.push(2.0 / Math.max(0.5, meanInterval));

    if (hasRms) {
      let rmsSum = 0;
      for (let i = start; i < start + sectionBars; i++) {
        rmsSum += rmsPerBar[i]!;
      }
      rawRms.push(rmsSum / sectionBars);
    }
  }

  if (hasRms) {
    const normPos = minMaxNorm(rawPos);
    const normDens = minMaxNorm(rawDensity);
    const normRms = minMaxNorm(rawRms);
    for (let i = 0; i < rawPos.length; i++) {
      scored.push({
        start: i,
        score: normRms[i]! * 0.5 + normPos[i]! * 0.35 + normDens[i]! * 0.15,
        sectionBars,
      });
    }
  } else {
    for (let i = 0; i < rawPos.length; i++) {
      scored.push({
        start: i,
        score: rawPos[i]! * 0.7 + rawDensity[i]! * 0.3,
        sectionBars,
      });
    }
  }
  return scored;
}

/** Build a DropSection from a scored window. */
function buildSection(
  downbeats: number[],
  w: { start: number; score: number; sectionBars: number },
  dur: number,
): DropSection {
  const endIdx = Math.min(w.start + w.sectionBars, downbeats.length - 1);
  const lastBarDur =
    endIdx > 0 ? downbeats[endIdx]! - downbeats[endIdx - 1]! : 2;
  const endSec = Math.min(downbeats[endIdx]! + lastBarDur, dur);
  return {
    startSec: downbeats[w.start]!,
    endSec,
    durationSec: endSec - downbeats[w.start]!,
    startBar: w.start + 1,
    lengthBars: w.sectionBars,
    score: w.score,
  };
}

/**
 * Find the single best peak/drop section from downbeat timestamps.
 *
 * @param downbeats - Array of downbeat timestamps in seconds (1 per bar)
 * @param trackDurationS - Total track duration in seconds (optional)
 * @param rmsPerBar - Per-bar RMS loudness values (optional, P6)
 * @returns The peak section, or null if the track is too short
 */
export function findDropSection(
  downbeats: number[],
  trackDurationS?: number | null,
  rmsPerBar?: number[],
): DropSection | null {
  if (downbeats.length < MIN_BARS) return null;
  const dur = trackDurationS ?? downbeats[downbeats.length - 1]! + 2;
  const windows = scoreWindows(downbeats, dur, rmsPerBar);
  if (windows.length === 0) return null;
  const best = windows.reduce((a, b) => (b.score > a.score ? b : a));
  return buildSection(downbeats, best, dur);
}

/**
 * Find the top-N non-overlapping candidate sections, sorted by score.
 * Used by the bench to compare strategies (single best vs. multi-section
 * voting vs. best-of-N genre agreement).
 *
 * @param downbeats - Array of downbeat timestamps in seconds (1 per bar)
 * @param n - Number of candidates to return (default 3)
 * @param trackDurationS - Total track duration in seconds (optional)
 * @param rmsPerBar - Per-bar RMS loudness values (optional, P6)
 * @returns Array of up to N non-overlapping sections, score-descending
 */
export function findDropCandidates(
  downbeats: number[],
  n = 3,
  trackDurationS?: number | null,
  rmsPerBar?: number[],
): DropSection[] {
  if (downbeats.length < MIN_BARS) return [];
  const dur = trackDurationS ?? downbeats[downbeats.length - 1]! + 2;
  const windows = scoreWindows(downbeats, dur, rmsPerBar);
  if (windows.length === 0) return [];

  // Greedy non-overlapping selection: pick the highest-scored window,
  // then skip any window within MIN_CANDIDATE_GAP_BARS of a picked one.
  const sorted = windows.toSorted((a, b) => b.score - a.score);
  const picked: DropSection[] = [];
  const usedStarts = new Set<number>();

  for (const w of sorted) {
    if (picked.length >= n) break;
    let overlaps = false;
    for (const used of usedStarts) {
      if (Math.abs(w.start - used) < MIN_CANDIDATE_GAP_BARS) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) {
      picked.push(buildSection(downbeats, w, dur));
      usedStarts.add(w.start);
    }
  }
  return picked;
}
