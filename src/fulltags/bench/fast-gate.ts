/**
 * fast-bench.ts — Fast bench gate for check:full (B11.1).
 *
 * Runs a minimal bench suite on cached fixtures (no live API calls,
 * no archive DB needed). Validates that the bench harness itself
 * is healthy — stages load, metrics compute, and results serialize.
 *
 * This is the `bench-gate` that runs in check:full, not the full
 * `bench run all` which needs the real library.
 */
import { round3 } from "../../shared/leaf/fmt";

/** A cached fixture row for fast bench testing. */
export interface BenchFixture {
  readonly videoId: string;
  readonly stage: string;
  readonly predicted: string | number;
  readonly expected: string | number;
}

/** Fast bench result. */
export interface FastBenchResult {
  readonly stage: string;
  readonly accuracy: number;
  readonly total: number;
  readonly correct: number;
}

/**
 * Run fast bench on cached fixtures.
 *
 * @param fixtures - Cached prediction/expected pairs
 * @returns Per-stage results
 */
export function runFastBench(fixtures: readonly BenchFixture[]): FastBenchResult[] {
  // Group by stage
  const byStage = new Map<string, BenchFixture[]>();
  for (const f of fixtures) {
    const arr = byStage.get(f.stage) ?? [];
    arr.push(f);
    byStage.set(f.stage, arr);
  }

  const results: FastBenchResult[] = [];
  for (const [stage, rows] of byStage) {
    let correct = 0;
    for (const r of rows) {
      if (String(r.predicted) === String(r.expected)) correct++;
    }
    results.push({
      stage,
      accuracy: round3(rows.length > 0 ? correct / rows.length : 0),
      total: rows.length,
      correct,
    });
  }

  return results.toSorted((a, b) => a.stage.localeCompare(b.stage));
}

/**
 * Validate that fast bench results haven't regressed.
 *
 * @param results - Current run results
 * @param baselines - Previous known baselines (stage → min accuracy)
 * @returns List of regressions (empty = all pass)
 */
export function checkRegressions(
  results: readonly FastBenchResult[],
  baselines: ReadonlyMap<string, number>,
): string[] {
  const regressions: string[] = [];
  for (const r of results) {
    const baseline = baselines.get(r.stage);
    if (baseline !== undefined && r.accuracy < baseline) {
      regressions.push(`${r.stage}: accuracy ${r.accuracy} < baseline ${baseline}`);
    }
  }
  return regressions;
}
