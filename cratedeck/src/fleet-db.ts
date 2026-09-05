// fleet-db.ts — persistence for the fleet superpowers (ideas.md §B6/B7/B8).
// Owns the fleet_* tables and every read/write against them; `db.ts` holds a
// FleetStore instance and delegates, keeping each file single-purpose.
import type { Database } from "bun:sqlite";
import type { SnapshotData } from "../shared/types";
import type { TrackRow, PlaylistEntryRow, ManifestRow } from "./fleet";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS fleet_tracks (
  drive_id TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  artist TEXT,
  bpm REAL,
  key TEXT,
  duration_ms INTEGER,
  taken_at INTEGER NOT NULL,
  PRIMARY KEY (drive_id, path)
);
CREATE TABLE IF NOT EXISTS fleet_playlist_entries (
  drive_id TEXT NOT NULL,
  playlist_name TEXT NOT NULL,
  track_path TEXT NOT NULL,
  PRIMARY KEY (drive_id, playlist_name, track_path)
);
CREATE TABLE IF NOT EXISTS fleet_manifest (
  drive_id TEXT NOT NULL,
  path TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  PRIMARY KEY (drive_id, path)
);
CREATE INDEX IF NOT EXISTS fleet_tracks_path ON fleet_tracks(path);
`;

export class FleetStore {
  private migrated = false;

  constructor(private readonly sqlite: Database) {}

  private migrate(): void {
    if (this.migrated) return;
    this.sqlite.exec(SCHEMA);
    this.migrated = true;
  }

  /** Group flat rows by drive_id (shared by every query below). */
  private byDrive<T extends { drive_id: string }>(rows: T[]): Map<string, T[]> {
    const out = new Map<string, T[]>();
    for (const r of rows) {
      (out.get(r.drive_id) ?? out.set(r.drive_id, []).get(r.drive_id)!).push(r);
    }
    return out;
  }

  /** Drop + reload one drive's fleet rows from a fresh scan. One transaction
   *  so a mid-scan reader never sees a half-loaded inventory. bun:sqlite
   *  binds ONE row per run() — prepared-once + per-row loop, never flatMap. */
  sync(driveId: string, snap: SnapshotData): void {
    this.migrate();
    const tracks = snap.tracks ?? [];
    const entries = snap.playlist_entries ?? [];
    const manifest = snap.manifest ?? [];
    const tx = this.sqlite.transaction(() => {
      this.sqlite
        .query("DELETE FROM fleet_tracks WHERE drive_id=?")
        .run(driveId);
      this.sqlite
        .query("DELETE FROM fleet_playlist_entries WHERE drive_id=?")
        .run(driveId);
      this.sqlite
        .query("DELETE FROM fleet_manifest WHERE drive_id=?")
        .run(driveId);
      const insTrack = this.sqlite.query(
        `INSERT INTO fleet_tracks (drive_id, path, title, artist, bpm, key, duration_ms, taken_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      );
      for (const t of tracks) {
        insTrack.run(
          driveId,
          t.path,
          t.title ?? null,
          t.artist ?? null,
          t.bpm ?? null,
          t.key ?? null,
          t.duration_ms ?? null,
          snap.taken_at,
        );
      }
      const insEntry = this.sqlite.query(
        `INSERT INTO fleet_playlist_entries (drive_id, playlist_name, track_path)
         VALUES (?,?,?)`,
      );
      for (const e of entries) {
        insEntry.run(driveId, e.playlist_name, e.track_path);
      }
      const insMan = this.sqlite.query(
        `INSERT INTO fleet_manifest (drive_id, path, bytes, mtime_ms)
         VALUES (?,?,?,?)`,
      );
      for (const m of manifest) {
        insMan.run(driveId, m.path, m.bytes, m.mtime_ms);
      }
    });
    tx();
  }

  /** Latest per-track inventory rows per drive (fleet queries' input). */
  inventories(driveIds?: string[]): Map<string, TrackRow[]> {
    this.migrate();
    const rows = (
      driveIds?.length
        ? this.sqlite
            .query(
              `SELECT drive_id, path, title, artist, bpm, key, duration_ms
               FROM fleet_tracks WHERE drive_id IN (${driveIds.map(() => "?").join(",")})`,
            )
            .all(...driveIds)
        : this.sqlite
            .query(
              `SELECT drive_id, path, title, artist, bpm, key, duration_ms
               FROM fleet_tracks`,
            )
            .all()
    ) as TrackRow[];
    return this.byDrive(rows);
  }

  playlistEntries(driveIds?: string[]): Map<string, PlaylistEntryRow[]> {
    this.migrate();
    const rows = (
      driveIds?.length
        ? this.sqlite
            .query(
              `SELECT drive_id, playlist_name, track_path
               FROM fleet_playlist_entries
               WHERE drive_id IN (${driveIds.map(() => "?").join(",")})`,
            )
            .all(...driveIds)
        : this.sqlite
            .query(
              `SELECT drive_id, playlist_name, track_path FROM fleet_playlist_entries`,
            )
            .all()
    ) as PlaylistEntryRow[];
    return this.byDrive(rows);
  }

  manifests(driveIds?: string[]): Map<string, ManifestRow[]> {
    this.migrate();
    const rows = (
      driveIds?.length
        ? this.sqlite
            .query(
              `SELECT drive_id, path, bytes, mtime_ms FROM fleet_manifest
               WHERE drive_id IN (${driveIds.map(() => "?").join(",")})`,
            )
            .all(...driveIds)
        : this.sqlite
            .query(`SELECT drive_id, path, bytes, mtime_ms FROM fleet_manifest`)
            .all()
    ) as ManifestRow[];
    return this.byDrive(rows);
  }
}
