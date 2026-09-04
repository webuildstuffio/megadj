// CrateDeck shared types — imported by server and web.

export type DriveRole = "master" | "mirror" | "library" | "unknown";

export type DriveState = "mounting" | "mounted" | "ghost";

export interface Drive {
  id: string;
  volume_uuid: string | null;
  name: string; // volume name (technical)
  nickname: string | null; // user name (e.g. "OLDBACKUP")
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

/** One verification/health check with a verdict. */
export interface HealthCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "unknown";
  detail: string;
  /** suggestion shown when status != pass */
  fix?: string;
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
