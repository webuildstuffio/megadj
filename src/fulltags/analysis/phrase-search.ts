/**
 * phrase-search.ts — Phrase-phase search from per-bar features (B8.1).
 *
 * Finds phrase boundaries in per-bar features using self-similarity.
 * A "phrase" is a repeating section (e.g. 8 or 16 bars) where the
 * spectral content repeats. Phrase boundaries are detected by finding
 * low-similarity transitions in the bar-to-bar similarity matrix.
 *
 * This is the foundation for WS8 structure detection.
 */
import { round3 } from "../../shared/leaf/fmt";

/** A detected phrase boundary. */
export interface PhraseBoundary {
  /** Bar index where the phrase starts. */
  readonly startBar: number;
  /** Bar index where the phrase ends. */
  readonly endBar: number;
  /** Length of the phrase in bars. */
  readonly lengthBars: number;
  /** Mean self-similarity within the phrase (0–1). */
  readonly internalSimilarity: number;
  /** Similarity drop at the boundary (negative = large drop = strong boundary). */
  readonly boundaryContrast: number;
}

/** Phrase search result. */
export interface PhraseSearchResult {
  /** Detected phrase boundaries. */
  readonly phrases: readonly PhraseBoundary[];
  /** Dominant phrase length in bars (mode of phrase lengths). */
  readonly dominantLength: number;
  /** Number of bars analyzed. */
  readonly totalBars: number;
}

/**
 * Compute cosine similarity between two float arrays.
 */
function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Search for phrase boundaries in per-bar feature vectors.
 *
 * @param barFeatures - Per-bar feature vectors (e.g. LUFS + onset density + spectral)
 * @param minPhraseLength - Minimum phrase length in bars (default: 4)
 * @param contrastThreshold - Minimum boundary contrast (default: 0.15)
 * @returns Phrase search result with detected boundaries
 */
export function searchPhrases(
  barFeatures: readonly (readonly number[])[],
  minPhraseLength = 4,
  contrastThreshold = 0.15,
): PhraseSearchResult {
  const n = barFeatures.length;
  if (n < minPhraseLength * 2) {
    return { phrases: [], dominantLength: 0, totalBars: n };
  }

  // Compute adjacent-bar similarity (novelty curve)
  const novelty: number[] = [];
  for (let i = 1; i < n; i++) {
    novelty.push(cosineSimilarity(barFeatures[i - 1]!, barFeatures[i]!));
  }

  // Find low-similarity points (phrase boundaries)
  const boundaries: number[] = [0]; // always start at bar 0
  for (let i = 1; i < novelty.length; i++) {
    const prev = novelty[i - 1] ?? 1;
    const curr = novelty[i]!;
    // A boundary is a local minimum with sufficient contrast
    if (prev - curr > contrastThreshold) {
      const lastBoundary = boundaries[boundaries.length - 1] ?? 0;
      if (i - lastBoundary >= minPhraseLength) {
        boundaries.push(i);
      }
    }
  }
  boundaries.push(n); // end boundary

  // Build phrases from boundaries
  const phrases: PhraseBoundary[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]!;
    const end = boundaries[i + 1]!;
    const length = end - start;
    if (length < minPhraseLength) continue;

    // Internal similarity: mean of adjacent similarities within the phrase
    let simSum = 0;
    let simCount = 0;
    for (let j = start; j < end - 1; j++) {
      if (j < novelty.length) {
        simSum += novelty[j]!;
        simCount++;
      }
    }
    const internalSim = simCount > 0 ? simSum / simCount : 0;

    // Boundary contrast at the end
    const contrast =
      end < novelty.length ? (novelty[end - 1] ?? 0) - (novelty[end] ?? 0) : 0;

    phrases.push({
      startBar: start,
      endBar: end,
      lengthBars: length,
      internalSimilarity: round3(internalSim),
      boundaryContrast: round3(contrast),
    });
  }

  // Dominant phrase length (mode)
  const lengthCounts = new Map<number, number>();
  for (const p of phrases) {
    lengthCounts.set(p.lengthBars, (lengthCounts.get(p.lengthBars) ?? 0) + 1);
  }
  let dominantLength = 0;
  let maxCount = 0;
  for (const [len, count] of lengthCounts) {
    if (count > maxCount) {
      dominantLength = len;
      maxCount = count;
    }
  }

  return { phrases, dominantLength, totalBars: n };
}
