import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { BenchLedger } from "./db-bench";
import { DriveStore } from "./db-drives";
import { LedgerQueries, migrateArchiveLedger } from "./db-ledger";

const SCHEMA_V1 = `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS drives (
  id TEXT PRIMARY KEY,
  volume_uuid TEXT UNIQUE,
  name TEXT NOT NULL,
  nickname TEXT,
  photo_path TEXT,
  capacity_bytes INTEGER DEFAULT 0,
  fs TEXT,
  vendor TEXT, model TEXT, usb_serial TEXT,
  role TEXT DEFAULT 'unknown',
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_port_key TEXT,
  plug_count INTEGER DEFAULT 0,
  mounted INTEGER DEFAULT 0,
  last_snapshot_json TEXT,
  predecessor_id TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, drive_id TEXT NOT NULL, at INTEGER NOT NULL,
  kind TEXT NOT NULL, data_json TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_drive ON events(drive_id, at);
CREATE TABLE IF NOT EXISTS snapshots (
  drive_id TEXT NOT NULL, taken_at INTEGER NOT NULL, kind TEXT NOT NULL,
  data_json TEXT NOT NULL, PRIMARY KEY (drive_id, taken_at)
);
CREATE TABLE IF NOT EXISTS benchmarks (
  drive_id TEXT NOT NULL, ran_at INTEGER NOT NULL,
  seq_mbps REAL, rand4k_mbps REAL, PRIMARY KEY (drive_id, ran_at)
);
CREATE TABLE IF NOT EXISTS ledger (
  drive_id TEXT NOT NULL, path TEXT NOT NULL, size INTEGER, mtime INTEGER,
  hash TEXT, last_ok INTEGER, PRIMARY KEY (drive_id, path)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, drive_id TEXT NOT NULL, kind TEXT NOT NULL,
  status TEXT NOT NULL, progress REAL DEFAULT 0, error TEXT,
  result_json TEXT, log_path TEXT,
  created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS jobs_drive ON jobs(drive_id, status);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT);
CREATE TABLE IF NOT EXISTS archive_ledger (
  file_path TEXT PRIMARY KEY, size_bytes INTEGER, blake2b TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  flagged_at INTEGER,
  known_good_blake2b TEXT,
  known_good_size_bytes INTEGER
);
`;

/** Timeline events retained per drive. Shared by migration and write pruning. */
export const MAX_EVENTS_PER_DRIVE = 2000;

/** Connection ownership and schema migration for the public DB facade. */
export class DBCore {
  readonly sqlite: Database;
  masterName = "DJMASTER";
  mirrorName = "DJMIRROR";
  shelfName = "SHELF1";
  protected readonly ledger: LedgerQueries;
  protected readonly benchStore: BenchLedger;
  protected readonly driveStore: DriveStore;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.sqlite = new Database(dbPath);
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
    this.sqlite.exec("PRAGMA busy_timeout = 5000;");
    this.sqlite.exec("PRAGMA synchronous = NORMAL;");
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
    this.ledger = new LedgerQueries(this.sqlite);
    this.benchStore = new BenchLedger(this.sqlite);
    this.driveStore = new DriveStore(this.sqlite);
    migrateArchiveLedger(this.sqlite);
    this.migrate();
  }

  private migrate(): void {
    this.sqlite.exec(SCHEMA_V1);
    const cols = this.sqlite
      .query<{ name: string }, []>("PRAGMA table_info(jobs)")
      .all()
      .map((c) => c.name);
    if (!cols.includes("message"))
      this.sqlite.exec("ALTER TABLE jobs ADD COLUMN message TEXT");
    if (!cols.includes("phase"))
      this.sqlite.exec("ALTER TABLE jobs ADD COLUMN phase TEXT");
    if (!cols.includes("eta_seconds"))
      this.sqlite.exec("ALTER TABLE jobs ADD COLUMN eta_seconds REAL");
    if (!this.columnNames("drives").includes("verify_report_json"))
      this.sqlite.exec("ALTER TABLE drives ADD COLUMN verify_report_json TEXT");
    if (!this.columnNames("jobs").includes("origin"))
      this.sqlite.exec(
        "ALTER TABLE jobs ADD COLUMN origin TEXT NOT NULL DEFAULT 'web'",
      );
    this.driveStore.pruneAll();
    if (!this.columnNames("drives").includes("link_bps"))
      this.sqlite.exec("ALTER TABLE drives ADD COLUMN link_bps INTEGER");
    this.pruneEvents();
    const version = this.sqlite
      .query<{ value: string }, []>("SELECT value FROM meta WHERE key='schema'")
      .get();
    if (!version)
      this.sqlite
        .query("INSERT INTO meta (key, value) VALUES ('schema', '2')")
        .run();
  }

  private columnNames(table: "drives" | "jobs"): string[] {
    return this.sqlite
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map((column) => column.name);
  }

  private pruneEvents(max = MAX_EVENTS_PER_DRIVE): void {
    this.sqlite
      .query(
        `DELETE FROM events WHERE id NOT IN (
           SELECT id FROM events e2 WHERE e2.drive_id = events.drive_id
           ORDER BY at DESC LIMIT ?
         )`,
      )
      .run(max);
  }
}
