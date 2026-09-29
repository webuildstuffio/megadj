/**
 * edmformer.ts — EDMFormer baseline (B8.3).
 *
 * EDMFormer is a transformer-based EDM structure analyzer trained on
 * the edm98 dataset (98 annotated EDM tracks). It provides phrase-level
 * section predictions that can be compared against:
 * 1. Rekordbox PSSI labels (our current weak labels)
 * 2. Human-annotated section boundaries (answer keys)
 *
 * This module provides the evaluation framework comparing EDMFormer
 * predictions against PSSI sections from the section-classifier.
 */
import { round3 } from "../../shared/leaf/fmt";

/** EDMFormer section prediction. */
export interface EdmFormerSection {
  readonly startBar: number;
  readonly endBar: number;
  readonly label: string;
  readonly confidence: number;
}

/** Section comparison result. */
export interface SectionComparison {
  /** Boundary detection F1 (±1 bar tolerance). */
  readonly boundaryF1: number;
  /** Label agreement (given correct boundary). */
  readonly labelAccuracy: number;
  /** Over-segmentation rate (predicted more sections than truth). */
  readonly overSegRate: number;
  /** Under-segmentation rate. */
  readonly underSegRate: number;
}

/**
 * Compare predicted sections against ground truth.
 *
 * @param predicted - EDMFormer or PSSI predicted sections
 * @param truth - Ground truth sections (human-annotated or reference)
 * @param tolerance - Bar tolerance for boundary matching (default 1)
 */
export function compareSections(
  predicted: readonly { startBar: number; endBar: number; label: string }[],
  truth: readonly { startBar: number; endBar: number; label: string }[],
  tolerance = 1,
): SectionComparison {
  if (truth.length === 0 || predicted.length === 0) {
    return {
      boundaryF1: 0,
      labelAccuracy: 0,
      overSegRate: predicted.length > 0 ? 1 : 0,
      underSegRate: truth.length > 0 ? 1 : 0,
    };
  }

  // Boundary detection: check if predicted boundaries are within tolerance of truth
  const truthBoundaries = truth.map((s) => s.startBar);
  const predBoundaries = predicted.map((s) => s.startBar);

  let tp = 0;
  const matchedTruth = new Set<number>();
  for (const pb of predBoundaries) {
    for (let ti = 0; ti < truthBoundaries.length; ti++) {
      if (matchedTruth.has(ti)) continue;
      if (Math.abs(pb - truthBoundaries[ti]!) <= tolerance) {
        tp++;
        matchedTruth.add(ti);
        break;
      }
    }
  }

  const precision = predBoundaries.length > 0 ? tp / predBoundaries.length : 0;
  const recall = truthBoundaries.length > 0 ? tp / truthBoundaries.length : 0;
  const f1 =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

  // Label accuracy on matched boundaries
  let labelCorrect = 0;
  let labelTotal = 0;
  for (const p of predicted) {
    const match = truth.find(
      (t) => Math.abs(p.startBar - t.startBar) <= tolerance,
    );
    if (match !== undefined) {
      labelTotal++;
      if (normalizeLabel(p.label) === normalizeLabel(match.label))
        labelCorrect++;
    }
  }

  const overSeg =
    predicted.length > truth.length
      ? round3((predicted.length - truth.length) / truth.length)
      : 0;
  const underSeg =
    predicted.length < truth.length
      ? round3((truth.length - predicted.length) / truth.length)
      : 0;

  return {
    boundaryF1: round3(f1),
    labelAccuracy: labelTotal > 0 ? round3(labelCorrect / labelTotal) : 0,
    overSegRate: overSeg,
    underSegRate: underSeg,
  };
}

/** Normalize section labels for comparison. */
function normalizeLabel(label: string): string {
  const norm = label.toLowerCase().trim();
  const aliases: Record<string, string> = {
    chorus: "drop",
    peak: "drop",
    buildup: "buildup",
    up: "buildup",
    breakdown: "breakdown",
    down: "breakdown",
  };
  return aliases[norm] ?? norm;
}
