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
  /** #284: the per-component breakdown of `transition` — tempo/key/arc
   *  fit/anchor/similarity contributions (weight × component), plus the
   *  final blend. null on the opener (no transition) and on a gated step
   *  (−1: the hop failed a hard gate, no components to show). Cross-build
   *  comparison reads THESE, not the pooled magnitude. */
  evidence: MegasetEvidence | null;
  /** S13 (#107): true when this track was pinned as a landmark must-play
   *  and slotted by the engine — the DJ's picks, visible in the chain. */
  landmark: boolean;
  /** #106: 8-bar boundary nearest the handoff overlap window — where
   *  the PREVIOUS track hands over (outro side of this step's end). */
  mixOutCue: MegasetCuePoint | null;
  /** #106: 8-bar boundary nearest the handoff overlap window — where
   *  THIS track can take over (intro side, a few phrases in). */
  mixInCue: MegasetCuePoint | null;
}

/** #284: one step's scoring evidence — the per-component contributions
 *  (each already weight-scaled) that produce `total`. Weights ride inside
 *  so a consumer can read tempo=0.45 and know the tempo term contributed
 *  its maximum without knowing MEGASET_TRANSITION_WEIGHTS. */
export interface MegasetEvidence {
  /** weight × bpmScore (the megasetTempoLane result — direct window or
   *  B8 half-time lane value). */
  tempo: number;
  /** weight × keyScore. */
  key: number;
  /** weight × arc fit (arousal+dance distance from the preset target). */
  arcFit: number;
  /** MEGASET_ANCHOR_WEIGHT × the anchored-tempo-target term. */
  anchor: number;
  /** MEGASET_SIMILARITY_WEIGHT × cosine-similarity prior (0 when either
   *  side has no embedding). */
  similarity: number;
  /** the B6 same-artist repeat penalty applied AFTER the weighted sum
   *  (0 = none; 3 = the repeat window). The blend is
   *  max(0.01, sum − penalty + 1) when this fires — the +1 floor keeps
   *  the penalized step ranked below every fresh-name peer. */
  artistPenalty: number;
  /** the final blend these components produce — EXACTLY the wire
   *  `transition` value (post-penalty, post-floor). */
  total: number;
  /** true when the tempo term came from the B8 half/double-time lane
   *  rather than the direct ±6% window — the lane is a discounted
   *  pairing, and the consumer should say so. */
  halftime: boolean;
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
   *  second bucket list). Examples cap at 4 per group. #291: budget-fill
   *  is NOT a bucket here — it is a status (`budget_filled`), so the
   *  groups carry only genuine quality reasons. */
  excluded_groups: {
    reason: string;
    count: number;
    examples: string[];
  }[];
  /** #291: how many candidates the time budget itself squeezed out —
   *  a STATUS, not a quality exclusion. Reported beside the groups so
   *  the real quality shape is never drowned by 3.5k true-but-noise
   *  rows (Sep 21 audit: 3,541 of 3,679 were budget-fill). */
  budget_filled: number;
  /** #283-followup: set-level quality stats — mean/lowest step transition
   *  (null on a single-step chain). Makes proposals comparable across
   *  presets/pools without hand-deriving from steps[]. */
  avg_transition: number | null;
  min_transition: number | null;
  /** B6 (#107): same-artist adjacency counts — the diversity guard lets a
   *  track by the SAME artist follow itself only outside the hard
   *  penalty window; these counters make the set's variety visible. */
  same_artist_pairs: number;
  /** B6 (#107): how many landmark pins could NOT be placed (unknown id,
   *  unmeasured tempo, arc-illegal) — honest cost of a bad pin, never
   *  silent. */
  landmarks_missing: string[];
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
  /** #283 genre pool filter: rows the `?genre=` LIKE matched BEFORE the
   *  filesystem census. 0 when no filter was passed — a filtered build
   *  is always visible, never a silent subset. */
  genre_filtered: number;
  /** #290: nearest known genre family when `--genre` matched 0 rows
   *  (absent when the filter matched, was absent, or nothing is near —
   *  the honest gap). Suggests the family the matcher DOES know. */
  genre_suggestion?: string | undefined;
  /** #286: measured per-stage wall-clock (ms). sql = ledger query,
   *  fileCheck = path existence/rebase, keyFills = key cache misses +
   *  live reads, engine = buildMegaset. The web phase list and the CLI
   *  epilogue render these — honest timing, not a fixed schedule. */
  stages_ms: {
    sql: number;
    fileCheck: number;
    keyFills: number;
    engine: number;
  };
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

