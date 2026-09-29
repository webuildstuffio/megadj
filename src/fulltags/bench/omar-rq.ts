/**
 * omar-rq.ts — OMAR-RQ challenger on per-bar tasks (B9.1).
 *
 * Scaffolding for evaluating the OMAR-RQ model as an alternative
 * rhythm/groove analyzer. OMAR-RQ provides per-bar rhythm quality
 * scores that can complement BPM and energy analysis.
 *
 * The actual model inference requires the ONNX runtime and a downloaded
 * model checkpoint. This module provides the evaluation framework.
 */
import { round3 } from "../../shared/leaf/fmt";

/** OMAR-RQ analysis result for one bar. */
export interface OmarBarResult {
  readonly barIndex: number;
  /** Rhythm complexity score (0–1). */
  readonly rhythmComplexity: number;
  /** Groove consistency score (0–1). */
  readonly grooveConsistency: number;
  /** Syncopation measure (0–1). */
  readonly syncopation: number;
}

/** OMAR-RQ track-level summary. */
export interface OmarTrackSummary {
  readonly trackId: string;
  readonly barCount: number;
  readonly meanRhythmComplexity: number;
  readonly meanGrooveConsistency: number;
  readonly meanSyncopation: number;
}

/**
 * Summarize per-bar OMAR results into a track-level summary.
 */
export function summarizeOmarBars(
  trackId: string,
  bars: readonly OmarBarResult[],
): OmarTrackSummary {
  if (bars.length === 0) {
    return {
      trackId,
      barCount: 0,
      meanRhythmComplexity: 0,
      meanGrooveConsistency: 0,
      meanSyncopation: 0,
    };
  }

  let rcSum = 0;
  let gcSum = 0;
  let synSum = 0;
  for (const b of bars) {
    rcSum += b.rhythmComplexity;
    gcSum += b.grooveConsistency;
    synSum += b.syncopation;
  }

  return {
    trackId,
    barCount: bars.length,
    meanRhythmComplexity: round3(rcSum / bars.length),
    meanGrooveConsistency: round3(gcSum / bars.length),
    meanSyncopation: round3(synSum / bars.length),
  };
}

/**
 * Compare OMAR-RQ results against existing per-bar energy values.
 *
 * Returns correlation between groove consistency and energy —
 * high correlation validates OMAR as an energy complement.
 */
export function correlateWithEnergy(
  omarBars: readonly OmarBarResult[],
  energyBars: readonly { barIndex: number; energy: number }[],
): number {
  if (omarBars.length === 0 || energyBars.length === 0) return 0;

  const energyMap = new Map(energyBars.map((e) => [e.barIndex, e.energy]));
  const pairs: { omar: number; energy: number }[] = [];

  for (const b of omarBars) {
    const e = energyMap.get(b.barIndex);
    if (e !== undefined) {
      pairs.push({ omar: b.grooveConsistency, energy: e });
    }
  }

  if (pairs.length < 2) return 0;

  // Pearson correlation
  const n = pairs.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  for (const p of pairs) {
    sumX += p.omar;
    sumY += p.energy;
    sumXY += p.omar * p.energy;
    sumX2 += p.omar * p.omar;
    sumY2 += p.energy * p.energy;
  }

  const denom = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY),
  );
  if (denom === 0) return 0;
  return round3((n * sumXY - sumX * sumY) / denom);
}
