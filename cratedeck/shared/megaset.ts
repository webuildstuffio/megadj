// shared/megaset.ts — the set-builder wire seam.
//
// Split from shared/types.ts (file-length guard) following the same
// leaf-seam pattern as archive_types.ts / report_types.ts: the HTTP
// envelope (archive_routes.ts), the pure engine (src/megaset.ts) and
// the UI panel (web SimilarTab) all derive from THIS file — never a
// local twin (a local duplicate drifted once and crashed the render).

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
 *  doubles both satisfy it structurally. */
export function isShelfOffline(
  result: { steps: readonly unknown[] },
  census: Pick<
    MegasetPayload,
    "source_total" | "pool" | "missing_files" | "relocated_files"
  >,
): boolean {
  return (
    result.steps.length === 0 &&
    census.source_total > 0 &&
    census.missing_files + census.pool === census.source_total &&
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
}

export const MEGASET_PRESET_DEFS = [
  {
    id: "warmup",
    label: "Warm-up",
    description: "Slow-burn opener arc — builds gently into the night.",
    arousal: [2.5, 5.5],
    dance: [0.4, 0.7],
  },
  {
    id: "peak",
    label: "Peak time",
    description: "High energy throughout, slight lift toward the end.",
    arousal: [6, 8.5],
    dance: [0.7, 0.95],
  },
  {
    id: "afterhours",
    label: "After hours",
    description: "Starts deep and hypnotic, drifts darker and slower.",
    arousal: [5, 3],
    dance: [0.75, 0.6],
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
