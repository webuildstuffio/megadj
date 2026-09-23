// megaset/plan.ts — M3 (#327): the PLAN stage of the two-stage
// plan-and-fill architecture (v3 §2/§8 move 3).
//
// `buildPlan` extracts from buildMegaset every sequencing decision that
// does NOT need track data, as a serializable Plan:
//   - arc segments (role/window/bpmTarget/keyRegion/energyRange) — the
//     preset envelope cut into B3's thirds, first-class
//   - opener policy: requested id + the deterministic-pick inputs
//     (neighborhood rule, arousal distance, tie-break) it must satisfy
//   - drift budget + branch lanes (B2/B8 constants the fill gates on)
//   - landmark pin ids (S13) in first-requested order
//   - strategy pick (E7 pool-size rule → beam|greedy)
//
// `buildMegaset` (engine.ts) = buildPlan + the measured fill. Same
// inputs → byte-identical Plan AND chain (v3 §9 determinism law); the
// golden pins in engine-plan.test.ts enforce it.
//
// Plan is PLAIN DATA: no class instances, no functions, no Dates — JSON
// round-trips byte-identical (AC #2). P1–P8 architecture rows document
// these fields when consumers land (02-architecture §2, no pre-twinning
// per v3 §10).
import type { SetCandidate } from "./scoring";
import {
  MEGASET_BEAM_POOL_MAX,
  MEGASET_DRIFT_BUDGET,
  MEGASET_TRACK_MINUTES_MAX,
  MEGASET_TRACK_MINUTES_MIN,
  type MegasetPresetDef,
  type SetSearchOverride,
} from "../shared/types";

/** One arc segment: the preset envelope sampled across a third of the
 *  set (B3's segmentation, first-class). Roles name the arc phase; the
 *  windows are [startT, endT] in set-fraction coordinates. */
export interface PlanSegment {
  /** Arc phase name — "open" | "build" | "land" (B3 thirds). */
  role: "open" | "build" | "land";
  /** Set-fraction window [start, end] (0..1). */
  window: readonly [number, number];
  /** Tempo target as a RATIO of the anchor BPM, sampled mid-window. */
  bpmTarget: number;
  /** Camelot letter the segment's key compatibility centers on — null
   *  until a track anchors the set (the opener's key IS the region). */
  keyRegion: string | null;
  /** Arousal envelope [start, end] on the 1–9 scale across the window. */
  energyRange: readonly [number, number];
  /** Danceability envelope [start, end] on the 0–1 scale. */
  danceRange: readonly [number, number];
}

/** Opener selection policy: everything the fill needs to re-derive the
 *  engine's deterministic opener pick without the plan owning tracks. */
export interface PlanOpenerPolicy {
  /** Requested opener id, when the caller pinned one. */
  requestedId: string | null;
  /** Minimum ±6% neighbors for an anchor to be livable (S8). */
  minNeighbors: number;
  /** Tie-break law: arousal-distance then videoId (S10). */
  tieBreak: "arousal-then-id";
  /** Target start arousal (preset.arousal[0] / 9) the distance scores. */
  startArousal: number;
}

/** The plan: pure, deterministic, serializable, diffable (v3 §2). */
export interface MegasetPlan {
  /** Plan schema version — bump on any shape change. */
  version: 1;
  /** Preset id the arc derives from. */
  presetId: string;
  /** Requested minutes (already clamped by parseMegasetQuery). */
  minutes: number;
  /** Total budget seconds (minutes × 60) — the fill's clock. */
  budgetS: number;
  /** The arc, in B3 thirds. */
  segments: PlanSegment[];
  /** Opener selection policy. */
  opener: PlanOpenerPolicy;
  /** B2 drift budget (fraction of anchor BPM). */
  driftBudget: number;
  /** Branch lanes the drift gate spares (×2/×½/×1.5/×⅔ half-time). */
  branchLanes: readonly [2, 0.5];
  /** S13 landmark pins, first-requested order, deduped. */
  landmarkIds: string[];
  /** E7 strategy pick: pool-size rule decides; an explicit override
   *  (test/A/B hook) wins over the rule. */
  strategy: "beam" | "greedy";
  /** Whether the strategy was forced by the caller (vs pool-size rule). */
  strategyForced: boolean;
}

/** The plan-stage INPUT: preset + request knobs + a pool PROBE for the
 *  strategy pick's size rule. Track identity is NOT consumed here — the
 *  same request over different pools diffs honestly at the strategy row
 *  only when the pool size actually crosses the E7 crossover. */
