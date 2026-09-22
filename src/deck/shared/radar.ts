// radar.ts — the new-music radar wire contract (#148, PRD F10). Extracted
// from shared/types.ts (the file-length guard) the same way megaset went
// to shared/megaset.ts: the shapes stay shared and import-leaf-legal, the
// engine that produces them is src/deck/radar.ts (pure).

/** One archive track a drive's snapshot lacks (radar preview row). */
export interface RadarMiss {
  /** NFC-casefolded Contents-relative path (the fleet path key). */
  path: string;
  title: string | null;
  artist: string | null;
  videoId: string;
  /** ISO first_seen_at from the archive ledger (display only). */
  firstSeenAt: string | null;
}

/** Per-drive radar answer + the snapshot freshness the delta was computed
 *  against (the freshness rule: a stale snapshot reads as stale, never as
 *  "drive is current"). */
export interface RadarResult {
  driveId: string;
  driveName: string;
  /** Downloaded archive rows compared (the mirror side's size). */
  archiveTracks: number;
  /** Drive inventory rows compared. */
  driveTracks: number;
  /** COUNT truth — never derived from a displayed (capped) list. */
  missingCount: number;
  /** Newest-first preview, capped. */
  missing: RadarMiss[];
  summary: string;
  /** Snapshot age: ISO taken_at of the newest fleet_tracks row for this
   *  drive, null = never scanned (radar answers "unknown", not 0). */
  snapshotAt: string | null;
  /** false when the archive DB is absent (radar unavailable, not zero). */
  archiveAvailable: boolean;
  /** false when the drive's latest snapshot is a light scan (no track
   *  inventory — the delta reads "unknown", never a fake full-missing
   *  count). true = the delta was computed over a real inventory. */
  inventoryAvailable: boolean;
}

/** Fleet-wide radar: one row per known drive + the overall census. */
export interface FleetRadar {
  drives: RadarResult[];
  /** SUM of per-drive missingCount — each drive answers its own delta. */
  totalMissing: number;
  archiveTracks: number;
  archiveAvailable: boolean;
  summary: string;
}
