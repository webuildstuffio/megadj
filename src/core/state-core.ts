import { openLedger } from "../shared/sqlite-ledger";
import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { isFiniteNumberArray } from "../shared/leaf/guards";
import { vecToF32Blob } from "../shared/leaf/vector-space";
import { Ledgers } from "./ledgers";
import { EmbeddingsLedger } from "./similar";
import { ShelfSweeps } from "./sweeps";

/** Connection, schema, and delegated ledger ownership for archive state. */
export class ArchiveCore {
  readonly db: Database;
  readonly dbDir: string;
  protected readonly embeddingsLedger: EmbeddingsLedger;
  protected readonly ledgers: Ledgers;
  readonly shelfSweeps: ShelfSweeps;

  constructor(dbPath: string) {
    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    this.dbDir = dir;
    if (dir) mkdirSync(dir, { recursive: true });
    this.db = openLedger(dbPath, { create: true });
    this.embeddingsLedger = new EmbeddingsLedger(this.db, () => this.now());
    this.ledgers = new Ledgers(this.db, () => this.now());
    this.shelfSweeps = new ShelfSweeps(this.db);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tracks (
        video_id TEXT PRIMARY KEY, title TEXT, artist TEXT, album TEXT,
        status TEXT NOT NULL DEFAULT 'pending', format_id TEXT,
        bitrate_kbps INTEGER, codec TEXT, file_path TEXT,
        file_size_bytes INTEGER, duration_s REAL,
        attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT,
        last_error TEXT, liked_position INTEGER,
        first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL,
        finished_at TEXT, attempted INTEGER NOT NULL DEFAULT 0,
        downloaded INTEGER NOT NULL DEFAULT 0, gone INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0, bytes_downloaded INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(status);
      CREATE INDEX IF NOT EXISTS idx_tracks_position ON tracks(liked_position);
    `);
    this.addColumnIfMissing("tracks", "source", "TEXT NOT NULL DEFAULT 'liked'");
    this.addColumnIfMissing("tracks", "genre", "TEXT");
    this.addColumnIfMissing("tracks", "genre_flag", "TEXT");
    this.addColumnIfMissing("tracks", "genre_votes", "TEXT");
    this.addColumnIfMissing("tracks", "year", "TEXT");
    this.addColumnIfMissing("tracks", "label", "TEXT");
    this.addColumnIfMissing("tracks", "energy", "REAL");
    this.addColumnIfMissing("tracks", "genre_secondary", "TEXT");
    this.addColumnIfMissing("tracks", "artwork_status", "TEXT");
    this.addColumnIfMissing("tracks", "mood_status", "TEXT");
    this.addColumnIfMissing("tracks", "content_hash", "TEXT");
    // #256 link-first: the acquisition links surfaced for a track
    // (purchase/free-download/description store links), JSON-encoded.
    this.addColumnIfMissing("tracks", "source_links", "TEXT");
    // Surfaced-link workflow (Sep 19): the user clicks the link, saves the
    // file into the downloads folder, and checks it off. NULL = not yet.
    this.addColumnIfMissing("tracks", "surfaced_done_at", "TEXT");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_tracks_content_hash ON tracks(content_hash)");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS beats (
        video_id TEXT PRIMARY KEY, bpm_raw REAL, bpm_folded REAL,
        beats_json TEXT NOT NULL, downbeats_json TEXT NOT NULL,
        model TEXT NOT NULL, source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL
      );
    `);
    this.addColumnIfMissing("beats", "bpm_fitted", "REAL");
    this.addColumnIfMissing("beats", "bpm_residual_std", "REAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mood (
        video_id TEXT PRIMARY KEY, dance REAL NOT NULL,
        aggressive REAL NOT NULL, happy REAL NOT NULL,
        electronic REAL NOT NULL, party REAL NOT NULL,
        valence REAL NOT NULL, arousal REAL NOT NULL,
        source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cues (
        video_id TEXT PRIMARY KEY, cues_json TEXT NOT NULL,
        model TEXT NOT NULL, derived_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS embeddings (
        video_id TEXT PRIMARY KEY, dim INTEGER NOT NULL,
        vec_json TEXT NOT NULL, vec_f32 BLOB, source_path TEXT NOT NULL,
        analyzed_at TEXT NOT NULL
      );`);
    this.addColumnIfMissing("embeddings", "model", "TEXT");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS section_embeddings (
        video_id TEXT NOT NULL, model TEXT NOT NULL,
        dim INTEGER NOT NULL, vec_json TEXT NOT NULL, vec_f32 BLOB,
        source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL,
        section_start REAL, section_end REAL,
        PRIMARY KEY (video_id, model)
      );`);
    // #562: hot paths read `vec_f32` (raw float32 BLOB — one memcpy, no
    // JSON.parse); `vec_json` stays populated by the write seam for the
    // debugging tools and the readers that still speak JSON. This backfill
    // runs before any read: every legacy row gets its blob at open time.
    this.addColumnIfMissing("embeddings", "vec_f32", "BLOB");
    this.addColumnIfMissing("section_embeddings", "vec_f32", "BLOB");
    this.backfillVecF32("embeddings", ["video_id"]);
    this.backfillVecF32("section_embeddings", ["video_id", "model"]);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS track_keys (
        video_id TEXT PRIMARY KEY, key TEXT NOT NULL,
        source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL
      );
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source)");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stem_cache (
        video_id TEXT PRIMARY KEY, model TEXT NOT NULL,
        stem_dir TEXT NOT NULL,
        vocals_path TEXT, drums_path TEXT, bass_path TEXT, other_path TEXT,
        sample_rate INTEGER NOT NULL, source_path TEXT NOT NULL,
        analyzed_at TEXT NOT NULL, elapsed_s REAL
      );
    `);
    this.addColumnIfMissing("stem_cache", "vox_hook", "TEXT");
  }

  private addColumnIfMissing(table: string, column: string, ddl: string): void {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((candidate) => candidate.name === column))
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }

  /** #562 one-time backfill: encode legacy `vec_json` rows into `vec_f32`
   * blobs. A row whose JSON is corrupt keeps a NULL blob — the read-side
   * poison-row guard then treats it as absent, exactly like every ledger
   * read. */
  private backfillVecF32(table: "embeddings" | "section_embeddings", keyColumns: string[]): void {
    const rows = this.db
      .query(
        `SELECT ${keyColumns.join(", ")}, vec_json FROM ${table}
         WHERE vec_f32 IS NULL AND vec_json IS NOT NULL`,
      )
      .all() as (Record<string, unknown> & { vec_json: string })[];
    if (rows.length === 0) return;
    const where = keyColumns.map((c) => `${c} = ?`).join(" AND ");
    const update = this.db.query(`UPDATE ${table} SET vec_f32 = ? WHERE ${where}`);
    this.db.transaction(() => {
      for (const row of rows) {
        let vec: unknown;
        try {
          vec = JSON.parse(row.vec_json) as unknown;
        } catch {
          console.warn(`${table} backfill: unparseable vec_json — leaving vec_f32 NULL`);
          continue;
        }
        if (!isFiniteNumberArray(vec) || vec.length === 0) {
          console.warn(`${table} backfill: non-finite vec_json — leaving vec_f32 NULL`);
          continue;
        }
        update.run(vecToF32Blob(vec), ...keyColumns.map((c) => String(row[c])));
      }
    })();
  }

  close(): void {
    this.db.close();
  }

  now(): string {
    return new Date().toISOString();
  }
}
