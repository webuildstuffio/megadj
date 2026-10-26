/**
 * baseline-freeze.ts — Baseline freeze (B0.3).
 *
 * Captures a snapshot of all bench stage results at a given point in time.
 * The frozen baseline is tagged (e.g. "v2-final") and stored in the
 * bench_runs table. Future runs are compared against this frozen baseline.
 *
 * The freeze serves two purposes:
 * 1. Regression detection: ensure v3 changes don't degrade v2 metrics
 * 2. A/B comparison: compare v3 estimator against v2 vote ladder
 */
import { round3 } from "../../shared/leaf/fmt";

/** A frozen baseline snapshot. */
export interface BaselineSnapshot {
  /** Tag for the baseline (e.g. "v2-final", "v3-rc1"). */
  readonly tag: string;
  /** When the baseline was frozen. */
  readonly frozenAt: string;
  /** Per-stage metrics at freeze time. */
  readonly stages: ReadonlyMap<string, StageBaseline>;
  /** Number of tracks in the bench set at freeze time. */
  readonly benchSetSize: number;
}

/** Per-stage baseline metrics. */
export interface StageBaseline {
  readonly stage: string;
  readonly accuracy: number;
  readonly total: number;
  /** Optional: 95% CI lower bound. */
  readonly ciLower: number | null;
  /** Optional: 95% CI upper bound. */
  readonly ciUpper: number | null;
}

/** Comparison between current run and frozen baseline. */
export interface BaselineComparison {
  readonly stage: string;
  readonly currentAccuracy: number;
  readonly baselineAccuracy: number;
  /** Positive = improvement, negative = regression. */
  readonly delta: number;
  /** Whether the change is significant (current outside baseline CI). */
  readonly significant: boolean;
  /** Whether this is a regression. */
  readonly regression: boolean;
}

/**
 * Create a baseline snapshot from stage results.
 */
export function freezeBaseline(
  tag: string,
  stages: readonly {
    stage: string;
    accuracy: number;
    total: number;
    ciLower?: number;
    ciUpper?: number;
  }[],
  benchSetSize: number,
): BaselineSnapshot {
  const stageMap = new Map<string, StageBaseline>();
  for (const s of stages) {
    stageMap.set(s.stage, {
      stage: s.stage,
      accuracy: round3(s.accuracy),
      total: s.total,
      ciLower: s.ciLower !== undefined ? round3(s.ciLower) : null,
      ciUpper: s.ciUpper !== undefined ? round3(s.ciUpper) : null,
    });
  }

  return { tag, frozenAt: new Date().toISOString(), stages: stageMap, benchSetSize };
}

/**
 * Compare current results against a frozen baseline.
 */
export function compareToBaseline(
  current: readonly { stage: string; accuracy: number }[],
  baseline: BaselineSnapshot,
): BaselineComparison[] {
  return current.map((c) => {
    const base = baseline.stages.get(c.stage);
    if (base === undefined) {
      return {
        stage: c.stage,
        currentAccuracy: round3(c.accuracy),
        baselineAccuracy: 0,
        delta: round3(c.accuracy),
        significant: false,
        regression: false,
      };
    }

    const delta = round3(c.accuracy - base.accuracy);
    const significant =
      base.ciLower !== null && base.ciUpper !== null
        ? c.accuracy < base.ciLower || c.accuracy > base.ciUpper
        : Math.abs(delta) > 0.02;
    const regression = delta < 0 && significant;

    return {
      stage: c.stage,
      currentAccuracy: round3(c.accuracy),
      baselineAccuracy: base.accuracy,
      delta,
      significant,
      regression,
    };
  });
}
