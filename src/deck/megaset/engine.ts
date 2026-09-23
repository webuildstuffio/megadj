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
// The SCORING family (key/tempo compatibility, arc envelopes, anchor
// drift budget, transitionScore) lives in megaset/scoring.ts (#89/#90
// item 2); this module owns the query parse, the candidate model, and
// the chain/search family (greedy vs beam + the commit loop).
export { camelotOf } from "../shared/camelot";
export type { MegasetPresetDef, MegasetPresetId } from "../shared/types";
import {
  DEFAULT_MEGASET_PRESET,
  groupMegasetExcluded,
  megasetArtistKey,
  megasetBudgetFilledCount,
  megasetMixInCue,
  megasetMixOutCue,
  MEGASET_MINUTES_DEFAULT,
  MEGASET_MINUTES_MAX,
  MEGASET_MINUTES_MIN,
  MEGASET_PRESET_DEFS,
  MEGASET_PRESET_IDS,
  MEGASET_TEMPO_WINDOW,
  MEGASET_TRACK_MINUTES_MAX,
  MEGASET_TRACK_MINUTES_MIN,
  type MegasetPresetDef,
  type MegasetPresetId,
  type MegasetResult,
  type MegasetStep,
  type SetSearchOverride,
} from "../shared/types";
// M3 (#327): the plan stage — buildPlan owns the arc segments, opener
// policy, drift constants, landmark pin list, and the E7 strategy pick;
// this module remains the measured fill (pool filter, opener pick,
// commit loop, wire assembly).
import { buildPlan } from "./plan";
// bpmScore/keyScore/withinAnchorBudget are the public scoring surface
// (test + spoke imports). mixableBpm/transitionScore have no external
// consumer — they stay internal to the two engine modules (knip-pinned);
// megaset/scoring.ts is the import point for any new caller.
export { bpmScore, keyScore, withinAnchorBudget } from "./scoring";
// SetCandidate — canonically DEFINED in ./megaset/scoring (the scoring
// family owns the row shape it scores; #173 madge pass moved it here so
// scoring's type-only back-edge into this file stops being a cycle).
// Re-exported for every existing consumer — same symbol, never a twin.
import {
  mixableBpm,
  transitionEvidence,
  transitionScore,
  type SetCandidate,
} from "./scoring";
export type { SetCandidate } from "./scoring";

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
 *  route, the MCP tool and any future caller share it. Minutes are
 *  absent→default-60, PRESENT-but-non-numeric→error (B7, issue #105 —
 *  the old silent fallback let `?minutes=abc` re-score as a 60-minute
 *  set the caller never asked for), and clamp to the documented range
 *  (a caller can't smuggle `minutes=99999` past the UI's input field);
 *  preset defaults when absent. */
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
  // B7 (issue #105): non-numeric minutes used to silently re-score as the
  // 60-minute default — a typo'd `?minutes=abc` or `--minutes abc` got a
  // set the caller never asked for. Absent stays default-60; PRESENT but
  // invalid is a caller bug and errors like the unknown-preset path.
  if (!Number.isFinite(n)) {
    return {
      error: `minutes must be a number (got "${String(minutesRaw)}")`,
    };
  }
  return {
    preset,
    minutes: Math.min(
      MEGASET_MINUTES_MAX,
      Math.max(MEGASET_MINUTES_MIN, Math.round(n)),
    ),
  };
}

/** Binary-search bound helpers (#316: was two 6L twins differing only in
 *  the comparison operator). `allowEqual` picks the semantic: true =
 *  first index with value >= target (lowerBound), false = first index
 *  with value > target (upperBound). */
