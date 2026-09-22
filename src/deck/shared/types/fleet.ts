// shared/types/fleet.ts — the fleet superpowers wire domain (#196,
// docs/ideas.md §B6/B7/B8): coverage rows, redundancy, A/B diffs, and
// the track-location lookup. The fleet wire types are DEFINED here (not
// re-exported from src/fleet): src/fleet.ts is a pure engine that needs
// RedundancyVerdict from the drive sibling, so defining its row/result
// shapes in types/ keeps the graph one-way (src/fleet → shared/types).
import type { RedundancyVerdict } from "./drive";

/** One track in a drive inventory (populated by the DB reader). */
export interface TrackRow {
  drive_id: string;
  /** NFC-casefolded path relative to Contents/ (audio files only). */
  path: string;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  key: string | null;
  duration_ms: number | null;
  /** Playlist memberships for this track (populated by the DB reader). */
  playlist_names?: string[];
}

/** One playlist-membership row: (drive, playlist, track). */
export interface PlaylistEntryRow {
  drive_id: string;
  /** Casefolded path in track_tracks (matches TrackRow.path). */
  track_path: string;
  playlist_name: string;
}

/** One file in a drive's audio manifest (from the light scan walk). */
export interface ManifestRow {
  drive_id: string;
  path: string; // casefolded, Contents-relative
  bytes: number;
  mtime_ms: number;
}

/** One unique track's presence across the fleet. */
export interface TrackCoverage {
  identity: { path: string; title: string | null; artist: string | null };
  /** drive_ids that carry this track */
  drives: string[];
  /** number of drives, repeated for sort/display convenience */
  copies: number;
  /** true when copies < required (the "gone forever if one fails" list) */
  at_risk: boolean;
}

export interface CoverageResult {
  /** drives that actually contributed an inventory (skipped empty ones) */
  drives: { id: string; tracks: number }[];
  /** one row per unique track across the fleet */
  rows: TrackCoverage[];
  /** tracks that exist on exactly `minCopies` drives or fewer */
  at_risk: TrackCoverage[];
  min_copies: number;
  totals: { unique_tracks: number; fully_redundant: number };
}

/** What GET /api/fleet/coverage actually returns: the engine result with
 *  display names merged into `drives` and the huge matrix dropped. */
export type CoverageResponse = Omit<CoverageResult, "drives" | "rows"> & {
  drives: { id: string; name: string; tracks: number }[];
  rows?: undefined;
};

/** Minimal drive reference used across fleet payloads (diff A/B pickers,
 *  track-location hits) — id plus DISPLAY name, mounted when known. */
export interface DriveRef {
  id: string;
  name: string;
  mounted?: boolean | undefined;
}

/** Wire shape of GET /api/fleet/track — which drives carry one track
 *  (identity null = the query matched nothing). Produced by the route in
 *  src/index.ts from fleet.trackLocations + display-name merge; the web
 *  coverage tab derives its hit type from here (never re-declares it). */
export interface TrackLocationsResponse {
  identity: {
    path: string;
    title: string | null;
    artist: string | null;
  } | null;
  drives: DriveRef[];
}

/** Redundancy verdict for one playlist, with its gap detail. */
export interface PlaylistRedundancy {
  playlist: string;
  /** unique tracks in the playlist across every drive that has it */
  unique_tracks: number;
  /** tracks meeting the floor */
  protected_tracks: number;
  tracks: (TrackCoverage & { playlists: string[] })[];
  verdict: RedundancyVerdict;
  detail: string;
}

export interface RedundancyResult {
  playlists: PlaylistRedundancy[];
  /** fleet-wide verdict across all audited playlists */
  overall: RedundancyVerdict;
  summary: string;
}

export type DiffKind = "added" | "removed" | "changed";

export interface DiffRow {
  path: string;
  title: string | null;
  artist: string | null;
  kind: DiffKind;
  /** source-side size/bytes when known (file manifests) */
  bytes_a?: number;
  bytes_b?: number;
}

export interface FleetDiff {
  a: string;
  b: string;
  added: DiffRow[]; // on b, missing on a
  removed: DiffRow[]; // on a, missing on b
  changed: DiffRow[]; // both present, bytes differ
  summary: string;
}
