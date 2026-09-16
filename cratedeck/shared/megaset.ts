// shared/megaset.ts — the set-builder wire seam.
//
// Split from shared/types.ts (file-length guard) following the same
// leaf-seam pattern as archive_types.ts / report_types.ts: the HTTP
// envelope (archive_routes.ts), the pure engine (src/megaset.ts) and
// the UI panel (web SimilarTab) all derive from THIS file — never a
// local twin (a local duplicate drifted once and crashed the render).

/** One phrase-boundary landmark on a set step (#106 Phase D handoff
 *  layer): an 8-bar DJ phrase cue from the `cues` ledger, in the units
 *  the ledger stores (bar 1-based, position in seconds). Both fields
 *  null together when the track has no cues ledger row — a missing
 *  derivation degrades honestly, never an invented bar. */
export interface MegasetCuePoint {
  bar: number;
  position: number;
}

export interface MegasetStep {
  videoId: string;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  key: string | null;
  arousal: number | null;
  /** cumulative minutes at the END of this track */
  atMin: number;
  /** transition score into this track (first track: null) */
  transition: number | null;
  /** #106: 8-bar boundary nearest the handoff overlap window — where
   *  the PREVIOUS track hands over (outro side of this step's end). */
  mixOutCue: MegasetCuePoint | null;
  /** #106: 8-bar boundary nearest the handoff overlap window — where
   *  THIS track can take over (intro side, a few phrases in). */
  mixInCue: MegasetCuePoint | null;
}

export interface MegasetResult {
  preset: string;
  /** Requested target duration. This is an intent, not the built runtime. */
  minutes: number;
  /** Runtime of the selected whole-track chain, rounded to 0.1 minute. */
  actualMinutes: number;
  /** Unfilled target time, never negative, rounded to 0.1 minute. */
  shortfallMinutes: number;
  /** True when the selected chain meets or exceeds the requested target. */
  complete: boolean;
  steps: MegasetStep[];
  /** candidates excluded from the chain, with the reason — the honest
   * "why isn't my track in here" list */
  excluded: { videoId: string; title: string | null; reason: string }[];
  /** Full exclusion count (the payload's `excluded[]` is a 40-preview;
   *  this keeps the real number). */
  excluded_total: number;
  /** B13 (#104): the same exclusions grouped by reason (derived from
   *  the flat list by the shared `groupMegasetExcluded` — never a
   *  second bucket list). Examples cap at 4 per group. */
  excluded_groups: {
    reason: string;
    count: number;
    examples: string[];
  }[];
  /** Which sequencer path ran: "greedy" or "beam". Beam activates
   * automatically for pools below MEGASET_BEAM_POOL_MAX (the measured E7
   * sparse-pool failure zone); surfaced so the deep search is visible,
   * never a silent algorithm switch. */
  search: "greedy" | "beam";
}

/** The all-missing signature: every DB row's file path failed the
 *  existence check while rows exist at all. In practice this means the
 *  shelf volume is NOT mounted (paths like /Volumes/SHELF1/... cannot
 *  exist) — not that the library is small or unanalyzed. Derived, never
 *  a server flag: the client classifies from the same census numbers the
 *  engine measured, so a drifted wire field cannot lie twice. The steps
 *  param only needs a length — full MegasetResult and bare test
 *  doubles both satisfy it structurally. B1 (#104): metadata-only rows
 *  are part of the missing-files population, so the identity is
 *  `pool_file + metadata_only + missing = source_total` — with
 *  metadata-only rows admitted, a sleeping shelf leaves
 *  `missing = source_total - pool_file - metadata_only` and the old
 *  identity would never fire. */
export function isShelfOffline(
  result: { steps: readonly unknown[] },
  census: Pick<
    MegasetPayload,
    | "source_total"
    | "pool"
    | "missing_files"
    | "relocated_files"
    | "metadata_only"
  >,
): boolean {
  return (
    result.steps.length === 0 &&
    census.source_total > 0 &&
    census.missing_files + census.pool + census.metadata_only ===
      census.source_total &&
    census.relocated_files === 0
  );
}

