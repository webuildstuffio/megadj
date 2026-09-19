import { openLedger } from "../shared/sqlite-ledger";
import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { Ledgers } from "./ledgers";
import { EmbeddingsLedger, KeysLedger } from "./similar";
import { ShelfSweeps } from "./sweeps";

/** Connection, schema, and delegated ledger ownership for archive state. */
export class ArchiveCore {
  readonly db: Database;
  readonly dbDir: string;
  protected readonly embeddingsLedger: EmbeddingsLedger;
  protected readonly keysLedger: KeysLedger;
  protected readonly ledgers: Ledgers;
  readonly shelfSweeps: ShelfSweeps;

  constructor(dbPath: string) {
    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    this.dbDir = dir;
    if (dir) mkdirSync(dir, { recursive: true });
    this.db = openLedger(dbPath, { create: true });
    this.embeddingsLedger = new EmbeddingsLedger(this.db, () => this.now());
    this.keysLedger = new KeysLedger(this.db, () => this.now());
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
    this.addColumnIfMissing(
      "tracks",
      "source",
      "TEXT NOT NULL DEFAULT 'liked'",
    );
    this.addColumnIfMissing("tracks", "genre", "TEXT");
    this.addColumnIfMissing("tracks", "genre_flag", "TEXT");
    this.addColumnIfMissing("tracks", "genre_votes", "TEXT");
    this.addColumnIfMissing("tracks", "year", "TEXT");
    this.addColumnIfMissing("tracks", "label", "TEXT");
    this.addColumnIfMissing("tracks", "energy", "INTEGER");
    this.addColumnIfMissing("tracks", "artwork_status", "TEXT");
    this.addColumnIfMissing("tracks", "content_hash", "TEXT");
    // #256 link-first: the acquisition links surfaced for a track
    // (purchase/free-download/description store links), JSON-encoded.
    this.addColumnIfMissing("tracks", "source_links", "TEXT");
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_tracks_content_hash ON tracks(content_hash)",
    );
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
        vec_json TEXT NOT NULL, source_path TEXT NOT NULL,
        analyzed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS track_keys (
        video_id TEXT PRIMARY KEY, key TEXT NOT NULL,
        source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL
      );
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source)",
    );
  }

  private addColumnIfMissing(table: string, column: string, ddl: string): void {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    if (!columns.some((candidate) => candidate.name === column))
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }

  close(): void {
    this.db.close();
  }

  now(): string {
    return new Date().toISOString();
  }
}
