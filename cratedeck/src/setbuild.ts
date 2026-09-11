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
import { camelotOf, keyCompatScore } from "../shared/camelot";
import {
  SET_MINUTES_DEFAULT,
  SET_MINUTES_MAX,
  SET_MINUTES_MIN,
  SET_PRESET_DEFS,
  SET_PRESET_IDS,
  DEFAULT_SET_PRESET,
  type SetPresetDef,
  type SetPresetId,
} from "../shared/types";

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

// N80 energy-arc presets — DERIVED from the shared registry
// (shared/types.ts SET_PRESET_DEFS), never hand-copied: the route, the UI
// picker and this engine read the same table so a new preset lands
// everywhere at once. SetPresetDef is the shared interface.
export const SET_PRESETS: Record<SetPresetId, SetPresetDef> =
  Object.fromEntries(SET_PRESET_DEFS.map((p) => [p.id, p])) as Record<
    SetPresetId,
    SetPresetDef
  >;
export type { SetPresetDef, SetPresetId };
/** The preset type `buildSet` scores against (alias of the shared def —
 *  the old local `SetPreset` interface name, kept for callers). */
export type SetPreset = SetPresetDef;

/** Clamp + validate the setbuild query params in ONE place — the HTTP
 *  route, the MCP tool and any future caller share it. Minutes fall back
 *  to the default when missing/non-numeric and clamp to the documented
 *  range (a caller can't smuggle `minutes=99999` past the UI's input
 *  field); preset defaults when absent. `parseSetbuildQuery` distinguishes
 *  "absent" from "invalid": an unknown preset id is a caller bug and
 *  surfaces as an error string instead of silently re-scoring as peak. */
export function parseSetbuildQuery(params: {
  preset?: string | null;
  minutes?: string | number | null;
}): { preset: SetPresetId; minutes: number } | { error: string } {
  const presetRaw = params.preset?.trim();
  if (presetRaw) {
    if (!(SET_PRESET_IDS as string[]).includes(presetRaw))
      return {
        error: `unknown preset "${presetRaw}" — expected one of: ${SET_PRESET_IDS.join(", ")}`,
      };
  }
  const preset: SetPresetId = presetRaw
    ? (presetRaw as SetPresetId)
    : DEFAULT_SET_PRESET;

  const minutesRaw = params.minutes;
  if (minutesRaw === null || minutesRaw === undefined || minutesRaw === "") {
    return { preset, minutes: SET_MINUTES_DEFAULT };
  }
  const n =
    typeof minutesRaw === "number" ? minutesRaw : Number(String(minutesRaw));
  if (!Number.isFinite(n)) return { preset, minutes: SET_MINUTES_DEFAULT };
  return {
    preset,
    minutes: Math.min(
      SET_MINUTES_MAX,
      Math.max(SET_MINUTES_MIN, Math.round(n)),
    ),
  };
}

/** Key compat — re-exported from the shared Camelot SSOT so existing
 *  engine-callers (tests, future engines) keep one import point. */
export { camelotOf };

/** Camelot compatibility score 0..1 between two candidates. 1 = same wheel
 * position or the four classic moves (±1 number same letter, ±1 letter
 * same number). 0 = clash. Either side unparsable → neutral 0.5 (never
 * blocks, never helps). Thin wrapper over the shared keyCompatScore. */
export function keyScore(a: SetCandidate, b: SetCandidate): number {
  return keyCompatScore(camelotOf(a.key), camelotOf(b.key));
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
  openerId?: string | undefined;
}

// SetBuildStep + SetBuildResult (the wire shapes) are DEFINED in
// shared/types.ts — the engine imports them back so the HTTP route and
// the UI read the same contract with no drifting duplicate.
import type { SetBuildResult, SetBuildStep } from "../shared/types";
export type { SetBuildResult };

/** Candidate duration with the 5:00 assumption when unknown. Pure —
 *  module-level, not re-created per `buildSet` call (oxlint scoping). */
const candidateDuration = (c: SetCandidate): number => c.durationS ?? 300;

