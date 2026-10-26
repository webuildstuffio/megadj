/**
 * maest-genre.ts — MAEST challenger on L3 genre (B9.2).
 *
 * Scaffolding for evaluating MAEST (Music Audio Efficient Spectrogram
 * Transformer) as an alternative genre classifier at L3 granularity.
 *
 * MAEST provides direct audio→genre predictions without needing
 * metadata from stores. This is valuable for tracks with no store hits.
 *
 * The actual model inference requires the ONNX runtime. This module
 * provides the evaluation harness and L3 mapping layer.
 */
import { round3 } from "../../shared/leaf/fmt";
import { mapToFamily, type GenreFamily } from "../genre/taxonomy-v3";

/** Raw MAEST prediction (400-class). */
export interface MaestPrediction {
  readonly label: string;
  readonly probability: number;
}

/** Mapped L3 result after taxonomy alignment. */
export interface MaestL3Result {
  readonly trackId: string;
  /** Top MAEST predictions (raw 400-class). */
  readonly topPredictions: readonly MaestPrediction[];
  /** Mapped L2 family (best). */
  readonly bestFamily: GenreFamily | null;
  /** Mapped L3 subgenre (best). */
  readonly bestSubgenre: string | null;
  /** Confidence of the best mapped prediction. */
  readonly confidence: number;
}

/**
 * Map MAEST 400-class predictions to our taxonomy.
 */
export function mapMaestPredictions(
  trackId: string,
  predictions: readonly MaestPrediction[],
  topK = 5,
): MaestL3Result {
  const top = predictions.toSorted((a, b) => b.probability - a.probability).slice(0, topK);

  let bestFamily: GenreFamily | null = null;
  let bestSubgenre: string | null = null;
  let bestConfidence = 0;

  for (const p of top) {
    const family = mapToFamily(p.label);
    if (family !== null && bestFamily === null) {
      bestFamily = family;
      bestSubgenre = p.label.toLowerCase();
      bestConfidence = p.probability;
    }
  }

  return {
    trackId,
    topPredictions: top.map((p) => ({ label: p.label, probability: round3(p.probability) })),
    bestFamily,
    bestSubgenre,
    confidence: round3(bestConfidence),
  };
}

/** MAEST evaluation result against ground truth. */
export interface MaestEvalResult {
  readonly totalTracks: number;
  readonly familyAccuracy: number;
  readonly topKFamilyAccuracy: number;
  readonly meanConfidence: number;
  readonly unmappedRate: number;
}

/**
 * Evaluate MAEST predictions against ground-truth genre families.
 */
export function evaluateMaest(
  results: readonly MaestL3Result[],
  groundTruth: ReadonlyMap<string, GenreFamily>,
): MaestEvalResult {
  if (results.length === 0) {
    return {
      totalTracks: 0,
      familyAccuracy: 0,
      topKFamilyAccuracy: 0,
      meanConfidence: 0,
      unmappedRate: 0,
    };
  }

  let familyCorrect = 0;
  let topKCorrect = 0;
  let confSum = 0;
  let unmapped = 0;
  let matched = 0;

  for (const r of results) {
    const gt = groundTruth.get(r.trackId);
    if (gt === undefined) continue;
    matched++;
    confSum += r.confidence;

    if (r.bestFamily === null) {
      unmapped++;
      continue;
    }

    if (r.bestFamily === gt) familyCorrect++;

    // Check if any top prediction maps to the correct family
    const topFamilies = r.topPredictions
      .map((p) => mapToFamily(p.label))
      .filter((f): f is GenreFamily => f !== null);
    if (topFamilies.includes(gt)) topKCorrect++;
  }

  return {
    totalTracks: matched,
    familyAccuracy: matched > 0 ? round3(familyCorrect / matched) : 0,
    topKFamilyAccuracy: matched > 0 ? round3(topKCorrect / matched) : 0,
    meanConfidence: matched > 0 ? round3(confSum / matched) : 0,
    unmappedRate: matched > 0 ? round3(unmapped / matched) : 0,
  };
}
