// setbuild.ts — M66 set-builder copilot: a PROPOSE-ONLY pure engine.
//
// Input: the archive's measured data (beats ledger BPM, mood ledger
// valence/arousal/dance, file TKEY via fulltags' ground-truth readers,
// track durations). Output: an ordered chain of tracks that respects
// Camelot key compatibility, a BPM window, and an energy arc from N80's
// presets. Nothing is written anywhere — proposals only (the roadmap's
// write gates don't apply; this touches no tags, no drives).
//
// Same shape as fleet.ts: pure functions in, plain data out, no I/O —
// the API route / MCP tool / UI feed it and render it.

export interface SetCandidate {
  videoId: string;
  title: string | null;
  artist: string | null;
  durationS: number | null;
  /** Folded BPM from the beats ledger — null = not analyzed (excluded). */
  bpm: number | null;
  /** Camelot or open key from the file's TKEY ("8A", "8a", "Am", …). */
  key: string | null;
  /** Mood-ledger axes (1–9 valence/arousal, 0–1 dance). */
  valence: number | null;
  arousal: number | null;
  dance: number | null;
}

export interface SetPreset {
  id: "warmup" | "peak" | "afterhours";
  label: string;
  description: string;
  /** arousal envelope [start, end] on the 1–9 scale. */
  arousal: [number, number];
  /** danceability envelope [start, end] on the 0–1 scale. */
  dance: [number, number];
}

/** N80 energy-arc presets — designed to feed exactly this engine. */
export const SET_PRESETS: Record<SetPreset["id"], SetPreset> = {
  warmup: {
    id: "warmup",
    label: "Warm-up",
    description: "Slow-burn opener arc — builds gently into the night.",
    arousal: [2.5, 5.5],
    dance: [0.4, 0.7],
  },
  peak: {
    id: "peak",
    label: "Peak time",
    description: "High energy throughout, slight lift toward the end.",
    arousal: [6, 8.5],
    dance: [0.7, 0.95],
  },
  afterhours: {
    id: "afterhours",
    label: "After hours",
    description: "Starts deep and hypnotic, drifts darker and slower.",
    arousal: [5, 3],
    dance: [0.75, 0.6],
  },
};

/** Camelot wheel position of a key string. Accepts "8A", "8a", "8B" and
 * common open-key names ("Am", "C") by mapping through the standard
 * open-key-to-Camelot table. Returns null when unparsable — unparsable
 * keys never block the chain (they just lose key-score). */
export function camelotOf(
  key: string | null,
): { n: number; letter: "A" | "B" } | null {
  if (!key) return null;
  const m = /^([1-9]|1[0-2])\s*([ABab])$/.exec(key.trim());
  if (m)
    return { n: parseInt(m[1]!, 10), letter: m[2]!.toUpperCase() as "A" | "B" };
  const OPEN: Record<string, [number, "A" | "B"]> = {
    "A#m": [1, "B"],
    Ab: [1, "A"],
    B: [1, "B"],
    Bb: [6, "B"],
    Bbm: [3, "A"],
    C: [8, "B"],
    "C#": [12, "B"],
    "C#m": [12, "A"],
    Cm: [5, "A"],
    Db: [3, "B"],
    D: [10, "B"],
    Dm: [7, "A"],
    Eb: [9, "B"],
    Ebm: [2, "A"],
    E: [12, "B"],
    Em: [9, "A"],
    F: [11, "B"],
    "F#": [7, "B"],
    "F#m": [11, "A"],
    Fm: [4, "A"],
    G: [9, "B"],
    "G#m": [6, "A"],
    Gb: [2, "B"],
    Gbm: [2, "A"],
    Gm: [6, "A"],
    A: [11, "B"],
    Am: [8, "A"],
  };
  const hit = OPEN[key.trim()];
  return hit ? { n: hit[0], letter: hit[1] } : null;
}

/** Camelot compatibility score 0..1: 1 = same wheel position or the four
 * classic moves (±1 number same letter, ±1 letter same number). 0 = clash.
 * Either side unparsable → neutral 0.5 (never blocks, never helps). */
export function keyScore(a: SetCandidate, b: SetCandidate): number {
  const ka = camelotOf(a.key);
  const kb = camelotOf(b.key);
  if (!ka || !kb) return 0.5;
  if (ka.n === kb.n && ka.letter === kb.letter) return 1; // same key
  if (ka.letter === kb.letter && Math.abs(ka.n - kb.n) === 1) return 1; // energy flow
  if (ka.n === kb.n && ka.letter !== kb.letter) return 1; // mood lift
  if (Math.abs(ka.n - kb.n) === 1 && ka.letter !== kb.letter) return 0.9; // diagonal
  return 0; // clash
}

/** Tempo compatibility 0..1: 1 within ±2%, linearly down to 0 at ±6% —
 * the classic DJ mixability window. */
export function bpmScore(a: number, b: number): number {
  const d = Math.abs(a - b) / Math.max(a, b);
  if (d <= 0.02) return 1;
  if (d >= 0.06) return 0;
  return 1 - (d - 0.02) / 0.04;
}

