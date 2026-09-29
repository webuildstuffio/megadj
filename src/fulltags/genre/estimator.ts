/**
 * estimator.ts — Genre estimator: wraps Dawid-Skene + calibration + L3 (B5.5).
 *
 * Single entry point that replaces the old vote-ladder for genre assignment.
 * The estimator is FLAGGED: `MEGADJ_GENRE_ESTIMATOR=1` enables it; default
 * is off (falls back to the legacy vote path).
 *
 * Pipeline:
 * 1. Load evidence rows from genre_evidence table
 * 2. Run Dawid-Skene EM → posteriors + annotator reliability
 * 3. Temperature-calibrate posteriors (fitTemperature + findTauThreshold)
 * 4. Rank L3 subgenres within elected family
 * 5. Gate: only write if calibrated confidence ≥ τ threshold
 */
import {
  dawidSkene,
  type Annotation,
  type DawidSkeneResult,
} from "./dawid-skene";
import { calibrateL2, type GenrePosterior } from "./calibration";
import { rankL3, type L3Evidence, type L3Ranked } from "./l3-rank";
import { GENRE_FAMILIES, type GenreFamily } from "./taxonomy-v3";

/** Whether the estimator is enabled. */
export function estimatorEnabled(): boolean {
  return process.env["MEGADJ_GENRE_ESTIMATOR"] === "1";
}

/** Estimator input for one track. */
export interface EstimatorInput {
  readonly trackId: string;
  readonly annotations: readonly Annotation[];
  /** Raw evidence for L3 ranking (richer than annotations). */
  readonly l3Evidence: readonly L3Evidence[];
}

/** Estimator output for one track. */
export interface EstimatorOutput {
  /** Elected L2 family (null if below τ threshold). */
  readonly family: GenreFamily | null;
  /** Calibrated posterior probability. */
  readonly probability: number;
  /** Whether the gate passed (probability ≥ τ). */
  readonly gated: boolean;
  /** L3 ranked subgenres (empty if family is null). */
  readonly l3: readonly L3Ranked[];
  /** Full Dawid-Skene result for diagnostics. */
  readonly dsResult: DawidSkeneResult;
  /** Temperature used for calibration. */
  readonly temperature: number;
  /** τ threshold for ≥90% precision. */
  readonly tau: number;
}

/** Batch estimator result. */
export interface EstimatorBatchResult {
  /** Per-track outputs (keyed by trackId). */
  readonly outputs: ReadonlyMap<string, EstimatorOutput>;
  /** Number of tracks that passed the gate. */
  readonly gatedCount: number;
  /** Number of tracks below the gate. */
  readonly ungatedCount: number;
}

/**
 * Run the genre estimator on a batch of tracks.
 *
 * @param inputs - Per-track evidence
 * @param targetPrecision - Minimum precision for the τ gate (default: 0.9)
 * @returns Batch result with per-track outputs
 */
export function estimateGenres(
  inputs: readonly EstimatorInput[],
  targetPrecision = 0.9,
): EstimatorBatchResult {
  if (inputs.length === 0) {
    return { outputs: new Map(), gatedCount: 0, ungatedCount: 0 };
  }

  // Collect all annotations
  const allAnnotations: Annotation[] = [];
  for (const input of inputs) {
    for (const a of input.annotations) {
      allAnnotations.push(a);
    }
  }

  // Run Dawid-Skene
  const dsResult = dawidSkene(allAnnotations, [...GENRE_FAMILIES]);

  // Build posteriors for calibration
  const posteriorInputs: GenrePosterior[] = dsResult.posteriors.map((p) => ({
    trackId: p.trackId,
    family: p.family,
    probability: p.probability,
  }));

  // Calibrate
  const calibration = calibrateL2(posteriorInputs, targetPrecision);

  // Build per-track outputs
  const outputs = new Map<string, EstimatorOutput>();
  let gatedCount = 0;
  let ungatedCount = 0;

  for (const input of inputs) {
    const posterior = dsResult.posteriors.find(
      (p) => p.trackId === input.trackId,
    );
    if (!posterior) {
      outputs.set(input.trackId, {
        family: null,
        probability: 0,
        gated: false,
        l3: [],
        dsResult,
        temperature: calibration.temperature,
        tau: calibration.tau,
      });
      ungatedCount++;
      continue;
    }

    const gated = posterior.probability >= calibration.tau;
    const family = gated ? (posterior.family as GenreFamily) : null;

    // L3 ranking
    const l3 =
      family !== null
        ? rankL3(family, posterior.probability, input.l3Evidence)
        : [];

    outputs.set(input.trackId, {
      family,
      probability: posterior.probability,
      gated,
      l3,
      dsResult,
      temperature: calibration.temperature,
      tau: calibration.tau,
    });

    if (gated) {
      gatedCount++;
    } else {
      ungatedCount++;
    }
  }

  return { outputs, gatedCount, ungatedCount };
}