/** The GET /api/archive/megaset response envelope. */
export interface MegasetPayload extends MegasetResult {
  available: boolean;
  /** Downloaded DB rows inspected before filesystem validation. */
  source_total: number;
  /** Existing files eligible for scoring and proposal placement. */
  pool: number;
  /** Stale downloaded rows whose file path no longer exists. */
  missing_files: number;
  /** B1 (#104): missing rows still scored from measured tempo (beats
   *  ledger / rekordbox mirror). A nonzero value means part of the
   *  pool is mirror metadata, not mounted audio — surfaced, never
   *  silent. */
  metadata_only: number;
  /** Extra DB identities collapsed because they resolve to one physical file. */
  duplicate_files: number;
  /** Unique files found under the mounted shelf after a stale import path. */
  relocated_files: number;
  /** Candidate keys reused from the current Rekordbox master mirror. */
  rekordbox_key_hits: number;
  /** Candidate BPM values reused from the current Rekordbox master mirror. */
  rekordbox_bpm_hits: number;
  /** File tags read because no path-valid key cache row existed. */
  key_reads: number;
  /** Key-tag reads that failed; affected tracks are scored without key. */
  key_read_failures: number;
  excluded_total: number;
  /** Ledger ages for the newest beats/mood analysis — a stale pool is
   *  VISIBLE ("proposed from analysis older than your latest drops"),
   *  never silent. Null when that ledger is empty. */
  freshness: { beatsAt: string | null; moodAt: string | null };
}

/** Set-builder energy-arc presets — the ONE registry all three surfaces
 *  derive from: the engine (src/megaset.ts) scores against these
 *  envelopes, the route validates `?preset=` against these ids, and the
 *  UI renders the picker + descriptions from this table. Envelopes:
 *  arousal on the 1–9 mood scale, danceability on 0–1; [start, end] =
 *  the arc's target at the first/last slot. */
interface SetPresetShape {
  id: string;
  label: string;
  description: string;
  /** arousal envelope [start, end] on the 1–9 scale. */
  arousal: readonly [number, number];
  /** danceability envelope [start, end] on the 0–1 scale. */
  dance: readonly [number, number];
  /** Tempo arc as RATIOS of the set's anchor BPM ([start, end], sampled
   *  at the same slot clock as arousal/dance). The B2 fix steers the
   *  chain back toward this target instead of only chasing the previous
   *  track's BPM — warmup climbs gently, peak holds, afterhours winds
   *  down. All presets start at 1.0: the opener IS the anchor. */
  tempoTarget: readonly [number, number];
}

export const MEGASET_PRESET_DEFS = [
  {
    id: "warmup",
    label: "Warm-up",
    description: "Slow-burn opener arc — builds gently into the night.",
    arousal: [2.5, 5.5],
    dance: [0.4, 0.7],
    tempoTarget: [1.0, 1.06],
  },
  {
    id: "peak",
    label: "Peak time",
    description: "High energy throughout, slight lift toward the end.",
    arousal: [6, 8.5],
    dance: [0.7, 0.95],
    tempoTarget: [1.0, 1.02],
  },
  {
    id: "afterhours",
    label: "After hours",
    description: "Starts deep and hypnotic, drifts darker and slower.",
    arousal: [5, 3],
    dance: [0.75, 0.6],
    tempoTarget: [1.0, 0.96],
  },
] as const satisfies readonly SetPresetShape[];

export type MegasetPresetDef = (typeof MEGASET_PRESET_DEFS)[number];
export type MegasetPresetId = MegasetPresetDef["id"];

/** The `?preset=` guard rail: the engine clamps minutes, but an unknown
 *  preset id is a caller bug — surfaced, never silently re-scored as
 *  peak-time (the old `SET_PRESETS[bad] ?? peak` fallback hid it). */
export const MEGASET_PRESET_IDS: MegasetPresetId[] = MEGASET_PRESET_DEFS.map(
  (p) => p.id,
);

export const DEFAULT_MEGASET_PRESET: MegasetPresetId = "peak";

export const MEGASET_MINUTES_MIN = 10;
export const MEGASET_MINUTES_MAX = 240;
export const MEGASET_MINUTES_DEFAULT = 60;
/** Ignore one-shots, loops and preview fragments: they are useful archive
 * assets, but they are not standalone tracks in a DJ set proposal. */
export const MEGASET_TRACK_MINUTES_MIN = 1;
/** Individual DJ tracks longer than this are continuous mixes, not one
 * proposal slot. Kept beside the other set-builder limits for all surfaces. */
export const MEGASET_TRACK_MINUTES_MAX = 15;

/** Tempo-mixability curve (bpmScore): 1.0 within ±2%, linearly down to 0
 *  at ±6% — the classic DJ mixability window. Exported so every surface
 *  quotes the engine's real numbers, never a hand-copied twin. */
export const MEGASET_TEMPO_PERFECT = 0.02;
export const MEGASET_TEMPO_WINDOW = 0.06;

/** Transition score weights: tempo + key are the mixable core, arc fit is
 *  the soft bonus. Exported for the surfaces' scoring-evidence panels. */
