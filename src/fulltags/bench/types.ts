/**
 * bench/types.ts — shared types for the FullTags v3 bench harness.
 *
 * The harness owns: run storage, per-track outcomes, answer keys, and
 * stage-level metrics. Everything here is pure data — no I/O, no DB.
 */

/** Stages the harness can measure (§1 rebench matrix). */
export type BenchStage =
  | "identity"
  | "version-match"
  | "bpm"
  | "grid"
  | "key"
  | "genre-l2"
  | "genre-l3"
  | "energy"
  | "mood"
  | "structure"
  | "similarity"
  | "sync"
  | "perf";

/** Eval/calibration split (§2 leakage rules). */
export type BenchSplit = "eval" | "calib";

/** One run's metadata row. */
export interface BenchRun {
  runId: string;
  stage: BenchStage;
  answerKey: string;
  split: BenchSplit;
  gitSha: string;
  configHash: string;
  n: number;
  /** Headline + secondary metrics, stage-specific. */
  metrics: Record<string, number | string | null>;
  /** Bootstrap 95% CIs keyed by metric name → [lo, hi]. */
  ci: Record<string, [number, number]> | null;
  createdAt: string;
}

/** One per-track outcome row (for paired tests). */
export interface BenchRow {
  runId: string;
  trackId: string;
  truth: string;
  pred: string;
  conf: number | null;
  correct: 0 | 1;
}

/** One answer-key entry. */
export interface AnswerKeyRow {
  keyId: string;
  trackId: string;
  field: string;
  value: string;
  confidence: number | null;
  sourceOfTruth: string;
  split: BenchSplit;
  evidence: string | null;
  createdAt: string;
}

/** A stage runner's output — the harness stores this. */
export interface StageResult {
  stage: BenchStage;
  answerKey: string;
  rows: BenchRow[];
  metrics: Record<string, number | string | null>;
  configHash: string;
}

/** Bootstrap CI result for one metric. */
export interface BootstrapCI {
  metric: string;
  estimate: number;
  lo: number;
  hi: number;
  nResamples: number;
}

/** McNemar test result for comparing two runs. */
export interface McNemarResult {
  /** Tracks correct in A but not B. */
  b: number;
  /** Tracks correct in B but not A. */
  c: number;
  /** Chi-squared statistic (continuity-corrected). */
  chi2: number;
  /** Two-sided p-value. */
  p: number;
  significant: boolean;
}

/** One point on a risk–coverage curve. */
export interface RiskCoveragePoint {
  /** Confidence threshold. */
  threshold: number;
  /** Fraction of tracks above the threshold. */
  coverage: number;
  /** Accuracy on the covered tracks. */
  accuracy: number;
  /** Number of tracks covered. */
  n: number;
}