/** Greedy chain: score every remaining candidate for each next slot, take
 * the best. O(n²) — fine at archive scale (thousands), trivially testable.
 * Deterministic: ties break by (score, videoId) so the same input always
 * proposes the same set — the old `s > bestScore` scan kept the FIRST
 * candidate on ties, which made the chain silently depend on the pool's
 * `updated_at DESC` row order (re-ingesting reshuffled proposals). */
export function buildSet(input: SetBuildInput): SetBuildResult {
  const { candidates, preset, minutes } = input;
  const budget = minutes * 60;
  const pool = [...candidates];
  const excluded: SetBuildResult["excluded"] = [];
  const steps: SetBuildStep[] = [];

  const dur = candidateDuration;
  /** Running arc clock, mutated ONLY by `commit` right below (the linter's
   *  loop-condition analysis sees that mutation; the old indirect-mutate-
   *  inside-push shape needed a file-scoped rule-off). */
  let elapsed = 0;
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
  // (ties break by videoId — the opener pick must be deterministic too).
  // Only tracks WITH a beats-ledger BPM can anchor the chain: the old
  // arousal-only pick let one un-analyzed closest-fit track void the whole
  // proposal (`first.bpm === null` → everything excluded) even when the
  // rest of the pool was fully analyzed. A requested-but-unanalyzed
  // opener is excluded honestly and the arc still builds.
  let prev: SetCandidate | null = null;
  const opener =
    (input.openerId && pool.find((c) => c.videoId === input.openerId)) ||
    undefined;
  if (opener && opener.bpm === null) {
    excluded.push({
      videoId: opener.videoId,
      title: opener.title,
      reason: "requested opener has no beats-ledger BPM — run `megadj beats`",
    });
    pool.splice(pool.indexOf(opener), 1);
  }
  const startArousal = preset.arousal[0]! / 9;
  const first =
    opener && opener.bpm !== null
      ? opener
      : [...pool]
          .filter((c) => c.bpm !== null)
          .toSorted((a, b) => {
            const fa = Math.abs((a.arousal ?? 5) / 9 - startArousal);
            const fb = Math.abs((b.arousal ?? 5) / 9 - startArousal);
            return fa - fb || a.videoId.localeCompare(b.videoId);
          })[0];
  if (!first) {
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

  while (prev && pool.length) {
    const t = Math.min(1, elapsed / budget);
    let bestIdx = -1;
    let bestScore = -1;
    let bestId = "";
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i]!;
      const s = transitionScore(prev, c, preset, t);
      // strict > keeps scanning on ties; the (score, videoId) pair decides —
      // lexicographically-smaller id wins a tie, independent of row order
      if (s > bestScore || (s === bestScore && c.videoId < bestId)) {
        bestScore = s;
        bestIdx = i;
        bestId = c.videoId;
      }
    }
    if (bestIdx < 0 || bestScore <= 0) {
      // nothing mixable remains — the rest are excluded, not silently
      // dropped; the pool is drained HERE so the post-loop pass below
      // can't re-exclude the same tracks under "budget filled" (that
      // double-count shipped once: excluded_total 596 for 298 leftovers)
      for (const c of pool)
        excluded.push({
          videoId: c.videoId,
          title: c.title,
          reason:
            c.bpm === null
              ? "no beats-ledger BPM — run `megadj beats`"
              : "no compatible transition (key clash or tempo outside ±6%)",
        });
      pool.length = 0;
      break;
    }
    const next = pool[bestIdx]!;
    pool.splice(bestIdx, 1);
    push(next, bestScore);
    prev = next;
    // budget check AFTER the add — matches the old `elapsed < budget`
    // pre-condition (fill until exceeded), stated on a visibly-mutated
    // variable (elapsed is assigned by push() in this loop body).
    if (elapsed >= budget) break;
  }
  // leftovers when the budget filled (pool is empty if the loop exited
  // via the nothing-mixable branch — no double-exclusion)
  for (const c of pool)
    excluded.push({
      videoId: c.videoId,
      title: c.title,
      reason: "set budget filled",
    });

  return { preset: preset.id, minutes, steps, excluded };
}
