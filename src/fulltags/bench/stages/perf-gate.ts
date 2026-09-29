/**
 * perf-gate.ts — B11.3 nightly bench runner scaffold.
 *
 * Defines the run-all orchestration: iterate each registered stage,
 * collect results into a dated bench_runs row, and produce a summary
 * JSON with per-stage accuracy + aggregate health.
 *
 * The actual runner lives in the CLI (megadj bench run all); this
 * module provides the report builder and health check.
 */
import { round3 } from "../../../shared/leaf/fmt";

/** Summary of one stage's bench run. */
export interface StageSummary {
  readonly stage: string;
  readonly accuracy: number;
  readonly total: number;
  readonly wallMs: number;
}

/** Full bench report. */
export interface BenchReport {
  readonly runId: string;
  readonly timestamp: string;
  readonly stages: readonly StageSummary[];
  /** Aggregate accuracy (mean of per-stage accuracies). */
  readonly aggregateAccuracy: number;
  /** Whether all stages passed their baselines. */
  readonly healthy: boolean;
  /** Wall-clock time for the full run. */
  readonly totalWallMs: number;
}

/**
 * Build a bench report from stage summaries.
 */
export function buildBenchReport(
  runId: string,
  stages: readonly StageSummary[],
  baselines: ReadonlyMap<string, number>,
): BenchReport {
  const totalWall = stages.reduce((sum, s) => sum + s.wallMs, 0);
  const aggAccuracy =
    stages.length > 0
      ? round3(stages.reduce((sum, s) => sum + s.accuracy, 0) / stages.length)
      : 0;
  const healthy = stages.every((s) => {
    const baseline = baselines.get(s.stage);
    return baseline === undefined || s.accuracy >= baseline;
  });

  return {
    runId,
    timestamp: new Date().toISOString(),
    stages,
    aggregateAccuracy: aggAccuracy,
    healthy,
    totalWallMs: totalWall,
  };
}
