import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

/**
 * Persistent archive state. Tracks every video ID ever seen from the
 * liked-songs playlist, its lifecycle (pending/downloaded/gone), quality,
 * file location, and retry counts, so repeat runs are incremental and
 * nothing is re-downloaded or lost track of.
 */

export type TrackStatus =
  | "pending"
  | "downloaded"
  | "gone"
  | "failed"
  | "skipped_low_quality"
  | "skipped_not_music";

export interface TrackRow {
  video_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  status: TrackStatus;
  format_id: string | null;
  bitrate_kbps: number | null;
  codec: string | null;
  file_path: string | null;
  file_size_bytes: number | null;
  duration_s: number | null;
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  liked_position: number | null;
  source: string;
  genre: string | null;
  first_seen_at: string;
  updated_at: string;
}

export interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  attempted: number;
  downloaded: number;
  gone: number;
  failed: number;
  bytes_downloaded: number;
}

export class ArchiveState {
  private db: Database;

  constructor(dbPath: string) {
    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    if (dir) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tracks (
        video_id TEXT PRIMARY KEY,
        title TEXT,
        artist TEXT,
        album TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        format_id TEXT,
        bitrate_kbps INTEGER,
        codec TEXT,
        file_path TEXT,
        file_size_bytes INTEGER,
        duration_s REAL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        last_error TEXT,
        liked_position INTEGER,
        first_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        attempted INTEGER NOT NULL DEFAULT 0,
        downloaded INTEGER NOT NULL DEFAULT 0,
        gone INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        bytes_downloaded INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(status);
      CREATE INDEX IF NOT EXISTS idx_tracks_position ON tracks(liked_position);
    `);
    this.addColumnIfMissing("tracks", "source", "TEXT NOT NULL DEFAULT 'liked'");
    this.addColumnIfMissing("tracks", "genre", "TEXT");
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source)`,
    );
  }

