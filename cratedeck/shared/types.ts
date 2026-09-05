// CrateDeck shared types — imported by server and web.

export type DriveRole = "master" | "mirror" | "library" | "unknown";

export type DriveState = "mounting" | "mounted" | "ghost";

export interface Drive {
  id: string;
  volume_uuid: string | null;
  name: string; // volume name (technical)
  nickname: string | null; // user name (e.g. "Resident Crate")
  photo_path: string | null;
  capacity_bytes: number;
  fs: string | null;
  vendor: string | null;
  model: string | null;
  usb_serial: string | null;
  role: DriveRole;
  first_seen_at: number;
  last_seen_at: number;
  last_port_key: string | null;
  plug_count: number;
  mounted: boolean;
  state: DriveState; // derived, not stored
  last_snapshot_json: string | null;
  predecessor_id: string | null;
  /** Latest structured verify report (from parseVerifyReport), JSON-encoded. */
  verify_report_json: string | null;
}

export interface Badge {
  key:
    | "ready"
    | "stale"
    | "attn"
    | "ghost"
    | "scanning"
    | "insync"
    | "behind"
    | "diverged"
    | "unknown";
  label: string;
  tone: "good" | "warn" | "bad" | "muted" | "info";
}

/** Wire shape for a drive card: the Drive row flattened with its computed
 *  badges (server spreads `{...drive, badges}`; web consumes it directly).
 *  `last_snapshot_json` is stripped on the wire (payload is MBs); the four
 *  counts cards actually use ride along as `snapshot_summary`. */
export type DriveCardData = Omit<Drive, "last_snapshot_json"> & {
  badges: Badge[];
  snapshot_summary: {
    track_count?: number;
    file_count?: number;
    capacity_bytes?: number;
    free_bytes?: number | null;
  } | null;
};

export interface PlaylistInfo {
  name: string;
  entries: number;
  parent: string | null;
}

export interface SnapshotData {
  kind: "light" | "full";
  taken_at: number;
  // light scan
  file_count?: number;
  total_bytes?: number;
  folders?: { name: string; files: number; bytes: number }[];
  junk?: {
    zero_byte: string[];
    case_collisions: string[];
    orphan_resource_forks: number;
  };
  // space analysis
  free_bytes?: number | null;
  capacity_bytes?: number;
  by_ext?: { ext: string; files: number; bytes: number }[];
  largest?: { path: string; bytes: number }[];
  age?: { fresh: number; recent: number; old: number; ancient: number };
  // full (rekordbox) scan
  track_count?: number;
  total_duration_ms?: number;
  playlists?: PlaylistInfo[];
  grid_coverage?: number; // 0..1, ANLZ at hash path
  pdb_live_rows?: number; // legacy export.pdb
  onelibrary_rows?: number;
  db_mtime?: number;
  pdb_mtime?: number;
  // DJ metadata (rekordbox columns)
  dj?: DjStats;
  // fleet superpowers (§B6/B7/B8 inputs; light scan gives manifest, full scan
  // adds tracks + playlist_entries; absent = not collected by older scans)
  /** Per-track inventory from the device DB (audio rows only). */
  tracks?: {
    path: string; // NFC-casefolded, Contents-relative
    title: string | null;
    artist: string | null;
    bpm: number | null;
    key: string | null;
    duration_ms: number | null;
  }[];
  /** Playlist membership: one row per (playlist, track). */
  playlist_entries?: { playlist_name: string; track_path: string }[];
  /** Audio files from the walk — byte truth for fleet diffs. */
  manifest?: { path: string; bytes: number; mtime_ms: number }[];
}

/** DJ-library analytics from the rekordbox device DB. */
export interface DjStats {
  genres?: { name: string; count: number }[];
  bpm_min?: number;
  bpm_max?: number;
  bpm_median?: number;
  bpm_histogram?: { bucket: string; count: number }[];
  keys?: { name: string; count: number }[];
  artists_top?: { name: string; count: number }[];
  duration?: {
    shortest_s: number;
    longest_s: number;
    median_s: number;
    average_s: number;
  };
  bitrate?: {
    lossless: number;
    lossy_high: number;
    lossy: number;
    unknown: number;
  };
  artwork_missing?: number;
  artwork_total?: number;
}

