/**
 * calibration.ts — L2 genre calibration + τ threshold (B5.3).
 *
 * Temperature scaling on genre posterior probabilities:
 * - Fits a single temperature T on the calib split (AK3+AK4)
 * - Calibrated probabilities: softmax(logits / T)
 * - τ threshold chosen for ≥90% precision on the eval split
 * - ECE (Expected Calibration Error) target: ≤ 0.05
 *
 * The calibrator is fitted once per model version and stored as a
 * JSON config. Tracks below τ get "abstain" (no genre assigned).
 */
import { round3, round4 } from "../../shared/leaf/fmt";

/** A single track's genre posterior (from the estimator). */
export interface GenrePosterior {
  readonly trackId: string;
  readonly family: string;
  readonly probability: number;
  /** True family from answer key (for calibration/evaluation). */
  readonly truth?: string | undefined;
}

/** Calibration result. */
export interface CalibrationResult {
  /** Fitted temperature. */
  temperature: number;
  /** Chosen τ threshold for ≥90% precision. */
  tau: number;
  /** ECE before calibration. */
  eceBefore: number;
  /** ECE after calibration. */
  eceAfter: number;
  /** Precision at τ. */
  precisionAtTau: number;
  /** Coverage at τ (fraction of tracks above threshold). */
  coverageAtTau: number;
  /** Number of calibration samples. */
  nCalib: number;
}

/**
 * Apply temperature scaling to a set of probabilities.
 * For binary/argmax decisions, dividing logits by T spreads the
 * distribution: T > 1 = softer, T < 1 = sharper.
 *
 * Since we work in probability space (not logit space), we convert
 * p → log(p), scale, then softmax back.
 */
export function temperatureScale(probabilities: readonly number[], temperature: number): number[] {
  if (temperature <= 0) return [...probabilities];
  const logits = probabilities.map((p) => Math.log(Math.max(p, 1e-10)) / temperature);
  const maxLogit = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - maxLogit));
  const sumExp = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sumExp);
}

/**
 * Expected Calibration Error (ECE) with equal-width bins.
 * Measures how well predicted probabilities match empirical accuracy.
 */
export function expectedCalibrationError(
  predictions: readonly { probability: number; correct: boolean }[],
  nBins = 10,
): number {
  if (predictions.length === 0) return 0;
  const bins = Array.from({ length: nBins }, () => ({ sum: 0, correct: 0, count: 0 }));
  for (const p of predictions) {
    const binIdx = Math.min(Math.floor(p.probability * nBins), nBins - 1);
    const bin = bins[binIdx];
    if (bin === undefined) continue;
    bin.sum += p.probability;
    bin.correct += p.correct ? 1 : 0;
    bin.count++;
  }
  let ece = 0;
  for (const bin of bins) {
    if (bin.count === 0) continue;
    const avgConf = bin.sum / bin.count;
    const avgAcc = bin.correct / bin.count;
    ece += (bin.count / predictions.length) * Math.abs(avgAcc - avgConf);
  }
  return round4(ece);
}

/**
 * Find the temperature T that minimizes ECE on calibration data.
 * Simple grid search over [0.1, 5.0] with 0.05 step.
 */
export function fitTemperature(posteriors: readonly GenrePosterior[]): number {
  const withTruth = posteriors.filter((p) => p.truth !== undefined);
  if (withTruth.length === 0) return 1.0;

  let bestT = 1.0;
  let bestEce = Infinity;

  for (let t = 0.1; t <= 5.0; t += 0.05) {
    const scaled = withTruth.map((p) => ({
      probability: temperatureScale([p.probability, 1 - p.probability], t)[0]!,
      correct: p.family === p.truth,
    }));
    const ece = expectedCalibrationError(scaled);
    if (ece < bestEce) {
      bestEce = ece;
      bestT = round3(t);
    }
  }

  return bestT;
}

/**
 * Find the τ threshold that achieves ≥90% precision.
 * Searches from high to low threshold, picking the lowest τ
 * where precision is still ≥ target.
 */
export function findTauThreshold(
  posteriors: readonly GenrePosterior[],
  targetPrecision = 0.9,
  temperature = 1.0,
): { tau: number; precision: number; coverage: number } {
  const withTruth = posteriors.filter((p) => p.truth !== undefined);
  if (withTruth.length === 0) return { tau: 0.5, precision: 0, coverage: 0 };

  // Apply temperature
  const scaled = withTruth.map((p) => ({
    ...p,
    scaledProb: temperatureScale([p.probability, 1 - p.probability], temperature)[0]!,
  }));

  // Sort by threshold (descending) and find the lowest τ with ≥ target precision
  const thresholds = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3];

  let bestTau = 0.95;
  let bestPrecision = 0;
  let bestCoverage = 0;

  for (const tau of thresholds) {
    const above = scaled.filter((p) => p.scaledProb >= tau);
    if (above.length === 0) continue;
    const correct = above.filter((p) => p.family === p.truth).length;
    const precision = correct / above.length;
    const coverage = above.length / scaled.length;

    if (precision >= targetPrecision) {
      bestTau = tau;
      bestPrecision = round4(precision);
      bestCoverage = round4(coverage);
    }
  }

  return { tau: bestTau, precision: bestPrecision, coverage: bestCoverage };
}

/**
 * Full calibration pipeline: fit temperature, find τ, compute ECE.
 */
export function calibrateL2(
  posteriors: readonly GenrePosterior[],
  targetPrecision = 0.9,
): CalibrationResult {
  const withTruth = posteriors.filter((p) => p.truth !== undefined);
  if (withTruth.length === 0) {
    return {
      temperature: 1.0,
      tau: 0.5,
      eceBefore: 0,
      eceAfter: 0,
      precisionAtTau: 0,
      coverageAtTau: 0,
      nCalib: 0,
    };
  }

  // ECE before calibration
  const uncalibrated = withTruth.map((p) => ({
    probability: p.probability,
    correct: p.family === p.truth,
  }));
  const eceBefore = expectedCalibrationError(uncalibrated);

  // Fit temperature
  const temperature = fitTemperature(posteriors);

  // ECE after calibration
  const calibrated = withTruth.map((p) => ({
    probability: temperatureScale([p.probability, 1 - p.probability], temperature)[0]!,
    correct: p.family === p.truth,
  }));
  const eceAfter = expectedCalibrationError(calibrated);

  // Find τ
  const { tau, precision, coverage } = findTauThreshold(posteriors, targetPrecision, temperature);

  return {
    temperature,
    tau,
    eceBefore,
    eceAfter,
    precisionAtTau: precision,
    coverageAtTau: coverage,
    nCalib: withTruth.length,
  };
}