function boundIndex(
  sorted: number[],
  target: number,
  allowEqual: boolean,
): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (allowEqual ? sorted[mid]! <= target : sorted[mid]! < target)
      lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface MegasetInput {
  candidates: SetCandidate[];
  preset: SetPreset;
  /** Target set length in minutes; picks tracks until the budget fills. */
  minutes: number;
  /** Optional fixed opener (its videoId) — the arc starts from it. */
  openerId?: string | undefined;
  /** S13 (#107): landmark must-plays (videoIds) — the engine MUST slot
   *  these into the chain at arc-legal positions; each unplaceable pin is
   *  excluded honestly and counted in `landmarks_missing`. Repeatable. */
  landmarkIds?: readonly string[] | undefined;
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

// The SELECTION family (greedy/beam chain builders + their types) lives
// in ./megaset/search (#89 diet extraction) — this module owns the pool
// filter, opener pick, and the single commit loop.
import { beamChain, greedyChain } from "./search";

export function buildMegaset(input: MegasetInput): MegasetResult {
  const { candidates, preset, minutes } = input;
  const budget = minutes * 60;
  const excluded: MegasetResult["excluded"] = [];
  const steps: MegasetStep[] = [];
  // M3 (#327): the PLAN stage. The pool-admission filter below is the
  // ONE pool-size truth, so the plan is built AFTER it — the E7 strategy
  // rule and the plan's other fields see the admitted pool, exactly as
  // the pre-refactor flow did. Same inputs → byte-identical Plan
  // (engine-plan.test.ts golden pins).
  const fillLandmarkIds = input.landmarkIds
    ? [...new Set(input.landmarkIds)]
    : [];
  const plan = buildPlan({
    preset,
    minutes,
    landmarkIds: fillLandmarkIds,
    openerId: input.openerId,
    searchOverride: input.searchOverride,
    poolSize: candidates.filter((candidate) => {
      const d = candidateDuration(candidate);
      return (
        d >= MEGASET_TRACK_MINUTES_MIN * 60 &&
        d <= MEGASET_TRACK_MINUTES_MAX * 60
      );
    }).length,
  });
  // consumed at the strategy pick (plan.strategy) + the landmark repair
  // pass reads plan.landmarkIds — same list, plan is the record of it
  const landmarkIds = fillLandmarkIds;
  /** Pins that could not be placed — filled by the repair pass below,
   *  read by `result()` once the chain is final. */
  const landmarksMissing: string[] = [];

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
    // #106 Phase D: phrase-aware handoff landmarks, derived from the
    // cues ledger join. `?? []` hardens the boundary: pool producers
    // written before the cues join (or test doubles) omit the field —
    // degrading to "no derivation" beats a crash mid-build.
    const cueList = c.cues ?? [];
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
      // #284: per-component scoring evidence (null on the opener — no
      // transition — and on any gated hop). Recomputed HERE at commit
      // time from the same inputs the selection functions used, so the
      // wire evidence always matches the number that picked the slot.
      evidence: null,
      // S13 (#107): set after the search returns — the pin map is applied
      // in the repair pass below, which rewrites this field for placed
      // pins. The opener defaults false (a pinned opener stays a pin).
      landmark: false,
      mixOutCue: megasetMixOutCue(cueList, c.durationS),
      mixInCue: megasetMixInCue(cueList),
    });
  };
  /** Finish from the chain's real elapsed time. Whole-track selection can
   *  overshoot the target; that is complete with zero shortfall. Empty or
   *  exhausted pools report the remaining time instead of echoing intent. */
  const result = (): MegasetResult => {
    const actualMinutes = minutesAt(elapsed);
    const shortfallMinutes =
      Math.round(Math.max(0, minutes - actualMinutes) * 10) / 10;
    // #283-followup: set-level quality stats so proposals are COMPARABLE
    // (the MD eval previously hand-derived these from steps). null on a
    // single-step chain — no transitions, no average.
    const transitions = steps
      .map((s) => s.transition)
      .filter((t): t is number => t !== null);
    const avgTransition =
      transitions.length === 0
        ? null
        : Math.round(
            (transitions.reduce((a, b) => a + b, 0) / transitions.length) *
              1000,
          ) / 1000;
    const minTransition =
      transitions.length === 0 ? null : Math.min(...transitions);
    // B6 (#107): same-artist adjacency census over the built chain —
    // the diversity guard's honest report card (0 for a well-spread set).
    let sameArtistPairs = 0;
    for (let i = 1; i < steps.length; i++) {
      if (megasetArtistKey(steps[i - 1]!.artist) !== null) {
        const a = megasetArtistKey(steps[i - 1]!.artist);
        const b = megasetArtistKey(steps[i]!.artist);
        if (a !== null && a === b) sameArtistPairs += 1;
      }
    }
    // S13: pins that never landed — the repair pass filled the list;
    // steps[] is final here, so the wire truth is authoritative.
    const landmarksMissingFinal = landmarksMissing.filter(
      (id) => !steps.some((s) => s.videoId === id),
    );
    return {
      preset: preset.id,
      minutes,
      actualMinutes,
      shortfallMinutes,
      complete: shortfallMinutes === 0,
      steps,
      excluded,
      // B13: ONE grouping, derived here from the same excluded[] — the
      // full list (not the wire's 40-preview), so group counts sum to
      // excluded_total
      // #291: EXCEPT budget-fill — that is a status (budget_filled
      // below), not a quality bucket, so the groups stay signal-only.
      excluded_groups: groupMegasetExcluded(excluded),
      excluded_total: excluded.length,
      // #291: the budget-fill STATUS count — true but uninformative rows
      // reported as a number, never drowning the quality groups.
      budget_filled: megasetBudgetFilledCount(excluded),
      avg_transition: avgTransition,
      min_transition: minTransition,
      // B6 (#107): same-artist adjacency count — the diversity report card
      same_artist_pairs: sameArtistPairs,
      // S13 (#107): pins that could not be placed, by id — honest cost
      landmarks_missing: landmarksMissingFinal,
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
  // "no compatible transition". Require ≥ OPENER_MIN_NEIGHBORS tracks
  // within ±6% before a candidate may anchor; fall back to the old
  // behavior when nothing qualifies (tiny pools).
  const OPENER_MIN_NEIGHBORS = 15;
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
    boundIndex(sortedBpms, bpm / windowFactor, true) -
    boundIndex(sortedBpms, bpm * windowFactor, false);
  const anchored =
    opener && mixableBpm(opener)
      ? opener
      : (mixable
          .filter((c) => tempoNeighbors(c.bpm) >= OPENER_MIN_NEIGHBORS)
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

  // B2: the opener IS the anchor — every later candidate is drift-
  // budgeted against this BPM for the rest of the set. (The opener
  // neighborhood guard above already proved it has ≥15 neighbors, so
  // the anchor starts in a livable tempo zone by construction.)
  const anchorBpm = first.bpm;

  // Strategy pick (E7, docs/set/04-sequencing-benchmarks.md): small
  // pools get the beam continuation, big pools keep greedy — measured
  // +59% chain length on sparse pools at ~0 ms. The sequencer's working
  // pool (opener + post-duration-filter rest) is the size that decides;
  // the chosen path is REPORTED (`search` on the wire), never a silent
  // algorithm switch. M3 (#327): the pick is the PLAN's strategy row —
  // same rule, now computed in buildPlan (poolSize = rest + opener).
  const rest = pool;
  const useBeam = plan.strategy === "beam";
  search = useBeam ? "beam" : "greedy";
  const picked = useBeam
    ? beamChain(first, rest, preset, budget, anchorBpm)
    : greedyChain(first, rest, preset, budget, anchorBpm);

  // ---- S13 (#107): landmark repair pass ----------------------------------
  // Landmarks that the search didn't pick (it can't see the pins) get a
  // greedy repair: each unplaced pin — in request order — is inserted at
  // its first arc-legal, mixable successor position (transition > 0 from
  // its predecessor and INTO its successor). A pin that passes every gate
  // scores like any other candidate; the repair guarantees PRESENCE, not
  // priority. A pin that fits nowhere lands in excluded +
  // landmarks_missing with the honest reason — never silently dropped.
  const pickedIds = new Set(picked.chain.map((s) => s.candidate.videoId));
  const repairPool = [...rest];
  for (const pinId of landmarkIds) {
    if (pickedIds.has(pinId)) continue; // opener pick or search already slotted it
    const pinIndex = repairPool.findIndex((c) => c.videoId === pinId);
    if (pinIndex === -1) {
      // not in the scored pool at all (unknown id / no measured tempo /
      // not downloaded) — the same honesty as a requested opener
      landmarksMissing.push(pinId);
      excluded.push({
        videoId: pinId,
        title: null,
        reason:
          "landmark not placeable — not in the candidate pool (unknown id, or not downloaded/analyzed)",
      });
      continue;
    }
    const pin = repairPool.splice(pinIndex, 1)[0]!;
    // F2 super-fix: arc positions. The repair loop previously scored both
    // hops at t=0 — the arc's START — so a pin whose arousal moved against
    // the segment direction at its actual slot (a B3 hard wall the normal
    // search can never commit) was force-inserted anyway. The anchor term
    // is a soft bonus, not a gate, so position-true hops are scored the
    // same way the selection functions score them.
    let inserted = false;
    for (let i = 0; i < picked.chain.length - 1 && !inserted; i++) {
      const prevC = picked.chain[i]!.candidate;
      const nextEntry = picked.chain[i + 1]!.candidate;
      // slot position AFTER inserting the pin between i and i+1: the pin
      // sits at (elapsed through prevC) / budget — recomputed per slot so
      // the position-true arc score decides WHERE the pin lands, and a
      // B3-direction-violating slot is a wall exactly like the search sees.
      const elapsedThroughPrev = picked.chain
        .slice(0, i + 1)
        .reduce((sum, s) => sum + candidateDuration(s.candidate), 0);
      const tPin = Math.min(1, elapsedThroughPrev / budget);
      // both hops must be arc-legal (transitionScore returns −1 when a
      // gate fails: key clash, tempo window, drift budget, arc direction)
      const scoreIn = transitionScore(
        prevC,
        pin,
        preset,
        tPin,
        anchorBpm,
        prevC.arousal,
      );
      if (scoreIn <= 0) continue;
      const elapsedAfterPin = elapsedThroughPrev + candidateDuration(pin);
      const tOut = Math.min(1, elapsedAfterPin / budget);
      const scoreOut = transitionScore(
        pin,
        nextEntry,
        preset,
        tOut,
        anchorBpm,
        pin.arousal,
      );
      if (scoreOut <= 0) continue;
      picked.chain.splice(i + 1, 0, {
        candidate: pin,
        transition: scoreIn,
      });
      // the displaced successor's transition is stale — it described a
      // hop from the old predecessor; recompute it from the pin at the
      // successor's own (new) slot position
      const succ = picked.chain[i + 2];
      if (succ) {
        succ.transition = transitionScore(
          pin,
          succ.candidate,
          preset,
          tOut,
          anchorBpm,
          pin.arousal,
        );
      }
      inserted = true;
      pickedIds.add(pinId);
    }
    if (!inserted) {
      landmarksMissing.push(pinId);
      excluded.push({
        videoId: pinId,
        title: pin.title,
        reason:
          "landmark not placeable — no arc-legal position in this set (key clash, tempo outside ±6%, or drift budget)",
      });
    }
  }

  for (const step of picked.chain) push(step.candidate, step.transition);
  // #284: the evidence pass — each step's per-component breakdown,
  // recomputed from the ORIGINAL candidates at the exact slot clock the
  // selection functions scored it (t = full-precision elapsed through
  // the predecessor — the rounded atMin wire field is NOT the clock, a
  // 0.1-min rounding there drifts the arc envelope and the anchor term).
  // Same inputs → the wire breakdown always matches the blend.
  {
    let elapsedS = 0;
    for (let i = 0; i < picked.chain.length; i++) {
      const entry = picked.chain[i]!;
      const t = Math.min(1, elapsedS / budget);
      if (i > 0 && entry.transition !== null) {
        const prevEntry = picked.chain[i - 1]!;
        const s = steps[i]!;
        // same inputs the search saw → the components sum to the blend;
        // a null here would be a wire lie, so it cannot happen (defensive
        // typed as null-coalescing, never silently faked)
        s.evidence = transitionEvidence(
          prevEntry.candidate,
          entry.candidate,
          preset,
          t,
          anchorBpm,
          prevEntry.candidate.arousal,
        );
      }
      elapsedS += candidateDuration(entry.candidate);
    }
  }
  // mark placed pins on the wire steps (push() defaulted them false —
  // the pin map only exists after the repair pass)
  for (const step of steps) {
    if (landmarkIds.includes(step.videoId)) step.landmark = true;
  }

  // stop-cause honesty: leftovers get the reason that matches reality.
  // The selection functions consumed chain members from an internal copy,
  // so `rest` still lists them — skip picked ids, exclude only leftovers
  // (each candidate is exactly once in the chain or in `excluded`).
  // S13: repair-pool leftovers explain themselves too; unplaceable PINS
  // already carry their landmark reason above, so the id set is skipped.
  const pinExplained = new Set(landmarksMissing);
  const leftover = [...rest, ...repairPool].filter(
    (c) => !pickedIds.has(c.videoId) && !pinExplained.has(c.videoId),
  );
  const leftoverSeen = new Set<string>();
  if (picked.stopCause === "deadend") {
    // nothing mixable remains — the leftovers are excluded, not silently
    // dropped (the old double-count shipped once: excluded_total 596 for
    // 298 leftovers)
    for (const c of leftover) {
      if (leftoverSeen.has(c.videoId)) continue;
      leftoverSeen.add(c.videoId);
      excluded.push({
        videoId: c.videoId,
        title: c.title,
        reason: mixableBpm(c)
          ? "no compatible transition (key clash, tempo outside ±6%, or beyond the set's drift budget)"
          : "no beats-ledger BPM — run `megadj beats`",
      });
    }
  } else if (picked.stopCause === "budget") {
    for (const c of leftover) {
      if (leftoverSeen.has(c.videoId)) continue;
      leftoverSeen.add(c.videoId);
      excluded.push({
        videoId: c.videoId,
        title: c.title,
        reason: "set budget filled",
      });
    }
  }
  // stopCause "exhausted": pool was fully consumed — nothing to explain

  return result();
}
