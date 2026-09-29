/**
 * key-challengers.ts — Key detector bake-off framework (B9.4).
 *
 * Compares key detection results from multiple analyzers against
 * GiantSteps Key answer keys (AK1). Uses MIREX scoring:
 * - Exact match: 1.0
 * - Perfect fifth: 0.5
 * - Relative major/minor: 0.3
 * - Parallel major/minor: 0.2
 * - Other: 0.0
 */
import { round3 } from "../../shared/leaf/fmt";

/** Traditional key → Camelot mapping. */
const KEY_TO_CAMELOT = new Map<string, string>([
  ["a minor", "8A"],
  ["a major", "11B"],
  ["a# minor", "3A"],
  ["a# major", "6B"],
  ["bb minor", "3A"],
  ["bb major", "6B"],
  ["b minor", "10A"],
  ["b major", "1B"],
  ["c minor", "5A"],
  ["c major", "8B"],
  ["c# minor", "12A"],
  ["c# major", "3B"],
  ["db minor", "12A"],
  ["db major", "3B"],
  ["d minor", "7A"],
  ["d major", "10B"],
  ["d# minor", "2A"],
  ["d# major", "5B"],
  ["eb minor", "2A"],
  ["eb major", "5B"],
  ["e minor", "9A"],
  ["e major", "12B"],
  ["f minor", "4A"],
  ["f major", "7B"],
  ["f# minor", "11A"],
  ["f# major", "2B"],
  ["gb minor", "11A"],
  ["gb major", "2B"],
  ["g minor", "6A"],
  ["g major", "9B"],
  ["g# minor", "1A"],
  ["g# major", "4B"],
  ["ab minor", "1A"],
  ["ab major", "4B"],
]);

/**
 * Normalize a key string to Camelot notation.
 */
export function toCamelot(key: string): string | null {
  const trimmed = key.trim();
  if (/^\d{1,2}[AB]$/i.test(trimmed)) return trimmed.toUpperCase();
  const cam = KEY_TO_CAMELOT.get(trimmed.toLowerCase());
  return cam ?? null;
}

/**
 * MIREX key scoring between two Camelot keys.
 */
export function mirexScore(predicted: string, expected: string): number {
  const pred = toCamelot(predicted);
  const exp = toCamelot(expected);
  if (pred === null || exp === null) return 0;
  if (pred === exp) return 1.0;

  const predNum = Number.parseInt(pred);
  const expNum = Number.parseInt(exp);
  const predMode = pred.slice(-1);
  const expMode = exp.slice(-1);

  // Perfect fifth: same mode, +7 semitones (Camelot +1)
  if (predMode === expMode) {
    const diff = (predNum - expNum + 12) % 12;
    if (diff === 1 || diff === 11) return 0.5;
  }

  // Relative major/minor: same number, different mode
  if (predNum === expNum && predMode !== expMode) return 0.3;

  // Parallel major/minor: same root, different mode
  // In Camelot: A→B or B→A with ±3 offset
  if (predMode !== expMode) {
    const offset = predMode === "A" ? 3 : -3;
    const adjusted = ((predNum + offset - 1 + 12) % 12) + 1;
    if (adjusted === expNum) return 0.2;
  }

  return 0;
}

/** Key detection result from one analyzer. */
export interface KeyDetectorResult {
  readonly trackId: string;
  readonly detectedKey: string;
  readonly confidence: number;
}

/** Bake-off result for one analyzer. */
export interface KeyBakeoffResult {
  readonly analyzer: string;
  readonly meanMirex: number;
  readonly exactAccuracy: number;
  readonly total: number;
  readonly fifthRate: number;
}

/**
 * Run a key bake-off: compare one analyzer's results against answer keys.
 */
export function keyBakeoff(
  analyzer: string,
  results: readonly KeyDetectorResult[],
  answerKeys: ReadonlyMap<string, string>,
): KeyBakeoffResult {
  let mirexSum = 0;
  let exact = 0;
  let fifths = 0;
  let matched = 0;

  for (const r of results) {
    const expected = answerKeys.get(r.trackId);
    if (expected === undefined) continue;
    matched++;
    const score = mirexScore(r.detectedKey, expected);
    mirexSum += score;
    if (score === 1.0) exact++;
    if (score === 0.5) fifths++;
  }

  return {
    analyzer,
    meanMirex: matched > 0 ? round3(mirexSum / matched) : 0,
    exactAccuracy: matched > 0 ? round3(exact / matched) : 0,
    total: matched,
    fifthRate: matched > 0 ? round3(fifths / matched) : 0,
  };
}
