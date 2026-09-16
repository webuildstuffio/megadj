// megaset.ts — the set-builder copilot: a PROPOSE-ONLY pure engine.
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
export { camelotOf } from "../shared/camelot";
export type { MegasetPresetDef, MegasetPresetId } from "../shared/types";
import {
  DEFAULT_MEGASET_PRESET,
  isMegasetSearchOverride,
  MEGASET_BEAM_POOL_MAX,
  MEGASET_BEAM_WIDTH,
  MEGASET_MINUTES_DEFAULT,
  MEGASET_MINUTES_MAX,
  MEGASET_MINUTES_MIN,
  MEGASET_PRESET_DEFS,
  MEGASET_PRESET_IDS,
  MEGASET_TEMPO_PERFECT,
  MEGASET_TEMPO_WINDOW,
  MEGASET_TRANSITION_WEIGHTS,
  MEGASET_TRACK_MINUTES_MAX,
  MEGASET_TRACK_MINUTES_MIN,
  type MegasetPresetDef,
  type MegasetPresetId,
  type MegasetResult,
  type MegasetStep,
  type SetSearchOverride,
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
// (shared/types.ts MEGASET_PRESET_DEFS), never hand-copied: the route, the UI
// picker and this engine read the same table so a new preset lands
// everywhere at once. MegasetPresetDef is the shared interface.
export const SET_PRESETS: Record<MegasetPresetId, MegasetPresetDef> =
  Object.fromEntries(MEGASET_PRESET_DEFS.map((p) => [p.id, p])) as Record<
    MegasetPresetId,
    MegasetPresetDef
  >;
/** The preset type `buildMegaset` scores against (alias of the shared def —
 *  the old local `SetPreset` interface name, kept for callers). */
export type SetPreset = MegasetPresetDef;

/** Clamp + validate the megaset query params in ONE place — the HTTP
 *  route, the MCP tool and any future caller share it. Minutes fall back
 *  to the default when missing/non-numeric and clamp to the documented
 *  range (a caller can't smuggle `minutes=99999` past the UI's input
 *  field); preset defaults when absent. `parseMegasetQuery` distinguishes
 *  "absent" from "invalid": an unknown preset id is a caller bug and
 *  surfaces as an error string instead of silently re-scoring as peak. */
export function parseMegasetQuery(params: {
  preset?: string | null;
  minutes?: string | number | null;
}): { preset: MegasetPresetId; minutes: number } | { error: string } {
  const presetRaw = params.preset?.trim();
  if (presetRaw) {
    if (!(MEGASET_PRESET_IDS as string[]).includes(presetRaw))
      return {
        error: `unknown preset "${presetRaw}" — expected one of: ${MEGASET_PRESET_IDS.join(", ")}`,
      };
  }
  const preset: MegasetPresetId = presetRaw
    ? (presetRaw as MegasetPresetId)
    : DEFAULT_MEGASET_PRESET;

  const minutesRaw = params.minutes;
  if (minutesRaw === null || minutesRaw === undefined || minutesRaw === "") {
    return { preset, minutes: MEGASET_MINUTES_DEFAULT };
  }
  const n =
    typeof minutesRaw === "number" ? minutesRaw : Number(String(minutesRaw));
  if (!Number.isFinite(n)) return { preset, minutes: MEGASET_MINUTES_DEFAULT };
  return {
    preset,
    minutes: Math.min(
      MEGASET_MINUTES_MAX,
      Math.max(MEGASET_MINUTES_MIN, Math.round(n)),
    ),
  };
}

/** Key compat — re-exported from the shared Camelot SSOT so existing
 *  engine-callers (tests, future engines) keep one import point. */

/** Camelot compatibility score 0..1 between two candidates. 1 = same wheel
 * position or the four classic moves (±1 number same letter, ±1 letter
 * same number). 0 = clash. Either side unparsable → neutral 0.5 (never
 * blocks, never helps). Thin wrapper over the shared keyCompatScore. */
export function keyScore(a: SetCandidate, b: SetCandidate): number {
  return keyCompatScore(camelotOf(a.key), camelotOf(b.key));
}

/** Tempo compatibility 0..1: 1 within ±MEGASET_TEMPO_PERFECT, linearly down to
 *  0 at ±MEGASET_TEMPO_WINDOW — the classic DJ mixability window. The bounds
 *  live in the shared registry so every surface quotes the same numbers. */
export function bpmScore(a: number, b: number): number {
  const d = Math.abs(a - b) / Math.max(a, b);
  if (d <= MEGASET_TEMPO_PERFECT) return 1;
  if (d >= MEGASET_TEMPO_WINDOW) return 0;
  return (
    1 -
    (d - MEGASET_TEMPO_PERFECT) / (MEGASET_TEMPO_WINDOW - MEGASET_TEMPO_PERFECT)
  );
}

/** A BPM the engine can actually mix with: present, finite and positive.
 * The beats ledger can carry placeholder rows (0 or NaN) from aborted
 * analysis runs — those are NOT tempos, and gating only on `!== null` let
 * a 0-BPM row be picked as opener and instantly dead-end the chain. */
const mixableBpm = (c: SetCandidate): c is SetCandidate & { bpm: number } =>
  c.bpm !== null && Number.isFinite(c.bpm) && c.bpm > 0;

/** First sorted index whose value is strictly greater than `target`. */
function upperBound(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (sorted[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First sorted index whose value is greater than or equal to `target`. */
function lowerBound(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (sorted[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Arc position 0..1 → target arousal/dance for the preset (lerp). */
function envelope(p: readonly [number, number], t: number): number {
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
  if (!mixableBpm(prev) || !mixableBpm(c)) return -1; // unmixable: no tempo
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
  return (
    MEGASET_TRANSITION_WEIGHTS.tempo * tempo +
    MEGASET_TRANSITION_WEIGHTS.key * key +
    MEGASET_TRANSITION_WEIGHTS.arcFit * fit
  );
}

export interface MegasetInput {
  candidates: SetCandidate[];
  preset: SetPreset;
  /** Target set length in minutes; picks tracks until the budget fills. */
  minutes: number;
  /** Optional fixed opener (its videoId) — the arc starts from it. */
  openerId?: string | undefined;
  /** Override the automatic greedy/beam strategy pick (pool-size rule).
   *  Test + A/B-compare hook: the N-candidates mode needs to build the
   *  same pool under both searches to diff them honestly. Production
   *  surfaces never set it — the pool-size rule decides. */
  searchOverride?: SetSearchOverride | undefined;
}

// MegasetStep + MegasetResult (the wire shapes) are DEFINED in
// shared/types.ts — the engine imports them back so the HTTP route and
// the UI read the same contract with no drifting duplicate.

/** Candidate duration with the 5:00 assumption when unknown. Pure —
 *  module-level, not re-created per `buildMegaset` call (oxlint scoping). */
const candidateDuration = (c: SetCandidate): number => {
  const seconds = c.durationS;
  return seconds !== null && Number.isFinite(seconds) && seconds > 0
    ? seconds
    : 300;
};

/** Set-runtime precision shared by step clocks and the result summary. */
const minutesAt = (seconds: number): number =>
  Math.round((seconds / 60) * 10) / 10;

/** One committed proposal slot: the candidate plus the transition score
 *  INTO it (null for the opener). Selection functions return these; the
 *  single commit loop in buildMegaset turns them into wire steps. */
interface PickedStep {
  candidate: SetCandidate;
  transition: number | null;
}

/** Why the chain stopped. "budget" = time target filled (leftovers are
 *  excluded as "set budget filled"); "deadend" = nothing compatible
 *  remained (leftovers keep the no-transition/no-BPM reasons);
 *  "exhausted" = pool fully consumed (no leftovers to explain). */
type StopCause = "budget" | "deadend" | "exhausted";

/** Beam-search state: one partial chain with its running clock and score.
 *  Module scope so the ranking helper stays pure (oxlint scoping). */
interface BeamState {
  chain: SetCandidate[];
  transitions: (number | null)[];
  elapsedS: number;
  score: number;
  /** Budget filled — terminal by completion, not by dead end. */
  done: boolean;
}

/** Deterministic state signature for tie-breaks (never pool row order). */
const chainSignature = (chain: readonly { videoId: string }[]): string =>
  chain.map((c) => c.videoId).join(">");

/** Best-state ranking: prefer budget-complete chains first, then score,
 *  chain length, then signature for deterministic tie-breaks.
 *  Returns < 0 when `a` ranks before `b`. Used by frontier + final pick. */
const rankBeamState = (a: BeamState, b: BeamState): number =>
  (b.done ? 1 : 0) - (a.done ? 1 : 0) ||
  b.score - a.score ||
  b.chain.length - a.chain.length ||
  chainSignature(a.chain).localeCompare(chainSignature(b.chain));

/** Greedy chain (the shipped sequencer): score every remaining candidate
 *  for each next slot, take the best. O(n²) — fine at archive scale.
 *  Deterministic: ties break by (score, videoId) so the same input always
 *  proposes the same set — the old `s > bestScore` scan kept the FIRST
 *  candidate on ties, which made the chain silently depend on the pool's
 *  `updated_at DESC` row order (re-ingesting reshuffled proposals). */
const greedyChain = (
  opener: SetCandidate,
  rest: readonly SetCandidate[],
  preset: SetPreset,
  budget: number,
): { chain: PickedStep[]; stopCause: StopCause } => {
  const remaining = [...rest];
  const chain: PickedStep[] = [{ candidate: opener, transition: null }];
  let elapsedS = candidateDuration(opener);
  while (remaining.length > 0 && elapsedS < budget) {
    const last = chain.at(-1)!.candidate;
    const t = Math.min(1, elapsedS / budget);
    let bestIdx = -1;
    let bestScore = -1;
    let bestId = "";
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i]!;
      const s = transitionScore(last, c, preset, t);
      // strict > keeps scanning on ties; the (score, videoId) pair decides —
      // lexicographically-smaller id wins a tie, independent of row order
      if (s > bestScore || (s === bestScore && c.videoId < bestId)) {
        bestScore = s;
        bestIdx = i;
        bestId = c.videoId;
      }
    }
    if (bestIdx < 0 || bestScore <= 0) return { chain, stopCause: "deadend" };
    const next = remaining.splice(bestIdx, 1)[0]!;
    chain.push({ candidate: next, transition: bestScore });
    elapsedS += candidateDuration(next);
  }
  return {
    chain,
    stopCause: elapsedS >= budget ? "budget" : "exhausted",
  };
};

/** Beam continuation (the E7 fix, docs/set/04-sequencing-benchmarks.md):
 *  keep the best MEGASET_BEAM_WIDTH partial chains per slot instead of one.
 *  Sparse pools (one genre family, pinned opener, heavy exclusions)
 *  dead-end greedy ~59% short of the best chain because a locally-best
 *  step can be globally fatal — a doomed branch dies while alternatives
 *  survive. Deterministic: states rank by rankBeamState, never row order.
 *  Cost ≈ width × pool per slot — ~0 ms at the ≤250-track pools that
 *  trigger it. Returns the BEST chain built, budget-filled or not: a
 *  partial chain that dies at slot k still beats a lone opener (the old
 *  inline greedy kept its partial too — parity of honesty, not regression). */
const beamChain = (
  opener: SetCandidate,
  rest: readonly SetCandidate[],
  preset: SetPreset,
  budget: number,
): { chain: PickedStep[]; stopCause: StopCause } => {
  const openerElapsed = candidateDuration(opener);
  const start: BeamState = {
    chain: [opener],
    transitions: [null],
    elapsedS: openerElapsed,
    score: 0,
    done: openerElapsed >= budget,
  };
  let best = start;
  let frontier: BeamState[] = [start];
  while (frontier.length > 0) {
    const frontierNext: BeamState[] = [];
    for (const st of frontier) {
      if (st.done) continue; // filled: terminal, kept in `best`
      const last = st.chain.at(-1)!;
      const t = Math.min(1, st.elapsedS / budget);
      for (const c of rest) {
        if (st.chain.includes(c)) continue;
        const s = transitionScore(last, c, preset, t);
        if (s <= 0) continue; // gated out — not a branch, a wall
        const elapsedS = st.elapsedS + candidateDuration(c);
        const next: BeamState = {
          chain: [...st.chain, c],
          transitions: [...st.transitions, s],
          elapsedS,
          score: st.score + s,
          done: elapsedS >= budget,
        };
        if (!next.done) frontierNext.push(next);
        if (rankBeamState(next, best) < 0) best = next;
      }
    }
    if (frontierNext.length === 0) break; // every live branch hit a wall
    frontierNext.sort(rankBeamState);
    frontier = frontierNext.slice(0, MEGASET_BEAM_WIDTH);
  }
  // `best` is the highest-ranked chain reached (completed = filled budget
  // mid-search; otherwise the deepest/partial leader at the final wall).
  // Completed chains mean the budget filled; an un-completed best means
  // the pool could not fill it — a real shortfall, reported honestly.
  const stopCause: StopCause = best.done ? "budget" : "deadend";
  return toPicked(best, stopCause);
};

/** Beam state → committable picked chain (the wire shape minus census). */
function toPicked(
  st: BeamState,
  stopCause: StopCause,
): { chain: PickedStep[]; stopCause: StopCause } {
  return {
    chain: st.chain.map((candidate, i) => ({
      candidate,
      transition: st.transitions[i] ?? null,
    })),
    stopCause,
  };
}

export function buildMegaset(input: MegasetInput): MegasetResult {
  const { candidates, preset, minutes } = input;
  const budget = minutes * 60;
  const excluded: MegasetResult["excluded"] = [];
  const steps: MegasetStep[] = [];

  const dur = candidateDuration;
  const requestedOpenerExists =
    input.openerId !== undefined &&
    candidates.some((candidate) => candidate.videoId === input.openerId);
  const pool = candidates.filter((candidate) => {
    const duration = dur(candidate);
    if (duration < MEGASET_TRACK_MINUTES_MIN * 60) {
      excluded.push({
        videoId: candidate.videoId,
        title: candidate.title,
        reason: `${Math.round(duration)}-second audio sample is below the ${MEGASET_TRACK_MINUTES_MIN}-minute track floor`,
      });
      return false;
    }
    if (duration <= MEGASET_TRACK_MINUTES_MAX * 60) return true;
    excluded.push({
      videoId: candidate.videoId,
      title: candidate.title,
      reason: `${minutesAt(duration)}-minute continuous mix exceeds the ${MEGASET_TRACK_MINUTES_MAX}-minute track cap`,
    });
    return false;
  });
  /** Running arc clock, mutated ONLY by `commit` right below (the linter's
   *  loop-condition analysis sees that mutation; the old indirect-mutate-
   *  inside-push shape needed a file-scoped rule-off). */
  let elapsed = 0;
  // Which search path ran — assigned at the strategy pick below; early
  // exits (no anchor) default to "greedy" since no deep search executed.
  let search: MegasetResult["search"] = "greedy";
  const push = (c: SetCandidate, transition: number | null): void => {
    elapsed += dur(c);
    steps.push({
      videoId: c.videoId,
      title: c.title,
      artist: c.artist,
      bpm: c.bpm,
      key: c.key,
      arousal: c.arousal,
      atMin: minutesAt(elapsed),
      transition:
        transition === null ? null : Math.round(transition * 1000) / 1000,
    });
  };
  /** Finish from the chain's real elapsed time. Whole-track selection can
   *  overshoot the target; that is complete with zero shortfall. Empty or
   *  exhausted pools report the remaining time instead of echoing intent. */
  const result = (): MegasetResult => {
    const actualMinutes = minutesAt(elapsed);
    const shortfallMinutes =
      Math.round(Math.max(0, minutes - actualMinutes) * 10) / 10;
    return {
      preset: preset.id,
      minutes,
      actualMinutes,
      shortfallMinutes,
      complete: shortfallMinutes === 0,
      steps,
      excluded,
      search,
    };
  };

  // opener: requested id, else the candidate closest to the arc's start
  // (ties break by videoId — the opener pick must be deterministic too).
  // Only tracks WITH a beats-ledger BPM can anchor the chain: the old
  // arousal-only pick let one un-analyzed closest-fit track void the whole
  // proposal (`first.bpm === null` → everything excluded) even when the
  // rest of the pool was fully analyzed. A requested-but-unanalyzed
  // opener is excluded honestly and the arc still builds.
  const opener =
    (input.openerId && pool.find((c) => c.videoId === input.openerId)) ||
    undefined;
  if (input.openerId && !opener && !requestedOpenerExists) {
    // a requested opener that ISN'T in the pool is a caller mistake (bad
    // id, or the track isn't playable/analyzed) — excluded loudly, never
    // silently ignored (the old shape just built without it and the
    // caller couldn't tell why their track never showed up)
    excluded.push({
      videoId: input.openerId,
      title: null,
      reason:
        "requested opener is not in the candidate pool (unknown id, or not downloaded/analyzed)",
    });
  }
  if (opener && !mixableBpm(opener)) {
    excluded.push({
      videoId: opener.videoId,
      title: opener.title,
      reason:
        "requested opener has no usable beats-ledger BPM — run `megadj beats`",
    });
    pool.splice(pool.indexOf(opener), 1);
  }
  const startArousal = preset.arousal[0]! / 9;
  // Opener pick must ALSO demand a livable tempo neighborhood: the old
  // arousal-only sort landed on pool-min-arousal outliers (a 73 BPM track
  // in a 125 BPM library) whose ±6% window holds 3 tracks — the chain
  // dead-ended after 2 steps and every other candidate got excluded as
  // "no compatible transition". Require ≥ OPENNER_MIN_NEIGHBORS tracks
  // within ±6% before a candidate may anchor; fall back to the old
  // behavior when nothing qualifies (tiny pools).
  const OPENNER_MIN_NEIGHBORS = 15;
  const mixable = [...pool].filter(mixableBpm);
  // `bpmScore(a, b) > 0` means the relative difference is strictly below
  // MEGASET_TEMPO_WINDOW. Counting that neighborhood by rescanning every
  // candidate for every possible opener made this selection O(n²) (20k
  // synthetic tracks took ~1.6 s before the greedy chain even started).
  // Sort once, then count the mathematically identical open interval
  // ((1-w)×bpm, bpm/(1-w)) with two binary searches: O(n log n),
  // preserving exact boundary semantics.
  const windowFactor = 1 - MEGASET_TEMPO_WINDOW;
  const sortedBpms = mixable.map((c) => c.bpm).toSorted((a, b) => a - b);
  const tempoNeighbors = (bpm: number): number =>
    lowerBound(sortedBpms, bpm / windowFactor) -
    upperBound(sortedBpms, bpm * windowFactor);
  const anchored =
    opener && mixableBpm(opener)
      ? opener
      : (mixable
          .filter((c) => tempoNeighbors(c.bpm) >= OPENNER_MIN_NEIGHBORS)
          .toSorted((a, b) => {
            const fa = Math.abs((a.arousal ?? 5) / 9 - startArousal);
            const fb = Math.abs((b.arousal ?? 5) / 9 - startArousal);
            return fa - fb || a.videoId.localeCompare(b.videoId);
          })[0] ??
        mixable.toSorted((a, b) => {
          const fa = Math.abs((a.arousal ?? 5) / 9 - startArousal);
          const fb = Math.abs((b.arousal ?? 5) / 9 - startArousal);
          return fa - fb || a.videoId.localeCompare(b.videoId);
        })[0]);
  const first = anchored;
  if (!first) {
    excluded.push(
      ...pool.map((c) => ({
        videoId: c.videoId,
        title: c.title,
        reason: "no beats-ledger BPM — run `megadj beats`",
      })),
    );
    return result();
  }
  pool.splice(pool.indexOf(first), 1);

  // Strategy pick (E7, docs/set/04-sequencing-benchmarks.md): small
  // pools get the beam continuation, big pools keep greedy — measured
  // +59% chain length on sparse pools at ~0 ms. The sequencer's working
  // pool (opener + post-duration-filter rest) is the size that decides;
  // the chosen path is REPORTED (`search` on the wire), never a silent
  // algorithm switch.
  const rest = pool;
  const useBeam = isMegasetSearchOverride(input.searchOverride)
    ? input.searchOverride === "beam"
    : rest.length + 1 < MEGASET_BEAM_POOL_MAX;
  search = useBeam ? "beam" : "greedy";
  const picked = useBeam
    ? beamChain(first, rest, preset, budget)
    : greedyChain(first, rest, preset, budget);

  for (const step of picked.chain) push(step.candidate, step.transition);

  // stop-cause honesty: leftovers get the reason that matches reality.
  // The selection functions consumed chain members from an internal copy,
  // so `rest` still lists them — skip picked ids, exclude only leftovers
  // (each candidate is exactly once in the chain or in `excluded`).
  const pickedIds = new Set(picked.chain.map((s) => s.candidate.videoId));
  const leftover = rest.filter((c) => !pickedIds.has(c.videoId));
  if (picked.stopCause === "deadend") {
    // nothing mixable remains — the leftovers are excluded, not silently
    // dropped (the old double-count shipped once: excluded_total 596 for
    // 298 leftovers)
    for (const c of leftover)
      excluded.push({
        videoId: c.videoId,
        title: c.title,
        reason: mixableBpm(c)
          ? "no compatible transition (key clash or tempo outside ±6%)"
          : "no beats-ledger BPM — run `megadj beats`",
      });
  } else if (picked.stopCause === "budget") {
    for (const c of leftover)
      excluded.push({
        videoId: c.videoId,
        title: c.title,
        reason: "set budget filled",
      });
  }
  // stopCause "exhausted": pool was fully consumed — nothing to explain

  return result();
}
