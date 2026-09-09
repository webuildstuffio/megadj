// CrateDeck shared types — imported by server and web.
//
// DEPENDENCY RULE (enforced by `bunx madge --circular cratedeck/src
// cratedeck/shared cratedeck/web`): this file is the leaf of the graph.
// It may import NOTHING from src/ — every wire type used across the
// server/web boundary is DEFINED here, and src/ producers import their
// wire shapes FROM here. Re-exporting producer types from this file
// created four shared/types → src cycles (fleet/notes/players/preflight),
// which made the pre-commit hook block any staged edit to types.ts.

export type DriveRole = "master" | "mirror" | "shelf" | "library" | "unknown";

export type DriveState = "mounting" | "mounted" | "ghost";

// ---- canonical verdict/status unions (one definition, imported everywhere) --

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

/** Subset of a Drive the preflight payload needs on the wire. */
export type PreflightDriveInfo = Pick<
  Drive,
  "id" | "name" | "nickname" | "mounted"
>;

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

/** Client-side stamp: when THIS browser last received the row from a jobs
 *  fetch. The server never sends it — the web client attaches it after
 *  each fetch (App's refreshJobs) so JobsDock can measure per-row
 *  staleness client-side (a frozen progress + a fresh fetch = the server
 *  really isn't moving). Declared here because it rides the Job wire type
 *  through the fetch-merge pipeline. */
export interface Job extends WireJob {
  /** client-only; optional so server rows typecheck as Job too */
  _received?: number;
}

export interface WireJob {
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
  status: CheckStatus;
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
    type: "playlist" | "folder" | "track" | "drive";
    name: string;
    entries?: number;
  }[];
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

// ---- fleet superpowers (docs/ideas.md §B6/B7/B8) -----------------------------
//
// The fleet wire types are DEFINED here (not re-exported from src/fleet):
// src/fleet.ts is a pure engine that needs RedundancyVerdict from this file,
// so defining its row/result shapes here keeps the graph one-way
// (src/fleet → shared/types). Both the engine and the web/deckctl
// consumers import these from the same place — one source of truth, zero
// cycles.

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

// ---- archive reads (O82b): one SSOT for the JSON the archive routes serve ----
//
// Derived from `ArchiveReader`'s method return types (the actual producers)
// so a web component that re-declares these shapes locally drifts straight
// into a compile error instead of rendering `Invalid Date` / `undefined` in
// production (the Sep 7 ArchiveTab bug class).
// These are type-only `import()`s from src/archive.ts — an ACYCLIC edge by
// audit (Sep 9 madge sweep): src/archive must never import shared/types.ts
// back. Wire shapes whose producer chain reaches shared/types.ts (e.g.
// anything importing db/fleet) must be DEFINED here instead — a type-only
// derivation from those producers closes a real cycle (the DriveImage →
// images → db → fleet-db → fleet → shared/types loop). Same rule for the
// archive split modules: they type against the ArchiveQuery seam in
// cratedeck/src/archive_types.ts, never against ArchiveReader itself.
export type ArchiveIngestStatus = ReturnType<
  import("../src/archive").ArchiveReader["ingestStatus"]
>;
export type ArchiveLowqQueue = ReturnType<
  import("../src/archive").ArchiveReader["lowqQueue"]
>;
export type ArchiveSkipCensus = ReturnType<
  import("../src/archive").ArchiveReader["skipCensus"]
>;
export type ArchiveSourceCensus = ReturnType<
  import("../src/archive").ArchiveReader["sourceCensus"]
>;
export type ArchiveAnalysisCoverage = ReturnType<
  import("../src/archive").ArchiveReader["analysisCoverage"]
>;
export type ArchiveGridCrossCheck = ReturnType<
  import("../src/archive").ArchiveReader["gridCrossCheck"]
>;
export type ArchiveMoodProfile = ReturnType<
  import("../src/archive").ArchiveReader["moodProfile"]
>;

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
export type ArchiveCueStats = ReturnType<
  import("../src/archive").ArchiveReader["cueStats"]
>;
export type ArchiveLibraryOverview = ReturnType<
  import("../src/archive").ArchiveReader["libraryOverview"]
>;
export type ArchiveSimilar = ReturnType<
  import("../src/archive").ArchiveReader["similarTracks"]
>;
/** The /api/archive/search wire row — derived from the producer. */
export type ArchiveSearchHit = ReturnType<
  import("../src/archive").ArchiveReader["searchTracks"]
>[number];

// ---- preflight (B12): the wire shapes are DEFINED here; src/preflight.ts
// (the pure engine that produces them) imports them back. One source of
// truth for web/deckctl/MCP without re-exporting the producer's module.
export interface PreflightDriveResult {
  drive: Drive;
  overall: PreflightVerdict;
  checks: HealthCheck[];
  /** show-stoppers — the reason a drive is not-ready, for the top line */
  blockers: string[];
}

export interface PreflightReport {
  generated_at: number;
  drives: PreflightDriveResult[];
  mountedCount: number;
  overall: PreflightVerdict;
  /** one line a human reads before leaving for the gig */
  summary: string;
  /** N76: known firmware advisories from the player matrix (informational). */
  firmware_advisories: string[];
}

// ---- player compatibility (N75/N78): wire shape of GET /drives/:id/players.
// DriveCompat + PlayerSpec (the measured dual-DB verdicts) are DEFINED here;
// src/players.ts imports them back. The server spreads DriveCompat under
// {drive, measured}; PlayersPayload mirrors that envelope once so deckctl +
// the web PreflightTab don't each hand-declare it.

/** One row in the Pioneer player matrix. Notes carry known firmware
 *  advisories (N76) and render as preflight hints. */
export interface PlayerSpec {
  /** Display name, e.g. "XDJ-XZ". */
  name: string;
  /** Which library DB the player reads. */
  reads: "device" | "onelibrary";
  /** Pioneer's firmware-pull era note, rendered as a preflight hint. */
  note?: string;
}

export interface DriveCompat {
  /** Players that can read this drive as-is. */
  ok: PlayerSpec[];
  /** Players this drive is INVISIBLE to, with the measured reason. */
  blocked: { player: PlayerSpec; reason: string }[];
  /** true when the drive has no DB data at all (never full-scanned). */
  unknown: boolean;
}

export type PlayersPayload = {
  drive: { id: string; name: string; nickname: string | null };
  measured: { pdb_live_rows: number | null; onelibrary_rows: number | null };
} & DriveCompat;

// ---- notes (O88): the feed's row type lives here; src/notes.ts (the
// producer) imports it back so deckctl and any other consumer read the
// same shape without a module cycle.
export interface StoredNote {
  id: string;
  drive_id: string;
  note: string;
  origin: string;
  severity: NoteSeverity;
  at: number;
  /** Set when dismissed; dismissed notes leave the active feed. */
  dismissed_at: number | null;
}

// ---- set-builder (M66): the setbuild route's wire envelope. src/setbuild.ts
// (the engine) imports SetBuildStep/SetBuildResult back; the HTTP envelope
// (available/pool/excluded_total) wraps it in archive_routes.ts. SimilarTab
// derives from here — a local duplicate drifted once and crashed the render.
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
}

// ---- benchmarks: one benchmark job's row (the /api/drives/:id/benchmarks
// response rows). Defined here so HealthTab/DrivePage derive from the
// producer's contract, not a consumer-side re-declaration.
export interface BenchRun {
  ran_at: number;
  seq_mbps: number;
  rand4k_mbps: number;
}