export interface PlanInput {
  preset: MegasetPresetDef;
  minutes: number;
  /** S13 pins (unclamped; deduped here, first-request order kept). */
  landmarkIds?: readonly string[] | undefined;
  /** Explicit strategy override (test + A/B-compare hook). */
  searchOverride?: SetSearchOverride | undefined;
  /** Post-duration-filter pool size feeding the E7 rule (rest + opener).
   *  buildMegaset computes it after its duration filter — the plan does
   *  NOT re-filter (single source of truth for pool admission). */
  poolSize: number;
  /** Requested opener id (validity is the fill's call — the pool is the
   *  truth for membership). */
  openerId?: string | undefined;
}

/** Cut [0,1] into the B3 thirds with the preset's envelopes sampled per
 *  segment. Deterministic; exported for the fill's slot-clock math. */
export function planSegments(preset: MegasetPresetDef): PlanSegment[] {
  const thirds: PlanSegment["role"][] = ["open", "build", "land"];
  return thirds.map((role, i) => {
    const window = [i / 3, (i + 1) / 3] as const;
    const mid = (window[0] + window[1]) / 2;
    const arousalAt = (t: number): number =>
      preset.arousal[0] + (preset.arousal[1] - preset.arousal[0]) * t;
    const danceAt = (t: number): number =>
      preset.dance[0] + (preset.dance[1] - preset.dance[0]) * t;
    const tempoAt = (t: number): number =>
      preset.tempoTarget[0] +
      (preset.tempoTarget[1] - preset.tempoTarget[0]) * t;
    return {
      role,
      window,
      bpmTarget: Math.round(tempoAt(mid) * 1e6) / 1e6,
      keyRegion: null,
      energyRange: [
        Math.round(arousalAt(window[0]) * 1e6) / 1e6,
        Math.round(arousalAt(window[1]) * 1e6) / 1e6,
      ] as const,
      danceRange: [
        Math.round(danceAt(window[0]) * 1e6) / 1e6,
        Math.round(danceAt(window[1]) * 1e6) / 1e6,
      ] as const,
    };
  });
}

/** Build the plan. Deterministic: same input → identical Plan. */
export function buildPlan(input: PlanInput): MegasetPlan {
  const landmarkIds = input.landmarkIds ? [...new Set(input.landmarkIds)] : [];
  const strategyForced = input.searchOverride !== undefined;
  // E7 rule, verbatim from the engine it extracts: `rest.length + 1 <
  // MEGASET_BEAM_POOL_MAX` where `rest` = post-filter pool MINUS the
  // anchor — so rest.length + 1 IS the post-filter pool size this input
  // carries. poolSize < MAX ≡ the original expression, boundary exact.
  const strategy: "beam" | "greedy" = strategyForced
    ? input.searchOverride === "beam"
      ? "beam"
      : "greedy"
    : input.poolSize < MEGASET_BEAM_POOL_MAX
      ? "beam"
      : "greedy";
  return {
    version: 1,
    presetId: input.preset.id,
    minutes: input.minutes,
    budgetS: input.minutes * 60,
    segments: planSegments(input.preset),
    opener: {
      requestedId: input.openerId ?? null,
      minNeighbors: 15,
      tieBreak: "arousal-then-id",
      startArousal: input.preset.arousal[0]! / 9,
    },
    driftBudget: MEGASET_DRIFT_BUDGET,
    branchLanes: [2, 0.5],
    landmarkIds,
    strategy,
    strategyForced,
  };
}

/** Duration with the 5:00 assumption — shared shape with the engine's
 *  candidateDuration (kept local: the fill needs it per-slot too). */
export const planCandidateDuration = (c: SetCandidate): number => {
  const seconds = c.durationS;
  return seconds !== null && Number.isFinite(seconds) && seconds > 0
    ? seconds
    : 300;
};

/** S7 track floor/cap — the plan's probe reuses the SAME constants the
 *  engine's admission filter reads (one shared registry, no drift). */

/** Guard so the fill can prove its pool matches the plan's expectation
 *  (S7 window) — mixability (BPM presence) is the fill's own gate. */
export function planPoolProbe(candidates: readonly SetCandidate[]): {
  size: number;
} {
  return {
    size: candidates.filter(
      (c) =>
        planCandidateDuration(c) >= MEGASET_TRACK_MINUTES_MIN * 60 &&
        planCandidateDuration(c) <= MEGASET_TRACK_MINUTES_MAX * 60,
    ).length,
  };
}