export const MEGASET_TRANSITION_WEIGHTS = {
  tempo: 0.45,
  key: 0.3,
  arcFit: 0.25,
} as const;

// ---- B2 tempo-anchor seam (issue #105): a ±6%-per-step chain COMPOUNDS
// (measured 100 → 187.9 BPM in one 12-step climb) because each hop is
// only judged against the previous track. The anchor gives the arc a
// global reference: a soft term pulls candidates toward the preset's
// arc-local target (anchor lerped along `tempoTarget`), a hard budget
// caps total drift from the anchor.
/** Soft weight of the anchor-distance term inside transitionScore. Kept
 *  beside MEGASET_TRANSITION_WEIGHTS (frozen constants, E6 — no
 *  user-tunable knobs); the three mixability weights stay untouched. */
export const MEGASET_ANCHOR_WEIGHT = 0.15;
/** Hard drift budget: max |candidate/anchor − 1| allowed ANYWHERE on the
 *  chain (≈ ±2 half-steps at moderate BPM). Candidates beyond it are
 *  unmixable for THIS set — mix-out branches (2×/½×, see bpmScore) are
 *  exempt so half-time gear can still land a DnB closer. */
export const MEGASET_DRIFT_BUDGET = 0.12;
/** Half/double-time factor tolerance: a candidate within this relative
 *  distance of 2×/½× the anchor passes the budget on the branch lane. */
export const MEGASET_BRANCH_TOLERANCE = 0.06;

// ---- Phase D handoff layer (#106): phrase-aware transition windows ----
/** How deep into a track's end the mix-out overlap targets (seconds).
 *  45 s ≈ 16 bars at 128 BPM — a full 8-bar boundary + slack inside the
 *  classic 32–64 bar outro blend. Frozen like the scoring constants (no
 *  user-tunable knobs); every surface quotes the same number. */
export const MEGASET_HANDOFF_OVERLAP_S = 45;
/** How deep into a track's start the mix-in overlap targets (seconds).
 *  45 s ≈ bar 9–17 — the first phrases are usually intro (drums/hats),
 *  so the takeover landmark sits a phrase or two in. */
export const MEGASET_HANDOFF_INTRO_S = 45;

/** B13 (#104): one excluded-reason bucketing, derived from the SAME
 *  excluded[] the engine produced — never a hand-copied bucket list.
 *  Per-track rows stay the honest record (`excluded[]` flat preview +
 *  `excluded_total`); the groups give the DJ the SHAPE of what was left
 *  out without scanning 40 identical rows. Biggest bucket first,
 *  examples capped at 4, `sum(count) === excluded_total` when callers
 *  pass the full list (the CLI/web pass the capped preview; `total` is
 *  authoritative). */
export function groupMegasetExcluded(
  excluded: readonly {
    videoId: string;
    title: string | null;
    reason: string;
  }[],
): { reason: string; count: number; examples: string[] }[] {
  const byReason = new Map<
    string,
    { reason: string; count: number; examples: string[] }
  >();
  for (const e of excluded) {
    let bucket = byReason.get(e.reason);
    if (!bucket) {
      bucket = { reason: e.reason, count: 0, examples: [] };
      byReason.set(e.reason, bucket);
    }
    bucket.count += 1;
    if (bucket.examples.length < 4) bucket.examples.push(e.title ?? e.videoId);
  }
  return [...byReason.values()].toSorted((a, b) => b.count - a.count);
}

// ---- Phase D handoff derivation (#106) -------------------------------------
// Pure over the cues-ledger join: the engine (and any surface re-rendering
// a step) derives the SAME windows from the SAME cue arrays — no surface
// re-derives with its own "nearest boundary" math.

/** One phrase cue as joined from the `cues` ledger (subset of the
 *  writer's shape — the fields the handoff derivation needs). */
export interface MegasetCue {
  bar: number;
  position: number;
}

/** Nearest-in-list helper with a documented tie-break: when two cues are
 *  equidistant from the target, the EARLIER boundary wins (deterministic
 *  and DJ-sensible — an earlier takeover is always safer than a later
 *  one caught mid-phrase). Returns null for an empty list: no ledger
 *  row → no invented bar. */
export function nearestMegasetCue(
  cues: readonly MegasetCue[],
  targetS: number,
): MegasetCuePoint | null {
  let best: MegasetCuePoint | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const cue of cues) {
    if (!Number.isFinite(cue.position) || !Number.isFinite(cue.bar)) continue;
    const dist = Math.abs(cue.position - targetS);
    // strict < keeps the FIRST-SEEN cue on a distance tie; the ledger is
    // written in ascending bar order, so first-seen == earlier boundary.
    // (An equal-distance later bar would flip only with `<=` — the tie
    // regression test pins the earlier-bar outcome either way.)
    if (
      dist < bestDist ||
      (dist === bestDist && cue.bar < (best?.bar ?? cue.bar))
    ) {
      bestDist = dist;
      best = { bar: cue.bar, position: cue.position };
    }
  }
  return best;
}

