/**
 * bench/runner.ts — the v3 bench harness orchestrator.
 *
 * Runs a stage against an answer key, computes metrics + CIs, stores the
 * result, and optionally compares two runs. Pure orchestration — the stage
 * implementations live in stages/*.ts; statistics in stats.ts.
 *
 * Commands (§3.1):
 *   bench run <stage> [--key AK1..AK5|all] [--split eval|calib] [--json]
 *   bench run all
 *   bench compare <runA> <runB>
 *   bench baseline freeze --tag <name>
 *   bench report [--since <tag>]
 */
import { spawnSync } from "node:child_process";
import type { Database } from "bun:sqlite";
import type { BenchRun, BenchSplit, BenchStage, StageResult } from "./types";
import {
  generateRunId,
  insertBenchRun,
  loadBenchRows,
  loadBenchRun,
  migrateBenchTables,
} from "./store";
import {
  accuracy,
  bootstrapAccuracyCI,
  mcnemar,
  riskCoverageCurve,
} from "./stats";

/** Stage runner function signature — each stages/<stage>.ts exports one. */
export type StageRunner = (
  db: Database,
  answerKey: string,
  split: BenchSplit,
) => StageResult;

/** Registry of stage runners. Populated by registerStage(). */
const STAGE_RUNNERS = new Map<BenchStage, StageRunner>();

/** Register a stage runner. Called from stages/*.ts at import time. */
export function registerStage(stage: BenchStage, runner: StageRunner): void {
  STAGE_RUNNERS.set(stage, runner);
}

/** Get the current git SHA (short form). */
function gitSha(): string {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  });
  return (result.stdout ?? "unknown").trim() || "unknown";
}

export interface RunOptions {
  db: Database;
  stage: BenchStage;
  answerKey?: string | undefined;
  split?: BenchSplit | undefined;
}

/**
 * Execute a bench run for one stage: run the stage runner, compute
 * metrics + bootstrap CIs, store the result, return the run.
 */
export function benchRun(opts: RunOptions): BenchRun {
  migrateBenchTables(opts.db);
  const stage = opts.stage;
  const runner = STAGE_RUNNERS.get(stage);
  if (!runner) {
    throw new Error(
      `no runner registered for stage "${stage}". Available: ${[...STAGE_RUNNERS.keys()].join(", ")}`,
    );
  }
  const answerKey = opts.answerKey ?? "all";
  const split = opts.split ?? "eval";
  const result = runner(opts.db, answerKey, split);
  const runId = generateRunId();
  const sha = gitSha();
  const rows = result.rows.map((r) => ({ ...r, runId }));
  const correct = rows.map((r) => r.correct);
  const ci = bootstrapAccuracyCI(correct);
  const ciRecord: Record<string, [number, number]> = {
    accuracy: [ci.lo, ci.hi],
  };
  const metrics: Record<string, number | string | null> = {
    accuracy: accuracy(rows),
    ...result.metrics,
  };
  if (rows.some((r) => r.conf !== null)) {
    const curve = riskCoverageCurve(rows);
    const p90 = curve.find((p) => p.accuracy >= 0.9 && p.n > 0);
    if (p90) {
      metrics.coverage_at_90pct = p90.coverage;
    }
  }
  const run: BenchRun = {
    runId,
    stage,
    answerKey,
    split,
    gitSha: sha,
    configHash: result.configHash,
    n: rows.length,
    metrics,
    ci: ciRecord,
    createdAt: new Date().toISOString(),
  };
  insertBenchRun(opts.db, run, rows);
  return run;
}

export interface CompareResult {
  runA: BenchRun;
  runB: BenchRun;
  mcnemar: ReturnType<typeof mcnemar>;
  accuracyDelta: number;
  /** Risk–coverage comparison at matched coverage points. */
  coverageDelta: { threshold: number; deltaAccuracy: number }[];
}

/**
 * Compare two runs: McNemar test + accuracy delta + risk-coverage delta.
 */
export function benchCompare(
  db: Database,
  runIdA: string,
  runIdB: string,
): CompareResult {
  migrateBenchTables(db);
  const runA = loadBenchRun(db, runIdA);
  const runB = loadBenchRun(db, runIdB);
  if (!runA) throw new Error(`run not found: ${runIdA}`);
  if (!runB) throw new Error(`run not found: ${runIdB}`);
  const rowsA = loadBenchRows(db, runIdA);
  const rowsB = loadBenchRows(db, runIdB);
  const mn = mcnemar(rowsA, rowsB);
  const accA = accuracy(rowsA);
  const accB = accuracy(rowsB);
  const curveA = riskCoverageCurve(rowsA);
  const curveB = riskCoverageCurve(rowsB);
  const coverageDelta = curveA.map((pa) => {
    const pb = curveB.find((p) => p.threshold === pa.threshold);
    return {
      threshold: pa.threshold,
      deltaAccuracy: pb ? pb.accuracy - pa.accuracy : 0,
    };
  });
  return {
    runA,
    runB,
    mcnemar: mn,
    accuracyDelta: accB - accA,
    coverageDelta,
  };
}

/**
 * Run all registered stages and return the runs.
 */
export function benchRunAll(
  db: Database,
  answerKey?: string,
  split?: BenchSplit,
): BenchRun[] {
  migrateBenchTables(db);
  const runs: BenchRun[] = [];
  for (const stage of STAGE_RUNNERS.keys()) {
    runs.push(benchRun({ db, stage, answerKey, split }));
  }
  return runs;
}

/** Get registered stage names. */
export function registeredStages(): BenchStage[] {
  return [...STAGE_RUNNERS.keys()];
}