/** #171 embeddings similarity prior: bonus (0..MEGASET_SIMILARITY_WEIGHT)
 *  added to transitionScore when BOTH candidates have embeddings in the
 *  ledger — "sounds like" is measured data (3,618+ tracks). Missing
 *  embeddings = no bonus, never a penalty (honest gap rule); the tempo
 *  anchor and key gates still decide mixability first (precedence). */
export const MEGASET_SIMILARITY_WEIGHT = 0.1;
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
 *  out without scanning hundreds of rows.
 *
 *  Sep 21 audit hardening: bucketing by the RAW reason string produced
 *  130 buckets for 3,681 exclusions on a real build ("68.2-minute…" and
 *  "68.6-minute…" were separate rows) — noise, not shape. Reasons now
 *  collapse to a small CLASSES first (sample-too-short / continuous-mix
 *  / no-beats-BPM / opener-unusable / incompatible / budget / unmeasured
 *  / other), with the specific numbers staying on the per-track rows.
 *  Biggest bucket first, examples capped at 4, `sum(count) ===
 *  excluded_total` when callers pass the full list (the CLI/web pass the
 *  capped preview; `total` is authoritative). */
export function megasetReasonClass(reason: string): string {
  if (reason.startsWith("set budget filled")) return "set budget filled";
  if (reason.startsWith("landmark")) return "landmark not placeable";
  if (reason.includes("below the") && reason.includes("track floor"))
    return "too short — audio sample, not a track";
  if (reason.includes("exceeds the") && reason.includes("track cap"))
    return "too long — continuous mix, not a single track";
  if (reason.includes("no beats-ledger BPM"))
    return "no measured tempo — run `megadj beats`";
  if (reason.includes("no compatible transition"))
    return "no compatible transition (key clash / tempo / drift)";
  if (reason.includes("requested opener")) {
    return reason.includes("not in the candidate pool")
      ? "requested opener not in the pool"
      : "requested opener unusable — no measured tempo";
  }
  return reason;
}

// ---- Sep 21: transition-score band calibration -----------------------------
// The chain-table pill used FIXED cut-offs (clean ≥0.75 / ok ≥0.5), set
// when transitionScore's core weights summed to 1.0 with no bonuses. B2
// (anchor +0.15) and #171 (similarity +0.1) lifted the reachable range —
// every live blend measured 1.10–1.19, so EVERY row read "clean" and the
// column carried no information. Bands are now derived from the weighted
// core's REAL floor and the live scale: "tight" starts below the worst a
// still-mixable step can score, "ok" sits in the mid band, "clean" in the
// upper. Derived here (the seam) so every surface quotes the same numbers.
/** The weighted-core floor for a MIXABLE step: every component at its
 *  worst passing value (tempo→0 boundary, key→neutral 0.5, arc fit→0)
 *  ≈ 0.3·0.5 = 0.15. Anything below cannot come from a healthy step. */
export const MEGASET_TIGHT_FLOOR = 0.5;
/** Bands: below MEGASET_TIGHT_FLOOR = "tight"; the mid band up to
 *  core-sum + half the bonus weight = "ok"; above = "clean". Pinned by
 *  the live measurement (blends 1.10–1.19 across three presets). */
export const MEGASET_CLEAN_FLOOR = 1.05;
export function megasetTransitionBand(score: number): {
  label: "clean" | "ok" | "tight";
  cls: "ok" | "muted";
} {
  if (score >= MEGASET_CLEAN_FLOOR) return { label: "clean", cls: "ok" };
  if (score >= MEGASET_TIGHT_FLOOR) return { label: "ok", cls: "ok" };
  return { label: "tight", cls: "muted" };
}

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
    // one CLASS per exclusion — the raw string (with per-track numbers)
    // stays on the excluded[] rows. #291: budget-fill is a status, not a
    // quality bucket — it never enters the groups.
    const reason = megasetReasonClass(e.reason);
    if (reason === "set budget filled") continue;
    let bucket = byReason.get(reason);
    if (!bucket) {
      bucket = { reason, count: 0, examples: [] };
      byReason.set(reason, bucket);
    }
    bucket.count += 1;
    if (bucket.examples.length < 4) bucket.examples.push(e.title ?? e.videoId);
  }
  return [...byReason.values()].toSorted((a, b) => b.count - a.count);
}

/** #291: the budget-fill COUNT — how many candidates the time budget
 *  squeezed out (a status, reported beside the quality groups; these
 *  rows are true but carry no quality signal). */