/** mix-out landmark for a step: the 8-bar boundary nearest the outro
 *  overlap target (duration − MEGASET_HANDOFF_OVERLAP_S). Needs a finite
 *  duration; a metadata-only row without one degrades to null. */
export function megasetMixOutCue(
  cues: readonly MegasetCue[],
  durationS: number | null,
): MegasetCuePoint | null {
  if (cues.length === 0 || durationS === null || !Number.isFinite(durationS))
    return null;
  return nearestMegasetCue(cues, durationS - MEGASET_HANDOFF_OVERLAP_S);
}

/** mix-in landmark for a step: the 8-bar boundary nearest the intro
 *  overlap target (MEGASET_HANDOFF_INTRO_S from the start — the first
 *  phrases are usually intro, so the takeover landmark sits a phrase or
 *  two in). Works without a duration (the intro side never needs one). */
export function megasetMixInCue(
  cues: readonly MegasetCue[],
): MegasetCuePoint | null {
  return nearestMegasetCue(cues, MEGASET_HANDOFF_INTRO_S);
}

/** An optional candidate-pool cap (`?limit=`), shared by HTTP, CLI and MCP.
 * Omission means the whole downloaded DB census; an explicit value remains
 * bounded so a typo cannot trigger unbounded per-file TKEY reads. */
export const MEGASET_POOL_MIN = 1;
export const MEGASET_POOL_MAX = 1000;
/** Sentinel for an absent limit: inspect the whole downloaded DB census. */
export const MEGASET_POOL_UNLIMITED = 0;

/** Beam-search activation threshold: pools BELOW this size run a beam
 * continuation (width MEGASET_BEAM_WIDTH) instead of pure greedy — the
 * measured E7 result (docs/set/04-sequencing-benchmarks.md): sparse
 * pools dead-end greedy ~59% short of the best chain and beam recovers it
 * at ~0 ms. Big pools keep greedy (E2/E3: nothing to gain there). */
export const MEGASET_BEAM_POOL_MAX = 250;
/** Beam width. Kept beside the threshold so the engine and every UX
 * surface quote the same "deep search" contract, never a hand-copied twin. */
export const MEGASET_BEAM_WIDTH = 8;

/** B3 arc monotonicity (issue #105): the arc envelope is SAMPLED at slot
 *  t but nothing stopped local reversals — peak measured `6,7,7,6`. The
 *  fix: within each arc third (approach / hold / land), a candidate whose
 *  arousal moves the chain MORE than this ε AGAINST its segment's
 *  direction is penalized out of contention. On the 1–9 mood scale the
 *  mood ledger's own noise floor is ≈0.25, so ε=0.6 forgives jitter but
 *  not reversals. Held middle third is always directionless. */
export const MEGASET_AROUSAL_EPSILON = 0.6;

/** The excluded-reasons preview cap on the wire (`excluded[]`), shared by
 * the HTTP route, the CLI spoke and the web panel; `excluded_total` always
 * carries the full count. One constant so every surface says "first N". */
export const MEGASET_EXCLUDED_PREVIEW_MAX = 40;

/** A forced sequencer strategy (the A/B-compare override). */
export type SetSearchOverride = MegasetResult["search"];

/** Classify a raw `?search=` / `--search` / MCP `search` value: only the
 * exact strategy names override the automatic pool-size pick; anything
 * else (absent, typo) means "automatic". The HTTP route treats an
 * unknown value as automatic (explore control, not a contract param —
 * unlike preset, which IS a contract and 400s); stricter CLI/MCP callers
 * pre-check with this predicate so a typo'd A/B compare fails loudly
 * instead of silently comparing auto-vs-forced. */
export const isMegasetSearchOverride = (
  raw: string | null | undefined,
): raw is SetSearchOverride => raw === "greedy" || raw === "beam";

export function clampMegasetPool(raw: number | null | undefined): number {
  // Number(null) is 0, NOT NaN — null/undefined must be checked before
  // the coercion or an absent param clamps to 1 instead of the default.
  if (raw === null || raw === undefined) return MEGASET_POOL_UNLIMITED;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return MEGASET_POOL_UNLIMITED;
  return Math.min(MEGASET_POOL_MAX, Math.max(MEGASET_POOL_MIN, Math.round(n)));
}
