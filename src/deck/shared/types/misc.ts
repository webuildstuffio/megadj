// shared/types/misc.ts — the cross-domain odds and ends (#196): search,
// ports, the RB interlock state, and the archive-reads re-export. Split
// out of the 846-line types.ts monolith.

export interface PortInfo {
  port_key: string;
  label: string | null;
  drive_id: string | null;
  drive_name: string | null;
  mounted: boolean;
  last_seen_at: number | null;
}

export interface InterlockState {
  rekordbox_running: boolean;
  pid: number | null;
}

export interface SearchResult {
  drive_id: string;
  drive_name: string;
  mounted: boolean;
  matches: {
    type: "playlist" | "folder" | "track" | "drive";
    name: string;
    entries?: number;
  }[];
}

// ---- new-music radar (#148, PRD F10): wire types moved to shared/radar.ts --
// (the megaset.ts precedent — shared/types is the import leaf, but the
// leaf re-exports so existing `from "./"` callers don't move.)
export type { RadarMiss, RadarResult, FleetRadar } from "../radar";

// ---- genre vote ladder: rung display metadata lives in
// shared/genre-vote-rungs.ts (leaf of the leaf — imports nothing). The
// weights SSOT is src/fulltags/genre/genre-vote.ts; the UI renders the
// FULL ladder from this table (abstained rungs included), never a local
// twin. Re-exported so `../shared/types` callers don't move.
export { genreVoteRungsInOrder } from "../genre-vote-rungs";

// ---- archive reads: one browser-safe contract for producers + consumers ---
// The dedicated shared leaf owns the wire shapes. Server producers annotate
// against it; the browser re-exports it from this established import surface.
export type {
  ArchiveAnalysisCoverage,
  ArchiveCueStats,
  ArchiveGenreWhy,
  ArchiveGridCrossCheck,
  ArchiveIngestStatus,
  ArchiveLibraryOverview,
  ArchiveLowqQueue,
  ArchiveMoodProfile,
  ArchiveSearchHit,
  ArchiveSimilar,
  ArchiveSkipCensus,
  ArchiveSourceCensus,
  ArchiveTagCensus,
  ArchiveTagCensusRow,
  ArchiveTrackTagCompare,
} from "../archive-wire";

// ---- set-builder: lives in shared/megaset.ts (the set-builder wire
// seam — the original file-length split; re-exported so existing
// `from "../types"` consumers keep working with zero drift risk
// (re-export, never a twin).
export type {
  MegasetStep,
  MegasetResult,
  MegasetPayload,
  MegasetPresetDef,
  MegasetPresetId,
} from "../megaset";
export {
  MEGASET_PRESET_DEFS,
  MEGASET_PRESET_IDS,
  DEFAULT_MEGASET_PRESET,
  MEGASET_MINUTES_MIN,
  MEGASET_MINUTES_MAX,
  MEGASET_MINUTES_DEFAULT,
  MEGASET_TRACK_MINUTES_MIN,
  MEGASET_TRACK_MINUTES_MAX,
  MEGASET_TEMPO_PERFECT,
  MEGASET_TEMPO_WINDOW,
  MEGASET_TRANSITION_WEIGHTS,
  MEGASET_ANCHOR_WEIGHT,
  MEGASET_SIMILARITY_WEIGHT,
  MEGASET_DRIFT_BUDGET,
  MEGASET_BRANCH_TOLERANCE,
  MEGASET_AROUSAL_EPSILON,
  MEGASET_POOL_MAX,
  MEGASET_POOL_UNLIMITED,
  groupMegasetExcluded,
  megasetReasonClass,
  megasetTransitionBand,
  megasetNearestGenreFamily,
  megasetBudgetFilledCount,
  MEGASET_GENRE_FAMILIES,
  MEGASET_COHORT_FAMILIES,
  type MegasetEvidence,
  MEGASET_BEAM_POOL_MAX,
  MEGASET_BEAM_WIDTH,
  MEGASET_EXCLUDED_PREVIEW_MAX,
  MEGASET_HANDOFF_OVERLAP_S,
  MEGASET_HANDOFF_INTRO_S,
  megasetMixOutCue,
  megasetMixInCue,
  nearestMegasetCue,
  isMegasetSearchOverride,
  isShelfOffline,
  isMegasetHalfTimePair,
  megasetArtistKey,
  megasetArtistRepeatPenalty,
  MEGASET_HALFTIME_PENALTY,
  type SetSearchOverride,
  clampMegasetPool,
} from "../megaset";
