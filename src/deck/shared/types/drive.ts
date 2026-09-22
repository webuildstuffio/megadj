// shared/types/drive.ts — the drive wire domain (#196): the Drive row,
// its verdict/status unions, cards, badges, snapshots, and the report
// dossier. Split out of the 846-line types.ts monolith; shared/types.ts
// re-exports everything here so existing `from "./"`
// imports keep compiling (the leaf stays the leaf).
import type { HygieneBadge } from "../hygiene";

export type DriveRole = "master" | "mirror" | "shelf" | "library" | "unknown";

export type DriveState = "mounting" | "mounted" | "ghost";

/** Per-check verdict shared by HealthCheck and VerifyCheck. */
export type CheckStatus = "pass" | "warn" | "fail" | "unknown";

/** Aggregate drive verdict (preflight B12). Worst-status-wins. */
export type PreflightVerdict = "ready" | "attention" | "not-ready" | "unknown";

/** Aggregate drive verdict for the deep report Health tab. */
export type OverallHealth = "healthy" | "attention" | "critical" | "unknown";

/** Playlist redundancy verdict (fleet §B7). */
export type RedundancyVerdict = "pass" | "warn" | "fail" | "unknown";

/** Agent-note severity (O88), rendered as the card tone. Default "info". */
export type NoteSeverity = "info" | "warn" | "critical";

/** Master/mirror snapshot-count comparison (report + DrivePage). */
export type SyncVerdict = "in-sync" | "behind" | "unknown";

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
  /** Negotiated USB link rate in bits/s (ioreg UsbLinkSpeed; null = unknown).
   *  Powers the USB 2.0 vs 3.0 flag — see usbLinkClass in src/detect.ts. */
  link_bps: number | null;
  plug_count: number;
  mounted: boolean;
  state: DriveState; // derived, not stored
  last_snapshot_json: string | null;
  predecessor_id: string | null;
  /** Latest structured verify report (from parseVerifyReport), JSON-encoded. */
  verify_report_json: string | null;
}

/** The megadj archive DB's shelf_sweeps ledger row, as surfaced on drive
 *  cards (server joins by volume name; null when never swept / ledger off). */
export interface ShelfSweepSummary {
  drive: string;
  verdict: string; // complete | preview | failed | running
  files_seen: number;
  copied: number;
  preserved: number;
  started_at: string;
  finished_at: string | null;
  /** days since finish — the UI ambers past ~30 */
  ageDays: number | null;
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

/** Compact per-drive report row for the rail (/api/reports): verdict plus
 *  a real SCORE ("8 of 10 checks passed"), never a binary yes/no. */
export interface ReportSummary {
  overall: OverallHealth;
  /** weighted 0..1 quality (warn=0.6, unknown=0.3) — animates the state chip */
  pass_rate: number;
  /** checks that earned full credit — the numerator of the score line */
  passed: number;
  /** every check the report scored — the denominator */
  checks: number;
  /** failing checks — the "N to fix" count */
  failed: number;
  /** warning checks — the "N warnings" count */
  warned: number;
  /** checks with no verdict yet (honest unknowns, never faked healthy) */
  unknown: number;
}

/** Wire shape for a drive card: the Drive row flattened with its computed
 *  badges (server spreads `{...drive, badges}`; web consumes it directly).
 *  `last_snapshot_json` is stripped on the wire (payload is MBs); the four
 *  counts cards actually use ride along as `snapshot_summary`. */
export type DriveCardData = Omit<Drive, "last_snapshot_json"> & {
  badges: Badge[];
  /** Latest drive→shelf sweep verdict from the megadj archive ledger. */
  shelf_sweep: ShelfSweepSummary | null;
  /** Shelf-hygiene census — shelf drive only, null elsewhere (§4.3). */
  hygiene: HygieneBadge | null;
  snapshot_summary: {
    track_count?: number;
    file_count?: number;
    capacity_bytes?: number;
    free_bytes?: number | null;
    /** live `df` measurement taken at payload build (null = df failed /
     *  volume gone — the UI falls back to snapshot truth, then to "—") */
    live_free_bytes?: number | null;
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
  file_count?: number | undefined;
  total_bytes?: number | undefined;
  folders?: { name: string; files: number; bytes: number }[] | undefined;
  junk?:
    | {
        zero_byte: string[];
        case_collisions: string[];
        orphan_resource_forks: number;
      }
    | undefined;
  // space analysis
  free_bytes?: number | null | undefined;
  capacity_bytes?: number | undefined;
  by_ext?: { ext: string; files: number; bytes: number }[] | undefined;
  largest?: { path: string; bytes: number }[] | undefined;
  age?:
    { fresh: number; recent: number; old: number; ancient: number } | undefined;
  // full (rekordbox) scan
  track_count?: number | undefined;
  total_duration_ms?: number | undefined;
  playlists?: PlaylistInfo[] | undefined;
  grid_coverage?: number | undefined; // 0..1, ANLZ at hash path
  pdb_live_rows?: number | undefined; // legacy export.pdb
  onelibrary_rows?: number | undefined;
  db_mtime?: number | undefined;
  pdb_mtime?: number | undefined;
  // DJ metadata (rekordbox columns)
  dj?: DjStats | undefined;
  // fleet superpowers (§B6/B7/B8 inputs; light scan gives manifest, full scan
  // adds tracks + playlist_entries; absent = not collected by older scans)
  /** Per-track inventory from the device DB (audio rows only). */
  tracks?:
    | {
        path: string; // NFC-casefolded, Contents-relative
        title: string | null;
        artist: string | null;
        bpm: number | null;
        key: string | null;
        duration_ms: number | null;
      }[]
    | undefined;
  /** Playlist membership: one row per (playlist, track). */
  playlist_entries?:
    { playlist_name: string; track_path: string }[] | undefined;
  /** Audio files from the walk — byte truth for fleet diffs. */
  manifest?: { path: string; bytes: number; mtime_ms: number }[] | undefined;
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

/** One verification/health check with a verdict. Declared before VerifyCheck
 *  (which references its status union). */
export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** suggestion shown when status != pass */
  fix?: string | undefined;
}

/** Full drive dossier served by /api/report. */
export interface DriveReport {
  drive: Drive;
  snapshot: SnapshotData | null;
  checks: HealthCheck[];
  sync: { verdict: SyncVerdict; missing?: number } | null;
  master_name: string;
  generated_at: number;
}

// ---- drive cover photos: one image listed by GET /drives/:id/drive-images.
// DEFINED here canonically (like every wire type) — an earlier version
// derived it from the producer (`src/images.ts listDriveImages`), but
// images.ts type-imports db.ts → fleet-db.ts → fleet.ts → shared/types.ts,
// so the type-only back-edge made madge report a real cycle (Sep 9 sweep).
// The producer imports this shape instead.
export interface DriveImage {
  /** Path on the mounted volume, relative to the mount point. */
  rel: string;
  /** Served URL for the <img> preview. */
  url: string;
  bytes: number;
}
