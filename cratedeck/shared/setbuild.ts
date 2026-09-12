// shared/setbuild.ts — the set-builder (M66) wire seam.
//
// Split from shared/types.ts (file-length guard) following the same
// leaf-seam pattern as archive_types.ts / report_types.ts: the HTTP
// envelope (archive_routes.ts), the pure engine (src/setbuild.ts) and
// the UI panel (web SimilarTab) all derive from THIS file — never a
// local twin (a local duplicate drifted once and crashed the render).

export interface SetBuildStep {
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

export interface SetBuildResult {
  preset: string;
  minutes: number;
  steps: SetBuildStep[];
  /** candidates excluded from the chain, with the reason — the honest
   * "why isn't my track in here" list */
  excluded: { videoId: string; title: string | null; reason: string }[];
}

/** The GET /api/archive/setbuild response envelope. */
export interface SetBuildPayload extends SetBuildResult {
  available: boolean;
  pool: number;
  excluded_total: number;
  /** Ledger ages for the newest beats/mood analysis — a stale pool is
   *  VISIBLE ("proposed from analysis older than your latest drops"),
   *  never silent. Null when that ledger is empty. */
  freshness: { beatsAt: string | null; moodAt: string | null };
}

/** Set-builder energy-arc presets — the ONE registry all three surfaces
 *  derive from: the engine (src/setbuild.ts) scores against these
 *  envelopes, the route validates `?preset=` against these ids, and the
 *  UI renders the picker + descriptions from this table. Envelopes:
 *  arousal on the 1–9 mood scale, danceability on 0–1; [start, end] =
 *  the arc's target at the first/last slot. */
export interface SetPresetDef {
  id: "warmup" | "peak" | "afterhours";
  label: string;
  description: string;
  /** arousal envelope [start, end] on the 1–9 scale. */
  arousal: [number, number];
  /** danceability envelope [start, end] on the 0–1 scale. */
  dance: [number, number];
}

export const SET_PRESET_DEFS: SetPresetDef[] = [
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
];

export type SetPresetId = SetPresetDef["id"];

/** The `?preset=` guard rail: the engine clamps minutes, but an unknown
 *  preset id is a caller bug — surfaced, never silently re-scored as
 *  peak-time (the old `SET_PRESETS[bad] ?? peak` fallback hid it). */
export const SET_PRESET_IDS: SetPresetId[] = SET_PRESET_DEFS.map((p) => p.id);

export const DEFAULT_SET_PRESET: SetPresetId = "peak";

export const SET_MINUTES_MIN = 10;
export const SET_MINUTES_MAX = 240;
export const SET_MINUTES_DEFAULT = 60;

/** The candidate-pool cap (`?limit=`), shared by the HTTP route and the MCP
 * tool — the MCP schema documents "max 1000" but the route never clamped,
 * so ?limit=99999 sailed straight into per-file TKEY reads (400 sync file
 * I/O calls per request). One clamp, both surfaces. */
export const SET_POOL_MIN = 1;
export const SET_POOL_MAX = 1000;
export const SET_POOL_DEFAULT = 300;

export function clampSetPool(raw: number | null | undefined): number {
  // Number(null) is 0, NOT NaN — null/undefined must be checked before
  // the coercion or an absent param clamps to 1 instead of the default.
  if (raw === null || raw === undefined) return SET_POOL_DEFAULT;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return SET_POOL_DEFAULT;
  return Math.min(SET_POOL_MAX, Math.max(SET_POOL_MIN, Math.round(n)));
}
