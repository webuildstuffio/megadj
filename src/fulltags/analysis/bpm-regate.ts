/**
 * bpm-regate.ts — Regate BPM + grid phase with tightened gates (B1.4).
 *
 * Regates existing BPM values against the bench answer keys and the
 * genre-aware octave fold. Tracks whose BPM is outside the expected
 * range for their genre family are flagged for re-analysis.
 *
 * Gate levels:
 * - PASS: BPM within ±1% of answer key (or genre-expected range)
 * - OCTAVE: BPM within octave fold of answer key (×2 or ÷2)
 * - FAIL: BPM outside all gates → re-analyze
 */
import { round3 } from "../../shared/leaf/fmt";

/** BPM gate verdict. */
export type BpmGateVerdict = "pass" | "octave" | "fail";

/** Regate result for one track. */
export interface BpmRegateResult {
  readonly trackId: string;
  readonly currentBpm: number;
  readonly expectedBpm: number | null;
  readonly genreFamily: string | null;
  readonly verdict: BpmGateVerdict;
  /** BPM error as percentage (absolute). */
  readonly errorPct: number;
  /** Whether this track needs re-analysis. */
  readonly needsReanalysis: boolean;
}

/** Genre-specific BPM ranges (for sanity gating). */
const GENRE_BPM_RANGES: ReadonlyMap<string, { min: number; max: number }> = new Map([
  ["house", { min: 118, max: 132 }],
  ["tech house", { min: 122, max: 132 }],
  ["techno", { min: 125, max: 150 }],
  ["trance", { min: 128, max: 145 }],
  ["drum and bass", { min: 160, max: 180 }],
  ["dubstep", { min: 138, max: 142 }],
  ["hip hop", { min: 70, max: 110 }],
  ["pop", { min: 90, max: 140 }],
  ["disco", { min: 110, max: 130 }],
  ["ambient", { min: 60, max: 120 }],
  ["downtempo", { min: 70, max: 110 }],
  ["hardstyle", { min: 148, max: 155 }],
  ["hardcore", { min: 160, max: 200 }],
  ["garage", { min: 128, max: 140 }],
  ["breakbeat", { min: 120, max: 140 }],
]);

/**
 * Gate a BPM value against an expected value.
 */
export function gateBpm(current: number, expected: number, tolerancePct = 1): BpmGateVerdict {
  const errorPct = (Math.abs(current - expected) / expected) * 100;
  if (errorPct <= tolerancePct) return "pass";

  // Check octave fold (×2 or ÷2)
  const doubled = expected * 2;
  const halved = expected / 2;
  const octaveErrorA = (Math.abs(current - doubled) / doubled) * 100;
  const octaveErrorB = (Math.abs(current - halved) / halved) * 100;
  if (octaveErrorA <= tolerancePct || octaveErrorB <= tolerancePct) return "octave";

  return "fail";
}

/**
 * Check if a BPM is within the genre-expected range.
 */
export function bpmInGenreRange(bpm: number, genreFamily: string | null): boolean {
  if (genreFamily === null) return true; // no genre = can't gate
  const range = GENRE_BPM_RANGES.get(genreFamily);
  if (range === undefined) return true; // unknown genre = can't gate
  return bpm >= range.min && bpm <= range.max;
}

/**
 * Regate a batch of tracks.
 *
 * @param tracks - Tracks with current BPM and genre
 * @param answerKeys - Answer key BPMs (trackId → BPM)
 * @returns Regate results
 */
export function regateBpm(
  tracks: readonly { trackId: string; bpm: number; genreFamily: string | null }[],
  answerKeys: ReadonlyMap<string, number>,
): BpmRegateResult[] {
  return tracks.map((t) => {
    const expected = answerKeys.get(t.trackId) ?? null;

    if (expected !== null) {
      const verdict = gateBpm(t.bpm, expected);
      const errorPct = round3((Math.abs(t.bpm - expected) / expected) * 100);
      return {
        trackId: t.trackId,
        currentBpm: t.bpm,
        expectedBpm: expected,
        genreFamily: t.genreFamily,
        verdict,
        errorPct,
        needsReanalysis: verdict === "fail",
      };
    }

    // No answer key — use genre range as sanity check
    const inRange = bpmInGenreRange(t.bpm, t.genreFamily);
    return {
      trackId: t.trackId,
      currentBpm: t.bpm,
      expectedBpm: null,
      genreFamily: t.genreFamily,
      verdict: inRange ? ("pass" as const) : ("fail" as const),
      errorPct: 0,
      needsReanalysis: !inRange,
    };
  });
}
