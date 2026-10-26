/**
 * set-arc.ts — Per-bar energy curve → set arc descriptors (B7.4).
 *
 * Given per-bar LUFS values, computes set-arc descriptors that help
 * the DJ understand the energy journey of a track:
 * - Shape: buildup / drop / plateau / valley / rollercoaster
 * - Dynamic range: difference between loudest and quietest sections
 * - Inflection points: where energy changes direction significantly
 */
import { round3 } from "../../shared/leaf/fmt";

/** Set arc shape classification. */
export type ArcShape = "buildup" | "drop" | "plateau" | "valley" | "rollercoaster";

/** Arc descriptors for one track. */
export interface SetArcDescriptor {
  /** Overall shape classification. */
  readonly shape: ArcShape;
  /** Dynamic range in LUFS (max - min of smoothed curve). */
  readonly dynamicRange: number;
  /** Number of significant inflection points. */
  readonly inflections: number;
  /** Normalized energy curve (0–1, smoothed, one value per section). */
  readonly curve: readonly number[];
}

/**
 * Compute set arc descriptors from per-bar LUFS values.
 *
 * @param barLufs - Per-bar LUFS values (ordered)
 * @param windowSize - Smoothing window size (default: 4 bars)
 * @returns Arc descriptor, or null if insufficient bars
 */
export function computeSetArc(barLufs: readonly number[], windowSize = 4): SetArcDescriptor | null {
  if (barLufs.length < windowSize * 2) return null;

  // Smooth with moving average
  const smoothed: number[] = [];
  for (let i = 0; i <= barLufs.length - windowSize; i++) {
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      sum += barLufs[i + j]!;
    }
    smoothed.push(sum / windowSize);
  }

  // Normalize to 0–1
  const min = Math.min(...smoothed);
  const max = Math.max(...smoothed);
  const range = max - min;
  const normalized =
    range > 0 ? smoothed.map((v) => round3((v - min) / range)) : smoothed.map(() => 0.5);

  // Compute dynamic range
  const dynamicRange = round3(range);

  // Find inflection points (sign changes in derivative)
  let inflections = 0;
  let prevDirection = 0;
  for (let i = 1; i < normalized.length; i++) {
    const diff = normalized[i]! - normalized[i - 1]!;
    const direction = diff > 0.05 ? 1 : diff < -0.05 ? -1 : 0;
    if (direction !== 0 && direction !== prevDirection && prevDirection !== 0) {
      inflections++;
    }
    if (direction !== 0) prevDirection = direction;
  }

  // Classify shape
  const shape = classifyShape(normalized, inflections);

  return { shape, dynamicRange, inflections, curve: normalized };
}

/**
 * Classify the energy curve shape.
 */
function classifyShape(curve: readonly number[], inflections: number): ArcShape {
  if (curve.length < 2) return "plateau";
  if (inflections >= 4) return "rollercoaster";

  const firstQuarter = curve.slice(0, Math.floor(curve.length / 4));
  const lastQuarter = curve.slice(Math.floor((3 * curve.length) / 4));

  const avgFirst =
    firstQuarter.length > 0 ? firstQuarter.reduce((a, b) => a + b, 0) / firstQuarter.length : 0.5;
  const avgLast =
    lastQuarter.length > 0 ? lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length : 0.5;

  const diff = avgLast - avgFirst;
  if (diff > 0.2) return "buildup";
  if (diff < -0.2) return "drop";

  // Check for valley (dip in the middle)
  const midSection = curve.slice(Math.floor(curve.length / 4), Math.floor((3 * curve.length) / 4));
  const avgMid =
    midSection.length > 0 ? midSection.reduce((a, b) => a + b, 0) / midSection.length : 0.5;
  if (avgMid < avgFirst - 0.15 && avgMid < avgLast - 0.15) return "valley";

  return "plateau";
}
