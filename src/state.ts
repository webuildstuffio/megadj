import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { EmbeddingsLedger } from "./state-similar";
import { Ledgers } from "./state-ledgers";
import type {
  MoodRecordInput,
  MoodRecord,
  CueRecordInput,
  CueRecord,
} from "./state-ledgers";
import { ShelfSweeps } from "./shelf-sweeps";

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
  /** blake2b256 hex of the file bytes — the gold-annotation join key. */
  content_hash: string | null;
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
  /** I49 embeddings ledger + similarity math live in state-similar.ts
   * (file-length guard); delegated here so the call surface is unchanged. */
  private readonly embeddingsLedger: EmbeddingsLedger;
  /** Mood + cues ledger storage lives in state-ledgers.ts (file-length
   * guard); delegated here so the call surface is unchanged. */
  private readonly ledgers: Ledgers;
  /** Drive → shelf sweep ledger (shelf-sweeps.ts): the queryable record of
   * every shelf-archive run. */
  readonly shelfSweeps: ShelfSweeps;
  constructor(dbPath: string) {
    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    this.dbDir = dir;
    if (dir) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.embeddingsLedger = new EmbeddingsLedger(this.db, () => this.now());
    this.ledgers = new Ledgers(this.db, () => this.now());
    this.shelfSweeps = new ShelfSweeps(this.db);
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
    // tools/fetch-lib.ts). fetch-all + fix-years run plain
    // `UPDATE tracks SET year=?` — without this migration every
    // `megadj fetch`/`megadj years` write crashes a freshly created DB
    // with "no such column: year" (older DBs only worked via manual ALTER).
    this.addColumnIfMissing("tracks", "year", "TEXT");
    this.addColumnIfMissing("tracks", "energy", "INTEGER");
    this.addColumnIfMissing("tracks", "artwork_status", "TEXT");
    // content_hash: blake2b256 of the downloaded file's bytes — the join
    // key for gold annotations (GA-00 keys them by content hash; file
    // names lie, hashes don't). Cached here so `megadj gold-report`
    // doesn't re-read the whole library's audio on every run (super-sure
    // pass, Sep 10); the sweep fills it opportunistically.
    this.addColumnIfMissing("tracks", "content_hash", "TEXT");
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_tracks_content_hash ON tracks(content_hash)`,
    );
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
    // GA-01 (plan.md): the constant-tempo fit — a better tempo than the
    // median inter-beat interval for grid-locked music, plus the residual
    // that says whether "constant tempo" was the right assumption. Null
    // on pre-GA-01 rows; consumers fall back to span math.
    this.addColumnIfMissing("beats", "bpm_fitted", "REAL");
    this.addColumnIfMissing("beats", "bpm_residual_std", "REAL");
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
    // Embeddings ledger (roadmap I49 "sounds like"): the effnet tower's
    // 1280-d mean embedding per track, stored as a compact JSON array.
    // Cosine kNN happens in TS at query time — the doc explicitly blesses
    // "blob + cosine at 3–10k tracks"; no sqlite-vec dependency.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        video_id TEXT PRIMARY KEY,
        dim INTEGER NOT NULL,
        vec_json TEXT NOT NULL,
        source_path TEXT NOT NULL,
        analyzed_at TEXT NOT NULL
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
      genre?: string | null | undefined;
      formatId: string | null;
      bitrateKbps: number | null;
      codec: string | null;
      filePath: string | null;
      fileSizeBytes: number | null;
      durationS: number | null;
      energy?: number | null | undefined;
      artworkStatus?: string | null | undefined;
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

  /** The downloaded row currently pointing at this exact file, if any.
   *  Ingest's upgrade path uses this to REPLACE the existing registration
   *  (same video_id → beats/mood/cues ledger history survives) instead of
   *  inserting a path-keyed shadow row next to it (Sep 11 2026: five twin
   *  rows appeared after an upgrade re-ingest — same file, two rows, the
   *  older one carrying all the analysis history). */
  trackByFilePath(filePath: string): TrackRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM tracks
           WHERE file_path = ? AND status = 'downloaded'
           LIMIT 1`,
        )
        .get(filePath) as TrackRow | undefined) ?? null
    );
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

  /** Tracks downloaded AND on disk — the shared candidate filter for the
   * post-download passes (organize/mood/ingest/beats all re-derived this
   * identical predicate). */
  downloadedWithFiles(): TrackRow[] {
    return this.allTracks().filter(
      (t) => t.status === "downloaded" && t.file_path,
    );
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
    /** GA-01 fitted tempo + residual (null OK — pre-GA-01 callers). */
    bpmFitted?: number | null;
    residualStd?: number | null;
  }): void {
    this.db
      .query(
        `INSERT INTO beats (video_id, bpm_raw, bpm_folded, beats_json, downbeats_json, model, source_path, analyzed_at, bpm_fitted, bpm_residual_std)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           bpm_raw = excluded.bpm_raw,
           bpm_folded = excluded.bpm_folded,
           beats_json = excluded.beats_json,
           downbeats_json = excluded.downbeats_json,
           model = excluded.model,
           source_path = excluded.source_path,
           analyzed_at = excluded.analyzed_at,
           bpm_fitted = excluded.bpm_fitted,
           bpm_residual_std = excluded.bpm_residual_std`,
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
        rec.bpmFitted ?? null,
        rec.residualStd ?? null,
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
    bpmFitted: number | null;
    residualStd: number | null;
  } | null {
    const row = this.db
      .query(
        `SELECT video_id, bpm_raw, bpm_folded, beats_json, downbeats_json, model, source_path, analyzed_at, bpm_fitted, bpm_residual_std
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
      bpm_fitted: number | null;
      bpm_residual_std: number | null;
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
      bpmFitted: row.bpm_fitted,
      residualStd: row.bpm_residual_std,
    };
  }

  /** All beat records joined to their track rows (downloaded only). */
  beatAnalyzedTracks(): Array<{
    track: TrackRow;
    beats: number[];
    downbeats: number[];
    bpmRaw: number | null;
    bpmFolded: number | null;
    bpmFitted: number | null;
    residualStd: number | null;
  }> {
    const rows = this.db
      .query(
        `SELECT t.*, b.beats_json, b.downbeats_json, b.bpm_raw, b.bpm_folded, b.bpm_fitted, b.bpm_residual_std
         FROM tracks t JOIN beats b ON b.video_id = t.video_id
         WHERE t.status = 'downloaded'`,
      )
      .all() as Array<
      TrackRow & {
        beats_json: string;
        downbeats_json: string;
        bpm_raw: number | null;
        bpm_folded: number | null;
        bpm_fitted: number | null;
        bpm_residual_std: number | null;
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
        bpmFitted: r.bpm_fitted,
        residualStd: r.bpm_residual_std,
      };
    });
  }

  /** Cache a file's blake2b256 content hash (the gold-annotation join
   * key). Only fills NULLs via `setContentHashes` bulk paths normally;
   * this single-row upsert is for tests and one-off fills. */
  setContentHash(videoId: string, hash: string): void {
    this.db
      .query(
        `UPDATE tracks SET content_hash = ?, updated_at = ? WHERE video_id = ?`,
      )
      .run(hash, this.now(), videoId);
  }

  /** (video_id, file_path) of every downloaded track whose content hash
   * is still unknown — the gold-report backfill queue. */
  tracksMissingContentHash(): Array<{
    videoId: string;
    filePath: string | null;
  }> {
    return (
      this.db
        .query(
          `SELECT video_id, file_path FROM tracks
           WHERE status = 'downloaded' AND content_hash IS NULL`,
        )
        .all() as Array<{ video_id: string; file_path: string | null }>
    ).map((r) => ({ videoId: r.video_id, filePath: r.file_path }));
  }

  // ---------- mood + cues ledgers (delegated — see state-ledgers.ts) ----------

  /** Upsert one parsed mood result. Idempotent by video_id: a re-run
   * replaces the row (fresh timestamps). */
  setMoodRecord(rec: MoodRecordInput): void {
    this.ledgers.setMoodRecord(rec);
  }

  /** One mood record (by video id), null when never analyzed. */
  moodRecord(videoId: string): MoodRecord | null {
    return this.ledgers.moodRecord(videoId);
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
    return this.ledgers.moodSummary();
  }

  /** Upsert one derived cue set. Idempotent by video_id: a re-run replaces
   * the row (fresh timestamps). */
  setCueRecord(rec: CueRecordInput): void {
    this.ledgers.setCueRecord(rec);
  }

  /** One cue record (by video id), null when never derived. */
  cueRecord(videoId: string): CueRecord | null {
    return this.ledgers.cueRecord(videoId);
  }

  /** All cue records joined to their track rows (downloaded only). */
  cueAnalyzedTracks(): Array<{
    videoId: string;
    title: string | null;
    cues: Array<{ index: number; position: number; bar: number }>;
    source: string;
  }> {
    return this.ledgers.cueAnalyzedTracks();
  }

  // ---------- embeddings ledger (roadmap I49 "sounds like") ----------
  // Implementation lives in state-similar.ts (file-length guard); these
  // delegates keep every call site (`state.setEmbeddingRecord(...)`,
  // `state.embeddingCorpus()`) unchanged.

  setEmbeddingRecord(rec: {
    videoId: string;
    vec: number[];
    sourcePath: string;
  }): void {
    this.embeddingsLedger.setEmbeddingRecord(rec);
  }

  embeddingRecord(videoId: string) {
    return this.embeddingsLedger.embeddingRecord(videoId);
  }

  embeddingCorpus() {
    return this.embeddingsLedger.embeddingCorpus();
  }
}

// I49 cosine kNN — re-exported from state-similar.ts (the SSOT) so
// existing `import { similarTracks } from "../state"` sites keep working.
export { cosineSimilarity, similarTracks } from "./state-similar";
