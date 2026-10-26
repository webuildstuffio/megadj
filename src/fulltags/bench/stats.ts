/**
 * bench/stats.ts — statistical primitives for the v3 bench harness.
 *
 * Bootstrap 95% CIs, McNemar paired test, risk–coverage curves.
 * Pure math — no I/O, no DB, fully deterministic when seeded.
 *
 * Convention: minimum n per reported cell is 30. Smaller cells still
 * compute but the caller flags them `low-n`.
 */
import { round3, round4 } from "../../shared/leaf/fmt";
import type { BenchRow, BootstrapCI, McNemarResult, RiskCoveragePoint } from "./types";

/** Minimum sample size for a confident reported cell. */
export const MIN_N = 30;

// ---------------------------------------------------------------------------
// Seeded PRNG — Mulberry32 (deterministic, fast, 32-bit state)
// ---------------------------------------------------------------------------

/** Mulberry32 PRNG: returns a () => number in [0, 1). */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Bootstrap 95% CI
// ---------------------------------------------------------------------------

/**
 * Bootstrap 95% CI for an accuracy metric (fraction correct).
 *
 * @param correct — array of 0/1 per track
 * @param nResamples — default 1000
 * @param seed — PRNG seed for reproducibility
 * @returns BootstrapCI with percentile-based 95% interval
 */
export function bootstrapAccuracyCI(
  correct: readonly (0 | 1)[],
  nResamples = 1000,
  seed = 42,
): BootstrapCI {
  const n = correct.length;
  if (n === 0) {
    return { metric: "accuracy", estimate: 0, lo: 0, hi: 0, nResamples: 0 };
  }
  const estimate = correct.reduce<number>((s, v) => s + v, 0) / n;
  if (n < 2) {
    return { metric: "accuracy", estimate, lo: estimate, hi: estimate, nResamples: 0 };
  }
  const rng = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < nResamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += correct[Math.floor(rng() * n)]!;
    }
    means.push(sum / n);
  }
  const sorted = means.toSorted((a, b) => a - b);
  const lo = sorted[Math.floor(nResamples * 0.025)]!;
  const hi = sorted[Math.floor(nResamples * 0.975)]!;
  return {
    metric: "accuracy",
    estimate: round4(estimate),
    lo: round4(lo),
    hi: round4(hi),
    nResamples,
  };
}

/**
 * Generic bootstrap CI for any numeric metric computed from rows.
 * The `metricFn` receives a resampled array and returns the metric value.
 */
export function bootstrapCI(
  rows: readonly BenchRow[],
  metricFn: (sample: readonly BenchRow[]) => number,
  opts: { metric?: string; nResamples?: number; seed?: number } = {},
): BootstrapCI {
  const { metric = "metric", nResamples = 1000, seed = 42 } = opts;
  const n = rows.length;
  if (n === 0) {
    return { metric, estimate: 0, lo: 0, hi: 0, nResamples: 0 };
  }
  const estimate = metricFn(rows);
  if (n < 2) {
    return { metric, estimate, lo: estimate, hi: estimate, nResamples: 0 };
  }
  const rng = mulberry32(seed);
  const values: number[] = [];
  for (let r = 0; r < nResamples; r++) {
    const sample: BenchRow[] = [];
    for (let i = 0; i < n; i++) {
      sample.push(rows[Math.floor(rng() * n)]!);
    }
    values.push(metricFn(sample));
  }
  const vsorted = values.toSorted((a, b) => a - b);
  const lo = vsorted[Math.floor(nResamples * 0.025)]!;
  const hi = vsorted[Math.floor(nResamples * 0.975)]!;
  return { metric, estimate: round4(estimate), lo: round4(lo), hi: round4(hi), nResamples };
}

// ---------------------------------------------------------------------------
// McNemar's test (paired, continuity-corrected)
// ---------------------------------------------------------------------------

/**
 * McNemar's test for paired nominal data: do two classifiers disagree
 * significantly? Uses the continuity-corrected chi-squared form.
 *
 * @param rowsA — per-track outcomes from run A
 * @param rowsB — per-track outcomes from run B (same track set)
 * @returns McNemarResult with chi2, p-value, significance at α=0.05
 */
export function mcnemar(rowsA: readonly BenchRow[], rowsB: readonly BenchRow[]): McNemarResult {
  const mapA = new Map(rowsA.map((r) => [r.trackId, r.correct]));
  const mapB = new Map(rowsB.map((r) => [r.trackId, r.correct]));
  let b = 0; // A correct, B wrong
  let c = 0; // B correct, A wrong
  for (const [trackId, correctA] of mapA) {
    const correctB = mapB.get(trackId);
    if (correctB === undefined) continue;
    if (correctA === 1 && correctB === 0) b++;
    if (correctA === 0 && correctB === 1) c++;
  }
  const bc = b + c;
  if (bc === 0) {
    return { b, c, chi2: 0, p: 1, significant: false };
  }
  // Continuity-corrected: (|b-c| - 1)^2 / (b+c)
  const num = Math.max(0, Math.abs(b - c) - 1) ** 2;
  const chi2 = round3(num / bc);
  // p-value from chi-squared(1) survival: P(X > chi2)
  const p = round4(chi2SurvivalDf1(chi2));
  return { b, c, chi2, p, significant: p < 0.05 };
}

