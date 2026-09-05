import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

/**
 * Persistent archive state. Tracks every video ID ever seen from the
 * liked-songs playlist, its lifecycle (pending/downloaded/gone), quality,
 * file location, and retry counts, so repeat runs are incremental and
 * nothing is re-downloaded or lost track of.
 */

type TrackStatus =
  | "pending"
  | "downloaded"
  | "gone"
  | "failed"
  | "skipped_low_quality"
  | "skipped_not_music"
  | "skipped_short";

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
  energy: number | null;
  artwork_status: string | null;
  year: string | null;
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
  /** Directory holding the sqlite file — also hosts sidecar files. */
  readonly dbDir: string;

  constructor(dbPath: string) {
    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    this.dbDir = dir;
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
    this.addColumnIfMissing(
      "tracks",
      "source",
      "TEXT NOT NULL DEFAULT 'liked'",
    );
    this.addColumnIfMissing("tracks", "genre", "TEXT");
    // `year` = release year of THIS file's version (see TagValues in
    // tools/fetch_lib.ts). fetch_all + fix_years run plain
    // `UPDATE tracks SET year=?` — without this migration every
    // `megadj fetch`/`megadj years` write crashes a freshly created DB
    // with "no such column: year" (older DBs only worked via manual ALTER).
    this.addColumnIfMissing("tracks", "year", "TEXT");
    this.addColumnIfMissing("tracks", "energy", "INTEGER");
    this.addColumnIfMissing("tracks", "artwork_status", "TEXT");
    // Beats/downbeats ledger (roadmap rev 5 §2/#2 pivot): beat_this's
    // tempo FAILS the tag gate (12/24 within 2% vs rekordbox), but the
    // BEAT ARRAY is the valuable output — it feeds structure cues and
    // CrateDeck's grid cross-check. Grid data lands here, NEVER in tags.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS beats (
        video_id TEXT PRIMARY KEY,
        bpm_raw REAL,
        bpm_folded REAL,
        beats_json TEXT NOT NULL,
        downbeats_json TEXT NOT NULL,
        model TEXT NOT NULL,
        source_path TEXT NOT NULL,
        analyzed_at TEXT NOT NULL
      );
    `);
    // Mood/dance/valence ledger (roadmap rev 6.1 #4): the parsed TXXX:MOOD
    // stamp per track — danceability, 4 mood heads, valence/arousal. The
    // FILE carries the stamp (ground truth); this is the queryable mirror
    // for CrateDeck/agents (same pattern as the beats ledger).
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mood (
        video_id TEXT PRIMARY KEY,
        dance REAL NOT NULL,
        aggressive REAL NOT NULL,
        happy REAL NOT NULL,
        electronic REAL NOT NULL,
        party REAL NOT NULL,
        valence REAL NOT NULL,
        arousal REAL NOT NULL,
        source_path TEXT NOT NULL,
        analyzed_at TEXT NOT NULL
      );
    `);
    // Structure cues ledger (roadmap "structure cues" slice): DJ phrase
    // markers (every 8 bars) derived from the beats ledger's downbeats.
    // DB-side only — rekordbox memory cues are a separate gated surface.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cues (
        video_id TEXT PRIMARY KEY,
        cues_json TEXT NOT NULL,
        model TEXT NOT NULL,
        derived_at TEXT NOT NULL
      );
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source)`,
    );
  }

  private addColumnIfMissing(table: string, column: string, ddl: string): void {
    const cols = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
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
      energy?: number | null;
      artworkStatus?: string | null;
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
           energy = COALESCE(?, energy),
           artwork_status = COALESCE(?, artwork_status),
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
        info.energy ?? null,
        info.artworkStatus ?? null,
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
    this.markStatus(videoId, "gone", { lastError: reason });
  }

  markFailed(videoId: string, error: string): void {
    this.markStatus(videoId, "failed", { lastError: error });
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
    this.markStatus(videoId, "skipped_not_music", {
      lastError: `category: ${category ?? "unknown"}`,
    });
  }

  /** Set status (+ optional fields) with a fresh updated_at in one place. */
  private markStatus(
    videoId: string,
    status: TrackStatus,
    fields: {
      filePath?: string;
      durationS?: number | null;
      lastError?: string;
    } = {},
  ): void {
    this.db
      .query(
        `UPDATE tracks SET status = ?, file_path = COALESCE(?, file_path), duration_s = COALESCE(?, duration_s), last_error = COALESCE(?, last_error), updated_at = ? WHERE video_id = ?`,
      )
      .run(
        status,
        fields.filePath ?? null,
        fields.durationS ?? null,
        fields.lastError ?? null,
        this.now(),
        videoId,
      );
  }

  /** Update the file path after a move (organize command). */
  updateFilePath(videoId: string, newFilePath: string): void {
    this.db
      .query(
        `UPDATE tracks SET file_path = ?, updated_at = ? WHERE video_id = ?`,
      )
      .run(newFilePath, this.now(), videoId);
  }

  /** Mark an ingested file as too short for DJ use (kept out of the archive). */
  markShortSkipped(
    videoId: string,
    filePath: string,
    durationS: number | null,
  ): void {
    this.markStatus(videoId, "skipped_short", { filePath, durationS });
  }

  /** Persist inferred genre for a downloaded track. */
  updateGenre(videoId: string, genre: string | null): void {
    this.db
      .query(
        `UPDATE tracks SET genre = COALESCE(?, genre), updated_at = ? WHERE video_id = ?`,
      )
      .run(genre, this.now(), videoId);
  }

  /** Persist artwork status: 'embedded' | 'queued' | 'none' | 'skipped:<ext>'. */
  updateArtworkStatus(videoId: string, status: string): void {
    this.db
      .query(
        `UPDATE tracks SET artwork_status = ?, updated_at = ? WHERE video_id = ?`,
      )
      .run(status, this.now(), videoId);
  }

  /**
   * Queue flag persisted via artwork_status='queued'; queue file lives at
   * ~/.local/state/megadj/artwork-queue.jsonl (one JSON object per line).
   */
  queuedArtworkTracks(): TrackRow[] {
    return this.db
      .query(
        `SELECT * FROM tracks WHERE artwork_status = 'queued' ORDER BY updated_at`,
      )
      .all() as TrackRow[];
  }

  /** Tracks that should be attempted on the next run. */
  pendingTracks(): TrackRow[] {
    return this.db
      .query(
        `SELECT * FROM tracks WHERE status IN ('pending', 'failed') AND attempts < 5
         ORDER BY status = 'pending' DESC, liked_position IS NULL, liked_position, first_seen_at`,
      )
      .all() as TrackRow[];
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

  // ---------- beats ledger (roadmap rev 5 §2/#2) ----------

  /** Upsert one beat-analysis result. Idempotent by video_id: a re-run
   * with the same model REPLACES the row (fresh timestamps), a re-run
   * with a DIFFERENT model never clobbers silently — callers pass
   * force=true for that. */
  setBeatRecord(rec: {
    videoId: string;
    bpmRaw: number | null;
    bpmFolded: number | null;
    beats: number[];
    downbeats: number[];
    model: string;
    sourcePath: string;
  }): void {
    this.db
      .query(
        `INSERT INTO beats (video_id, bpm_raw, bpm_folded, beats_json, downbeats_json, model, source_path, analyzed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           bpm_raw = excluded.bpm_raw,
           bpm_folded = excluded.bpm_folded,
           beats_json = excluded.beats_json,
           downbeats_json = excluded.downbeats_json,
           model = excluded.model,
           source_path = excluded.source_path,
           analyzed_at = excluded.analyzed_at`,
      )
      .run(
        rec.videoId,
        rec.bpmRaw,
        rec.bpmFolded,
        JSON.stringify(rec.beats),
        JSON.stringify(rec.downbeats),
        rec.model,
        rec.sourcePath,
        this.now(),
      );
  }

  beatRecord(videoId: string): {
    videoId: string;
    bpmRaw: number | null;
    bpmFolded: number | null;
    beats: number[];
    downbeats: number[];
    model: string;
    sourcePath: string;
    analyzedAt: string;
  } | null {
    const row = this.db
      .query(
        `SELECT video_id, bpm_raw, bpm_folded, beats_json, downbeats_json, model, source_path, analyzed_at
         FROM beats WHERE video_id = ?`,
      )
      .get(videoId) as {
      video_id: string;
      bpm_raw: number | null;
      bpm_folded: number | null;
      beats_json: string;
      downbeats_json: string;
      model: string;
      source_path: string;
      analyzed_at: string;
    } | null;
    if (!row) return null;
    let beats: number[] = [];
    let downbeats: number[] = [];
    try {
      beats = JSON.parse(row.beats_json) as number[];
      downbeats = JSON.parse(row.downbeats_json) as number[];
    } catch {
      // corrupt JSON row — treat as absent so the pass re-analyzes
      return null;
    }
    return {
      videoId: row.video_id,
      bpmRaw: row.bpm_raw,
      bpmFolded: row.bpm_folded,
      beats,
      downbeats,
      model: row.model,
      sourcePath: row.source_path,
      analyzedAt: row.analyzed_at,
    };
  }

  /** All beat records joined to their track rows (downloaded only). */
  beatAnalyzedTracks(): Array<{
    track: TrackRow;
    beats: number[];
    downbeats: number[];
    bpmRaw: number | null;
    bpmFolded: number | null;
  }> {
    const rows = this.db
      .query(
        `SELECT t.*, b.beats_json, b.downbeats_json, b.bpm_raw, b.bpm_folded
         FROM tracks t JOIN beats b ON b.video_id = t.video_id
         WHERE t.status = 'downloaded'`,
      )
      .all() as Array<
      TrackRow & {
        beats_json: string;
        downbeats_json: string;
        bpm_raw: number | null;
        bpm_folded: number | null;
      }
    >;
    return rows.map((r) => {
      let beats: number[] = [];
      let downbeats: number[] = [];
      try {
        beats = JSON.parse(r.beats_json) as number[];
        downbeats = JSON.parse(r.downbeats_json) as number[];
      } catch {
        // leave empty — consumers treat empty arrays as "no grid"
      }
      return {
        track: r,
        beats,
        downbeats,
        bpmRaw: r.bpm_raw,
        bpmFolded: r.bpm_folded,
      };
    });
  }

  // ---------- mood ledger (roadmap rev 6.1 #4) ----------

  /** Upsert one parsed mood result. Idempotent by video_id: a re-run
   * replaces the row (fresh timestamps). */
  setMoodRecord(rec: {
    videoId: string;
    dance: number;
    aggressive: number;
    happy: number;
    electronic: number;
    party: number;
    valence: number;
    arousal: number;
    sourcePath: string;
  }): void {
    this.db
      .query(
        `INSERT INTO mood (video_id, dance, aggressive, happy, electronic, party, valence, arousal, source_path, analyzed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           dance = excluded.dance,
           aggressive = excluded.aggressive,
           happy = excluded.happy,
           electronic = excluded.electronic,
           party = excluded.party,
           valence = excluded.valence,
           arousal = excluded.arousal,
           source_path = excluded.source_path,
           analyzed_at = excluded.analyzed_at`,
      )
      .run(
        rec.videoId,
        rec.dance,
        rec.aggressive,
        rec.happy,
        rec.electronic,
        rec.party,
        rec.valence,
        rec.arousal,
        rec.sourcePath,
        this.now(),
      );
  }

  /** One mood record (by video id), null when never analyzed. */
  moodRecord(videoId: string): {
    videoId: string;
    dance: number;
    aggressive: number;
    happy: number;
    electronic: number;
    party: number;
    valence: number;
    arousal: number;
    sourcePath: string;
    analyzedAt: string;
  } | null {
    const row = this.db
      .query(
        `SELECT video_id, dance, aggressive, happy, electronic, party, valence, arousal, source_path, analyzed_at
         FROM mood WHERE video_id = ?`,
      )
      .get(videoId) as {
      video_id: string;
      dance: number;
      aggressive: number;
      happy: number;
      electronic: number;
      party: number;
      valence: number;
      arousal: number;
      source_path: string;
      analyzed_at: string;
    } | null;
    if (!row) return null;
    return {
      videoId: row.video_id,
      dance: row.dance,
      aggressive: row.aggressive,
      happy: row.happy,
      electronic: row.electronic,
      party: row.party,
      valence: row.valence,
      arousal: row.arousal,
      sourcePath: row.source_path,
      analyzedAt: row.analyzed_at,
    };
  }

  /** Aggregate mood/energy profile over all analyzed tracks — the CrateDeck
   * vibe-map feed: averages + count, ordered extremes for UI pickers. */
  moodSummary(): {
    available: boolean;
    analyzed: number;
    avg: {
      dance: number;
      valence: number;
      arousal: number;
      party: number;
      electronic: number;
    };
  } {
    const row = this.db
      .query(
        `SELECT COUNT(*) n,
                AVG(dance) dance, AVG(valence) valence, AVG(arousal) arousal,
                AVG(party) party, AVG(electronic) electronic
         FROM mood`,
      )
      .get() as {
      n: number;
      dance: number | null;
      valence: number | null;
      arousal: number | null;
      party: number | null;
      electronic: number | null;
    };
    const r = (v: number | null): number => Math.round((v ?? 0) * 1000) / 1000;
    return {
      available: true,
      analyzed: row.n,
      avg: {
        dance: r(row.dance),
        valence: r(row.valence),
        arousal: r(row.arousal),
        party: r(row.party),
        electronic: r(row.electronic),
      },
    };
  }

  // ---------- structure cues ledger (roadmap cues slice) ----------

  /** Upsert one derived cue set. Idempotent by video_id: a re-run replaces
   * the row (fresh timestamps). */
  setCueRecord(rec: {
    videoId: string;
    cues: Array<{ index: number; position: number; bar: number }>;
    source: string;
  }): void {
    this.db
      .query(
        `INSERT INTO cues (video_id, cues_json, model, derived_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           cues_json = excluded.cues_json,
           model = excluded.model,
           derived_at = excluded.derived_at`,
      )
      .run(
        rec.videoId,
        JSON.stringify(rec.cues),
        rec.source,
        this.now(),
      );
  }

  /** One cue record (by video id), null when never derived. */
  cueRecord(videoId: string): {
    videoId: string;
    cues: Array<{ index: number; position: number; bar: number }>;
    source: string;
    derivedAt: string;
  } | null {
    const row = this.db
      .query(
        `SELECT video_id, cues_json, model, derived_at
         FROM cues WHERE video_id = ?`,
      )
      .get(videoId) as {
      video_id: string;
      cues_json: string;
      model: string;
      derived_at: string;
    } | null;
    if (!row) return null;
    let cues: Array<{ index: number; position: number; bar: number }> = [];
    try {
      cues = JSON.parse(row.cues_json) as Array<{
        index: number;
        position: number;
        bar: number;
      }>;
    } catch {
      return null; // corrupt JSON row — treat as absent so the pass re-derives
    }
    return {
      videoId: row.video_id,
      cues,
      source: row.model,
      derivedAt: row.derived_at,
    };
  }

  /** All cue records joined to their track rows (downloaded only). */
  cueAnalyzedTracks(): Array<{
    videoId: string;
    title: string | null;
    cues: Array<{ index: number; position: number; bar: number }>;
    source: string;
  }> {
    const rows = this.db
      .query(
        `SELECT c.video_id, t.title, c.cues_json, c.model
         FROM cues c JOIN tracks t ON t.video_id = c.video_id
         WHERE t.status = 'downloaded'`,
      )
      .all() as Array<{
      video_id: string;
      title: string | null;
      cues_json: string;
      model: string;
    }>;
    return rows.flatMap((r) => {
      try {
        return [
          {
            videoId: r.video_id,
            title: r.title,
            cues: JSON.parse(r.cues_json) as Array<{
              index: number;
              position: number;
              bar: number;
            }>,
            source: r.model,
          },
        ];
      } catch {
        return []; // corrupt row — skip, never throw
      }
    });
  }
}