/** Arc position 0..1 → target arousal/dance for the preset (lerp). */
function envelope(p: [number, number], t: number): number {
  return p[0]! + (p[1]! - p[0]!) * t;
}

/** Transition score: how well does candidate `c` continue FROM `prev`
 * given the arc position `t` (0..1)? Key + tempo are hard-ish filters,
 * energy fit is a soft bonus. */
function transitionScore(
  prev: SetCandidate,
  c: SetCandidate,
  preset: SetPreset,
  t: number,
): number {
  if (prev.bpm === null || c.bpm === null) return -1; // unmixable: no tempo
  const tempo = bpmScore(prev.bpm, c.bpm);
  if (tempo === 0) return -1;
  const key = keyScore(prev, c);
  if (key === 0) return -1;
  // energy fit: distance from the preset's target at this arc position
  const targetArousal = envelope(preset.arousal, t);
  const targetDance = envelope(preset.dance, t);
  const a = (c.arousal ?? 5) / 9;
  const d = c.dance ?? 0.6;
  const fit =
    1 -
    Math.min(
      1,
      (Math.abs(a - targetArousal / 9) + Math.abs(d - targetDance)) / 2,
    );
  return 0.45 * tempo + 0.3 * key + 0.25 * fit;
}

export interface SetBuildInput {
  candidates: SetCandidate[];
  preset: SetPreset;
  /** Target set length in minutes; picks tracks until the budget fills. */
  minutes: number;
  /** Optional fixed opener (its videoId) — the arc starts from it. */
  openerId?: string;
}

export interface SetBuildInput {
  candidates: SetCandidate[];
  preset: SetPreset;
  /** Target set length in minutes; picks tracks until the budget fills. */
  minutes: number;
  /** Optional fixed opener (its videoId) — the arc starts from it. */
  openerId?: string;
}

// SetBuildStep + SetBuildResult (the wire shapes) are DEFINED in
// shared/types.ts — the engine imports them back so the HTTP route and
// the UI read the same contract with no drifting duplicate.
import type { SetBuildResult, SetBuildStep } from "../shared/types";
export type { SetBuildResult };

/** Greedy chain: score every remaining candidate for each next slot, take
 * the best. O(n²) — fine at archive scale (thousands), trivially testable.
 * Deterministic: ties break by (score, videoId) so the same input always
 * proposes the same set. */
export function buildSet(input: SetBuildInput): SetBuildResult {
  const { candidates, preset, minutes } = input;
  const budget = minutes * 60;
  const pool = [...candidates];
  const excluded: SetBuildResult["excluded"] = [];
  const steps: SetBuildStep[] = [];
  let elapsed = 0;

  const dur = (c: SetCandidate): number => c.durationS ?? 300; // assume 5:00 when unknown
  const push = (c: SetCandidate, transition: number | null): void => {
    elapsed += dur(c);
    steps.push({
      videoId: c.videoId,
      title: c.title,
      artist: c.artist,
      bpm: c.bpm,
      key: c.key,
      arousal: c.arousal,
      atMin: Math.round((elapsed / 60) * 10) / 10,
      transition:
        transition === null ? null : Math.round(transition * 1000) / 1000,
    });
  };

  // opener: requested id, else the candidate closest to the arc's start
  let prev: SetCandidate | null = null;
  const opener =
    (input.openerId && pool.find((c) => c.videoId === input.openerId)) ||
    undefined;
  const startArousal = preset.arousal[0]! / 9;
  const first =
    opener ??
    [...pool].sort((a, b) => {
      const fa = Math.abs((a.arousal ?? 5) / 9 - startArousal);
      const fb = Math.abs((b.arousal ?? 5) / 9 - startArousal);
      return fa - fb || a.videoId.localeCompare(b.videoId);
    })[0];
  if (!first || first.bpm === null) {
    return {
      preset: preset.id,
      minutes,
      steps: [],
      excluded: pool.map((c) => ({
        videoId: c.videoId,
        title: c.title,
        reason: "no beats-ledger BPM — run `megadj beats`",
      })),
    };
  }
  pool.splice(pool.indexOf(first), 1);
  push(first, null);
  prev = first;

  while (prev && elapsed < budget && pool.length) {
    const t = Math.min(1, elapsed / budget);
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
      const s = transitionScore(prev!, pool[i]!, preset, t);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestScore <= 0) {
      // nothing mixable remains — the rest are excluded, not silently dropped
      for (const c of pool)
        excluded.push({
          videoId: c.videoId,
          title: c.title,
          reason: "no compatible transition (key clash or tempo outside ±6%)",
        });
      break;
    }
    const next = pool[bestIdx]!;
    pool.splice(bestIdx, 1);
    push(next, bestScore);
    prev = next;
  }
  // leftovers when the budget filled
  for (const c of pool)
    excluded.push({
      videoId: c.videoId,
      title: c.title,
      reason: "set budget filled",
    });

  return { preset: preset.id, minutes, steps, excluded };
}