/**
 * Chi-squared survival function for df=1 (upper tail).
 * Uses the complementary error function approximation.
 * P(X > x) = erfc(sqrt(x/2)) for chi2 df=1.
 */
function chi2SurvivalDf1(x: number): number {
  if (x <= 0) return 1;
  return erfc(Math.sqrt(x / 2));
}

/**
 * Complementary error function approximation (Abramowitz & Stegun 7.1.26,
 * maximum error < 1.5e-7 — more than adequate for p-values).
 */
function erfc(x: number): number {
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const v = poly * Math.exp(-a * a);
  return x >= 0 ? v : 2 - v;
}

// ---------------------------------------------------------------------------
// Risk–coverage curve
// ---------------------------------------------------------------------------

/**
 * Build a risk–coverage curve from bench rows that carry confidence.
 * At each threshold τ, coverage = fraction above τ, accuracy = correctness
 * of covered tracks. Used to compare methods at equal coverage.
 *
 * @param rows — bench rows with conf (null conf treated as conf=0)
 * @param steps — number of threshold steps (default 20)
 */
export function riskCoverageCurve(rows: readonly BenchRow[], steps = 20): RiskCoveragePoint[] {
  if (rows.length === 0) return [];
  const sorted = rows.toSorted((a, b) => (b.conf ?? 0) - (a.conf ?? 0));
  const n = sorted.length;
  const points: RiskCoveragePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const threshold = round3(i / steps);
    const covered = sorted.filter((r) => (r.conf ?? 0) >= threshold);
    if (covered.length === 0) {
      points.push({ threshold, coverage: 0, accuracy: 0, n: 0 });
      continue;
    }
    const correct = covered.filter((r) => r.correct === 1).length;
    points.push({
      threshold,
      coverage: round3(covered.length / n),
      accuracy: round3(correct / covered.length),
      n: covered.length,
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Accuracy helpers
// ---------------------------------------------------------------------------

/** Simple accuracy: fraction of rows where correct === 1. */
export function accuracy(rows: readonly BenchRow[]): number {
  if (rows.length === 0) return 0;
  return round4(rows.filter((r) => r.correct === 1).length / rows.length);
}

/** Macro-F1 across classes (for genre). */
export function macroF1(rows: readonly BenchRow[]): number {
  const classes = new Set(rows.map((r) => r.truth));
  if (classes.size === 0) return 0;
  let sumF1 = 0;
  for (const cls of classes) {
    const tp = rows.filter((r) => r.truth === cls && r.pred === cls).length;
    const fp = rows.filter((r) => r.truth !== cls && r.pred === cls).length;
    const fn = rows.filter((r) => r.truth === cls && r.pred !== cls).length;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    sumF1 += f1;
  }
  return round4(sumF1 / classes.size);
}

/** Confusion matrix as a Map<truth, Map<pred, count>>. */
export function confusionMatrix(rows: readonly BenchRow[]): Map<string, Map<string, number>> {
  const mat = new Map<string, Map<string, number>>();
  for (const r of rows) {
    let row = mat.get(r.truth);
    if (!row) {
      row = new Map();
      mat.set(r.truth, row);
    }
    row.set(r.pred, (row.get(r.pred) ?? 0) + 1);
  }
  return mat;
}

/**
 * Expected Calibration Error (ECE) — binned, 10 bins.
 * For rows with conf: bin by confidence, measure |accuracy - mean_conf|
 * per bin, weight by bin size.
 */
export function ece(rows: readonly BenchRow[], nBins = 10): number {
  const withConf = rows.filter((r) => r.conf !== null);
  if (withConf.length === 0) return 0;
  const n = withConf.length;
  let totalError = 0;
  for (let b = 0; b < nBins; b++) {
    const lo = b / nBins;
    const hi = (b + 1) / nBins;
    const bin = withConf.filter(
      (r) => (r.conf ?? 0) >= lo && (r.conf ?? 0) < (b === nBins - 1 ? hi + 1 : hi),
    );
    if (bin.length === 0) continue;
    const binAcc = bin.filter((r) => r.correct === 1).length / bin.length;
    const binConf = bin.reduce((s, r) => s + (r.conf ?? 0), 0) / bin.length;
    totalError += (bin.length / n) * Math.abs(binAcc - binConf);
  }
  return round4(totalError);
}