export function megasetBudgetFilledCount(
  excluded: readonly { reason: string }[],
): number {
  return excluded.filter(
    (e) => megasetReasonClass(e.reason) === "set budget filled",
  ).length;
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

// ---- #283 genre pool filter (one family matcher, all surfaces) -------------
/** Case-folded substring families: a `?genre=` value matches when ANY of
 *  these substrings appears in the track's genre — "house" matches "House",
 *  "Tech House", "Deep-house"; "tropical house" matches "Tropical Disco"-class
 *  strays only via its synonyms. One matcher: the SQL WHERE builder and the
 *  JS fallback both derive from THIS table — never a twin list. */
export const MEGASET_GENRE_FAMILIES: Record<string, string[]> = {
  house: ["house"],
  techno: ["techno"],
  "tropical house": ["tropical house", "tropical", "latin house", "baile"],
  "deep house": ["deep house", "deep-house"],
  "tech house": ["tech house", "tech-house"],
  "progressive house": ["progressive house", "prog house"],
  edm: ["edm", "electro house", "big room"],
  "hip-hop": ["hip-hop", "hip hop", "hiphop", "rap"],
  pop: ["pop"],
  trance: ["trance"],
  dnb: ["drum and bass", "drum & bass", "dnb", "jungle"],
  dubstep: ["dubstep"],
  disco: ["disco", "funky"],
  afrohouse: ["afro house", "afro-house", "afro latin house", "afro"],
};

/** The default cohort plan for `megadj megaset-cohorts` (#295): the
 *  families the Sep 21 genre-spread measurement showed can actually fill
 *  a 60-minute warmup+peak pair (EDM 683, House 633, Techno 501, Tech
 *  House 328 rows). Small cohorts (Deep House 134, Afro House 75) stay
 *  opt-in via `--families` — a 134-row pool can fill ONE arm but starves
 *  the pair. Order = spread order (biggest first). */
export const MEGASET_COHORT_FAMILIES: readonly string[] = [
  "edm",
  "house",
  "techno",
  "tech house",
];

/** Resolve a raw `?genre=` / `--genre` / MCP `genre` value to a match-term
 *  list. Exact family id wins ("tropical house"); then a family whose id or
 *  synonyms appear in the raw value ("tropical" → "tropical house"); last
 *  resort the raw value IS the substring (free-form, e.g. "gqom"). Empty
 *  for absent/blank: no filter — the unfiltered census, byte-identical. */
export function megasetGenreTerms(raw: string | null | undefined): string[] {
  const trimmed = raw?.trim().toLowerCase() ?? "";
  if (trimmed === "") return [];
  if (trimmed in MEGASET_GENRE_FAMILIES)
    return [trimmed, ...MEGASET_GENRE_FAMILIES[trimmed]!];
  for (const [family, synonyms] of Object.entries(MEGASET_GENRE_FAMILIES)) {
    if (trimmed.includes(family) || synonyms.some((s) => trimmed.includes(s))) {
      return [family, ...synonyms];
    }
  }
  return [trimmed];
}

/** #283 pool-starvation fallbacks: when a resolved family matches fewer
 *  than MEGASET_BEAM_POOL_MAX rows the matcher WIDENS to these parent
 *  families (strict terms first, then the fallbacks' terms appended in
 *  order — LIKE OR, so a row matching either counts). "tropical house"
 *  measured 10 strict rows (beam dead-end at 1 step); widening to house
 *  recovers a 1,436-row pool while tropical-labelled tracks still sort
 *  first in recency. Absent entry = no widening (free-form values stay
 *  literal). */
export const MEGASET_GENRE_FALLBACKS: Record<string, string[]> = {
  "tropical house": ["house"],
  "deep house": ["house"],
  "tech house": ["house"],
  "progressive house": ["house"],
  afrohouse: ["house"],
  dnb: [],
  dubstep: [],
};

/** #290: nearest-family suggestion for a `?genre=`/`--genre` value that
 *  resolved to a literal (free-form) term and matched nothing. Simple
 *  bounded edit distance over the family ids + synonyms — the matcher's
 *  vocabulary IS the suggestion list (one source, never a twin). Ties
 *  break alphabetically for determinism. Returns null when nothing is
 *  within distance 3 (a genuinely foreign term: the empty pool is the
 *  honest answer, a wrong suggestion would not be). */
export function megasetNearestGenreFamily(
  raw: string,
): { family: string; distance: number } | null {
  const needle = raw.trim().toLowerCase();
  if (needle === "") return null;
  let best: { family: string; distance: number } | null = null;
  for (const [family, synonyms] of Object.entries(MEGASET_GENRE_FAMILIES)) {
    const candidates = [family, ...synonyms];
    for (const word of candidates) {
      const d = boundedEditDistance(needle, word, 3);
      if (
        d !== null &&
        (best === null ||
          d < best.distance ||
          (d === best.distance && family < best.family))
      ) {
        best = { family, distance: d };
      }
    }
  }
  return best;
}

/** Levenshtein distance with an early bailout: null once the distance
 *  provably exceeds `max` (band-row DP, O(min(m,n)) space). */
function boundedEditDistance(a: string, b: string, max: number): number | null {
  if (Math.abs(a.length - b.length) > max) return null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return null;
    prev = cur;
  }
  const d = prev[b.length]!;
  return d <= max ? d : null;
}