export type JobKind = "scan" | "verify" | "mirror" | "benchmark" | "checksum";
export type JobStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "interrupted"
  | "cancelled"
  | "locked";

/** Terminal = no further transitions possible (locked is a blocked state,
 *  queued/running are live). Single source of truth for deckapi.jobTerminal
 *  and the web JobsDock history filter. */
export const TERMINAL_JOB_STATUSES = [
  "done",
  "failed",
  "cancelled",
  "interrupted",
] as const satisfies readonly JobStatus[];

/** Live (non-terminal, non-blocked) statuses. */
export const ACTIVE_JOB_STATUSES = [
  "queued",
  "running",
] as const satisfies readonly JobStatus[];

export interface Job {
  id: string;
  drive_id: string;
  kind: JobKind;
  status: JobStatus;
  progress: number; // 0..1
  /** Human-readable current step, e.g. "hashing 1,204/8,911 files". */
  message: string | null;
  /** Coarse stage for progress bar segmentation. */
  phase: string | null;
  /** Seconds remaining estimate (null while unknown). */
  eta_seconds: number | null;
  error: string | null;
  result_json: string | null;
  log_path: string | null; // schema column; unused by jobs.ts yet
  /** O87 attribution: "web" | "deckctl" | "auto" | "mcp:<id>" — who asked
   *  for this job. Optional in the type (legacy literals); the jobs table
   *  column defaults to 'web', and enqueue() always sets it. */
  origin?: string;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface TimelineEvent {
  id: string;
  drive_id: string;
  at: number;
  kind: string;
  data: Record<string, unknown>;
}

/** One verification/health check with a verdict. Declared before VerifyCheck
 *  (which references its status union). */
export interface HealthCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "unknown";
  detail: string;
  /** suggestion shown when status != pass */
  fix?: string;
}

/** One granular verify check — mirrors HealthCheck but for usb_verify output. */
export interface VerifyCheck {
  id: string;
  label: string;
  status: HealthCheck["status"];
  detail: string;
  /** Plain-English: why does this check matter for a DJ? */
  meaning: string;
  fix?: string;
  /** The offending track paths (capped) — exactly WHAT needs attention. */
  offenders?: string[];
  /** How many offenders exist in total (offenders may be truncated). */
  offender_count?: number;
}

/** Per-check direction vs the previous run (fewer = improving). */
export interface VerifyDelta {
  check_id: string;
  label: string;
  /** +N more offenders than last run, −N fewer. 0/no-entry = unchanged. */
  delta: number;
  prev_status: VerifyCheck["status"] | null;
  prev_count: number;
  count: number;
}

/** Full structured result of a verify run, stored per drive. */
export interface VerifyReport {
  ran_at: number;
  ok: boolean;
  final: string | null;
  duration_s: number | null;
  checks: VerifyCheck[];
  /** Raw counts from the script (tracks, playlists, pioneer variance…). */
  stats: Record<string, number>;
  summary: string;
  /** Comparison against the previous stored run, when one existed. */
  deltas?: VerifyDelta[];
  prev_ran_at?: number | null;
}

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
    type: "playlist" | "folder" | "track";
    name: string;
    entries?: number;
  }[];
}

/** Full drive dossier served by /api/report. */
export interface DriveReport {
  drive: Drive;
  snapshot: SnapshotData | null;
  checks: HealthCheck[];
  sync: { verdict: string; missing?: number } | null;
  master_name: string;
  generated_at: number;
}

// ---- fleet superpowers (docs/ideas.md §B6/B7/B8) -----------------------------

/** Wire shape of the coverage matrix + at-risk list. Re-exports the pure
 *  engine's shapes so web/deckctl share one source of truth. */
export type {
  TrackRow,
  PlaylistEntryRow,
  ManifestRow,
  TrackCoverage,
  CoverageResult,
  CoverageResponse,
  PlaylistRedundancy,
  RedundancyResult,
  DiffRow,
  FleetDiff,
  DiffKind,
} from "../src/fleet";
