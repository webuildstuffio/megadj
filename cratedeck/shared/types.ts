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
 *  badges (server spreads `{...drive, badges}`; web consumes it directly). */
export type DriveCardData = Drive & { badges: Badge[] };

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
  // full (rekordbox) scan
  track_count?: number;
  total_duration_ms?: number;
  playlists?: PlaylistInfo[];
  grid_coverage?: number; // 0..1, ANLZ at hash path
  pdb_live_rows?: number; // legacy export.pdb
  onelibrary_rows?: number;
  db_mtime?: number;
  pdb_mtime?: number;
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