  private addColumnIfMissing(
    table: string,
    column: string,
    ddl: string,
  ): void {
    const cols = this.db
      .query(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }

  close(): void {
    this.db.close();
  }

  now(): string {
    return new Date().toISOString();
  }

  upsertTrackFromPlaylist(
    videoId: string,
    position: number,
    title: string | null,
    source = "liked",
  ): void {
    const now = this.now();
    this.db
      .query(
        `INSERT INTO tracks (video_id, liked_position, title, source, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           liked_position = excluded.liked_position,
           title = COALESCE(excluded.title, tracks.title),
           updated_at = excluded.updated_at`,
      )
      .run(videoId, position, title, source, now, now);
  }

  markAttempt(videoId: string, error: string | null): void {
    const now = this.now();
    const row = this.db
      .query("SELECT attempts FROM tracks WHERE video_id = ?")
      .get(videoId) as { attempts: number } | null;
    const attempts = (row?.attempts ?? 0) + 1;
    this.db
      .query(
        `UPDATE tracks SET attempts = ?, last_attempt_at = ?, last_error = ?, updated_at = ? WHERE video_id = ?`,
      )
      .run(attempts, now, error, now, videoId);
  }

  markDownloaded(
    videoId: string,
    info: {
      title: string | null;
      artist: string | null;
      album: string | null;
      genre?: string | null;
      formatId: string | null;
      bitrateKbps: number | null;
      codec: string | null;
      filePath: string | null;
      fileSizeBytes: number | null;
      durationS: number | null;
    },
  ): void {
    const now = this.now();
    this.db
      .query(
        `UPDATE tracks SET
           status = 'downloaded',
           title = COALESCE(?, title),
           artist = COALESCE(?, artist),
           album = COALESCE(?, album),
           genre = COALESCE(?, genre),
           format_id = ?, bitrate_kbps = ?, codec = ?,
           file_path = ?, file_size_bytes = ?, duration_s = ?,
           last_error = NULL, updated_at = ?
         WHERE video_id = ?`,
      )
      .run(
        info.title,
        info.artist,
        info.album,
        info.genre ?? null,
        info.formatId,
        info.bitrateKbps,
        info.codec,
        info.filePath,
        info.fileSizeBytes,
        info.durationS,
        now,
        videoId,
      );
  }

  markGone(videoId: string, reason: string): void {
    this.db
      .query(
        `UPDATE tracks SET status = 'gone', last_error = ?, last_attempt_at = ?, updated_at = ? WHERE video_id = ?`,
      )
      .run(reason, this.now(), this.now(), videoId);
  }

  markFailed(videoId: string, error: string): void {
    this.db
      .query(
        `UPDATE tracks SET status = 'failed', last_error = ?, last_attempt_at = ?, updated_at = ? WHERE video_id = ?`,
      )
      .run(error, this.now(), this.now(), videoId);
  }

  /** Reset failed tracks back to pending so the next sync retries them. */
  resetFailures(): number {
    const result = this.db
      .query(
        `UPDATE tracks SET status = 'pending', attempts = 0, last_error = NULL, updated_at = ? WHERE status = 'failed'`,
      )
      .run(this.now());
    return result.changes;
  }

  /** Skip a non-music video permanently (music-only mode). */
  markNotMusic(videoId: string, category: string | null): void {
    this.db
      .query(
        `UPDATE tracks SET status = 'skipped_not_music', last_error = ?, updated_at = ? WHERE video_id = ?`,
      )
      .run(`category: ${category ?? "unknown"}`, this.now(), videoId);
  }

  /** Update the file path after a move (organize command). */
  updateFilePath(videoId: string, newFilePath: string): void {
    this.db
      .query(`UPDATE tracks SET file_path = ?, updated_at = ? WHERE video_id = ?`)
      .run(newFilePath, this.now(), videoId);
  }

  /** Persist inferred genre for a downloaded track. */
  updateGenre(videoId: string, genre: string | null): void {
    this.db
      .query(`UPDATE tracks SET genre = COALESCE(?, genre), updated_at = ? WHERE video_id = ?`)
      .run(genre, this.now(), videoId);
  }

  /** Tracks that should be attempted on the next run. */
  pendingTracks(): TrackRow[] {
    return this.db
      .query(
        `SELECT * FROM tracks WHERE status IN ('pending', 'failed') AND attempts < 5
         ORDER BY liked_position`,
      )
      .all() as TrackRow[];
  }

  /** Pending tracks from a specific source, position-ordered. */
  pendingTracksFromSource(source: string): TrackRow[] {
    return this.db
      .query(
        `SELECT * FROM tracks WHERE source = ? AND status IN ('pending', 'failed') AND attempts < 5
         ORDER BY liked_position`,
      )
      .all(source) as TrackRow[];
  }

  /** Total downloaded tracks across all sources. */
  downloadedCount(): number {
    const row = this.db
      .query(`SELECT COUNT(*) as n FROM tracks WHERE status = 'downloaded'`)
      .get() as { n: number };
    return row.n;
  }

  statusCounts(): Record<string, number> {
    const rows = this.db
      .query("SELECT status, COUNT(*) as n FROM tracks GROUP BY status")
      .all() as Array<{ status: string; n: number }>;
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  allTracks(): TrackRow[] {
    return this.db
      .query("SELECT * FROM tracks ORDER BY liked_position")
      .all() as TrackRow[];
  }

  startRun(): number {
    const result = this.db
      .query("INSERT INTO runs (started_at) VALUES (?)")
      .run(this.now());
    return Number(result.lastInsertRowid);
  }

  finishRun(
    id: number,
    counts: {
      attempted: number;
      downloaded: number;
      gone: number;
      failed: number;
      bytesDownloaded: number;
    },
  ): void {
    this.db
      .query(
        `UPDATE runs SET finished_at = ?, attempted = ?, downloaded = ?, gone = ?, failed = ?, bytes_downloaded = ? WHERE id = ?`,
      )
      .run(
        this.now(),
        counts.attempted,
        counts.downloaded,
        counts.gone,
        counts.failed,
        counts.bytesDownloaded,
        id,
      );
  }

  lastRuns(n: number): RunRow[] {
    return this.db
      .query("SELECT * FROM runs ORDER BY id DESC LIMIT ?")
      .all(n) as RunRow[];
  }
}