/** #290: the pool-starvation fallback for a genre value — resolved by
 *  FAMILY, not by raw string. The old raw-string lookup meant
 *  `--genre tropical` (which resolves to the tropical-house family via
 *  the synonym scan) never widened to house while `--genre "tropical
 *  house"` did — the same pool, two different starvation behavior.
 *  Free-form values with no family still return null (literal stays
 *  literal). */
export function megasetGenreFallbackTerms(
  raw: string | null | undefined,
): string[] | null {
  const trimmed = raw?.trim().toLowerCase() ?? "";
  if (trimmed === "") return null;
  if (trimmed in MEGASET_GENRE_FALLBACKS)
    return MEGASET_GENRE_FALLBACKS[trimmed]!;
  // a synonym/substring hit resolves to its family ("tropical" →
  // tropical house) so the widening rule follows the matcher, not the
  // caller's spelling
  for (const [family, synonyms] of Object.entries(MEGASET_GENRE_FAMILIES)) {
    if (trimmed.includes(family) || synonyms.some((s) => trimmed.includes(s)))
      return MEGASET_GENRE_FALLBACKS[family] ?? null;
  }
  return null;
}

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

// ---- B6 + B8 + S13 (#107): the diversity / half-time / landmark seam ------
// Three shipped-together engine improvements (Sep 21, "way better sets"):
// B6 stops one artist dominating a set, B8 lets a 87↔174 half-time pairing
// score, S13 lets the DJ pin must-plays the engine must slot. All constants
// live HERE so every surface quotes the same numbers — never a twin.

/** B6: max tempo distance (relative) a same-artist step may sit at before
 *  the diversity penalty makes it lose to every differently-named peer.
 *  Not a hard gate: an artist's own record CAN close the set when nothing
 *  else fits — it just never wins a contest against fresh names. */
export const MEGASET_ARTIST_REPEAT_WINDOW = 3;

/** B8: score multiplier for a half/double-time PAIRING (bpmScore's 0 at
 *  ±6%+ otherwise). The branch lane already admits 2×/½× tracks past the
 *  drift budget; without this term their tempo component scored 0 and
 *  they never won a slot — "87 vs 174 DnB scores 0 today" (#107 B8).
 *  0.9× = the plan-of-record value (03-competitive-analysis item 6). */
export const MEGASET_HALFTIME_PENALTY = 0.9;

/** B8: how close (relative) a candidate must sit to 2×, ½× (and ×1.5
 *  half-time feel) of `a`'s BPM to pair with it. Mirrors the drift
 *  budget's branch tolerance — one number for "what counts as half-time
 *  here" everywhere. */
export const MEGASET_HALFTIME_TOLERANCE = 0.06;

/** B8 pure predicate: is `bpm` near a ×2 / ×0.5 / ×1.5 multiple of `a`?
 *  The ×1.5 lane covers the classic half-time FEEL (87 trap under a 130
 *  house set is a 1.49× relationship in raw BPM). Exported for tests +
 *  future surfaces; transitionScore is the production consumer. */
export function isMegasetHalfTimePair(a: number, b: number): boolean {
  for (const factor of [2, 0.5, 1.5, 2 / 3]) {
    if (Math.abs(b / (a * factor) - 1) <= MEGASET_HALFTIME_TOLERANCE)
      return true;
  }
  return false;
}

/** B6: case-folded head-credit artist key (null when the row has no
 *  artist) — the SAME normalization the pool's dedupe uses for credit
 *  lists, so the diversity guard and the dedupe cannot disagree about
 *  who an artist is. */
export function megasetArtistKey(artist: string | null): string | null {
  if (artist === null) return null;
  const head = artist.split(",")[0]?.trim() ?? "";
  const folded = head.toLocaleLowerCase("en-US").trim();
  return folded === "" ? null : folded;
}

/** B6: the diversity penalty for following `prev` with `c` — 0 when the
 *  names differ (or either side is unknown: no penalty, never a guess),
 *  MEGASET_ARTIST_REPEAT_WINDOW when the SAME artist would run back-to-
 *  back. transitionScore subtracts it (floored at 0 upstream). */
export function megasetArtistRepeatPenalty(
  prev: { artist: string | null },
  c: { artist: string | null },
): number {
  const a = megasetArtistKey(prev.artist);
  const b = megasetArtistKey(c.artist);
  if (a === null || b === null) return 0;
  return a === b ? MEGASET_ARTIST_REPEAT_WINDOW : 0;
}
