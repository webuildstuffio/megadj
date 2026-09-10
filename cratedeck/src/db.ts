// db.ts — bun:sqlite, schema, migrations, and every query (one place).
// Heavy query families live in their own modules (db_ledger.ts, db_bench.ts,
// db_drives.ts); DB delegates so every call site is unchanged.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Drive,
  Job,
  JobKind,
  SnapshotData,
  TimelineEvent,
  VerifyReport,
  BenchRun,
} from "../shared/types";
import { FleetStore } from "./fleet-db";
import { LedgerQueries, migrateArchiveLedger } from "./db_ledger";
import { BenchLedger } from "./db_bench";
import { DriveStore } from "./db_drives";
import type { TrackRow, PlaylistEntryRow, ManifestRow } from "./fleet";

// inferRole moved to db_drives.ts with its only runtime caller (upsertDrive);
// re-exported so existing `from "./db"` import sites (tests, detectors) keep
// working unchanged.
export { inferRole } from "./db_drives";

/** Raw row shape as stored in the events table. */
interface EventRow {
  id: string;
  drive_id: string;
  at: number;
  kind: string;
  data_json: string | null;
}

/** Timeline events trimmed at boot; cheap insurance against slow bloat. */
const MAX_EVENTS_PER_DRIVE = 2000;

function eventRow(r: EventRow): TimelineEvent {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(r.data_json ?? "{}");
  } catch (e) {
    // corrupt row keeps rendering (timeline must not break on one bad event)
    // but the bad payload is visible in the event itself + server console.
    console.error(`timeline event ${r.id} has corrupt data_json`, e);
    data = { corrupt: true, raw: r.data_json ?? null };
  }
  return { id: r.id, drive_id: r.drive_id, at: r.at, kind: r.kind, data };
}

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

export class DB {
  readonly sqlite: Database;
  /** Configured master/mirror/shelf volume names — inferRole compares
   *  against these, not just the doc defaults (config.toml's
   *  library.master_drive/mirror_drive/shelf_drive override them). */
  masterName = "DJMASTER";
  mirrorName = "DJMIRROR";
  shelfName = "SHELF1";
  /** D30 archive-integrity ledger queries (db_ledger.ts). */
  private ledger: LedgerQueries;
  /** Benchmark + checksum-ledger queries (db_bench.ts). */
  private benchStore: BenchLedger;
  /** Drives CRUD + snapshot store queries (db_drives.ts). */
  private driveStore: DriveStore;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.sqlite = new Database(dbPath);
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
    // WAL + NORMAL is the SQLite-recommended combo: durable across app
    // crashes, skips fsync-on-every-commit (huge write-churn cut).
    this.sqlite.exec("PRAGMA synchronous = NORMAL;");
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
    this.ledger = new LedgerQueries(this.sqlite);
    this.benchStore = new BenchLedger(this.sqlite);
    this.driveStore = new DriveStore(this.sqlite);
    migrateArchiveLedger(this.sqlite);
    this.migrate();
  }

  private migrate() {
    this.sqlite.exec(SCHEMA_V1);
    // v2: human-facing job progress (message/phase/eta) for UI + agent CLI
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
    // v3: persist the latest verify report per drive so UI/CLI can render a
    // granular check-by-check breakdown without digging through job history.
    if (
      !this.sqlite
        .query<{ name: string }, []>("PRAGMA table_info(drives)")
        .all()
        .map((c) => c.name)
        .includes("verify_report_json")
    ) {
      this.sqlite.exec("ALTER TABLE drives ADD COLUMN verify_report_json TEXT");
    }
    // v4 (O87): job attribution — "why did this verify run at 3am" is only
    // answerable if the row records who asked. Backfilled rows read "web".
    if (
      !this.sqlite
        .query<{ name: string }, []>("PRAGMA table_info(jobs)")
        .all()
        .map((c) => c.name)
        .includes("origin")
    ) {
      this.sqlite.exec(
        "ALTER TABLE jobs ADD COLUMN origin TEXT NOT NULL DEFAULT 'web'",
      );
    }
    // disk-burn guard: cap per-drive snapshot history (each full snapshot can
    // be ~MBs of JSON; unbounded growth would eat the host disk over months)
    this.driveStore.pruneAll();
    // v5: negotiated USB link rate (bits/s) per drive — powers the USB2 vs
    // USB3 flag. New rows get it from the ioreg tree at reconcile time.
    if (
      !this.sqlite
        .query<{ name: string }, []>("PRAGMA table_info(drives)")
        .all()
        .map((c) => c.name)
        .includes("link_bps")
    ) {
      this.sqlite.exec("ALTER TABLE drives ADD COLUMN link_bps INTEGER");
    }
    this.pruneEvents();
    const v = this.sqlite
      .query<{ value: string }, []>("SELECT value FROM meta WHERE key='schema'")
      .get();
    if (!v) {
      this.sqlite
        .query("INSERT INTO meta (key, value) VALUES ('schema', '2')")
        .run();
    }
  }

  /** Trim timeline events at boot (they're capped per drive). */
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

  // ---- D30 archive-integrity ledger + fleet tables (queries in db_ledger.ts /
  //  fleet-db.ts) -----------------------------------------------------------
  /** All known-good archive hashes (file_path → row). */
  archiveLedger(): Map<string, import("./archive_sweep").LedgerRow> {
    return this.ledger.all();
  }
  /** Record/refresh one known-good hash (upsert; sweep findings only). */
  upsertArchiveLedger(row: import("./archive_sweep").LedgerRow): void {
    this.ledger.upsert(row);
  }
  private fleetStore?: FleetStore;
  private get fleet(): FleetStore {
    this.fleetStore ??= new FleetStore(this.sqlite);
    return this.fleetStore;
  }

  /** Latest per-track inventory rows per drive (fleet queries' input). */
  fleetInventories(driveIds?: string[]): Map<string, TrackRow[]> {
    return this.fleet.inventories(driveIds);
  }

  fleetPlaylistEntries(driveIds?: string[]): Map<string, PlaylistEntryRow[]> {
    return this.fleet.playlistEntries(driveIds);
  }

  fleetManifests(driveIds?: string[]): Map<string, ManifestRow[]> {
    return this.fleet.manifests(driveIds);
  }

  // ---- drives (CRUD in db_drives.ts — delegated so call sites unchanged) --
  /** The configured master drive (role tag or exact name), else null. */
  masterDrive(): Drive | null {
    return this.allDrives().find((d) => d.role === "master") ?? null;
  }

  getDrive(id: string): Drive | null {
    return this.driveStore.get(id);
  }

  getDriveByUuid(uuid: string): Drive | null {
    return this.driveStore.getByUuid(uuid);
  }

  allDrives(): Drive[] {
    return this.driveStore.all();
  }

  upsertDrive(d: Partial<Drive> & { id: string }): void {
    this.driveStore.upsert(d, this.masterName, this.mirrorName, this.shelfName);
  }

  setMounted(id: string, mounted: boolean): void {
    this.driveStore.setMounted(id, mounted);
  }

  /** Persist the latest verify report for a drive (or clear with null). */
  setVerifyReport(id: string, report: VerifyReport | null): void {
    this.driveStore.setVerifyReport(id, report);
  }

  getVerifyReport(id: string): VerifyReport | null {
    return this.driveStore.getVerifyReport(id);
  }

  /** Increment at mount time (ghost → mounted flip). Called by registry.
   *  Also stamps first_seen_at on first mount (count goes 0 → 1). */
  bumpPlugCount(id: string): void {
    const cur = this.getDrive(id);
    const first = cur?.plug_count ? 0 : 1;
    this.driveStore.bumpPlugCount(id);
    if (first) this.driveStore.bumpFirstSeen(id);
  }

  setNickname(id: string, nickname: string | null): void {
    this.driveStore.setNickname(id, nickname);
  }

  setPhoto(id: string, path: string): void {
    this.driveStore.setPhoto(id, path);
  }

  setSnapshot(id: string, snap: SnapshotData): void {
    // Skip the write entirely when nothing changed apart from the timestamp:
    // every scan stamps `taken_at`, so a naive JSON compare never fired and a
    // re-scan of a stable drive rewrote ~MBs of identical JSON. Key-sorted
    // stringify keeps the comparison key-order-insensitive (db_drives.ts
    // snapshotUnchanged; corrupt prior blobs log + rewrite, never dedupe).
    if (this.driveStore.snapshotUnchanged(id, snap)) return;
    this.driveStore.putSnapshot(id, snap);
    // fleet tables ride along: per-track inventory + playlist entries +
    // manifest refresh wholesale on every persisted scan (§B6/B7/B8 input)
    this.fleet.sync(id, snap);
    this.driveStore.pruneFor(id); // disk-burn guard
  }

  latestSnapshots(): Map<string, SnapshotData> {
    return this.driveStore.latestSnapshots();
  }

  snapshots(driveId: string): SnapshotData[] {
    return this.driveStore.snapshots(driveId);
  }

  // ---- events (queries extracted to db_events.ts at the file-length
  // guard; the writer stays here — prepared-stmt caching is hot-path) ----
  private eventStmt?: ReturnType<Database["prepare"]>;
  private eventPruneStmt?: ReturnType<Database["prepare"]>;
  event(
    driveId: string,
    kind: string,
    data: Record<string, unknown> = {},
  ): string {
    // prepared-once + transactional batching: timeline writes happen in
    // bursts (jobs, reconcile), WAL commit overhead dominates otherwise
    this.eventStmt ??= this.sqlite.prepare(
      "INSERT INTO events (id, drive_id, at, kind, data_json) VALUES (?,?,?,?,?)",
    );
    const id = crypto.randomUUID();
    this.sqlite.transaction(() =>
      this.eventStmt!.run(id, driveId, Date.now(), kind, JSON.stringify(data)),
    )();
    // Enforce the per-drive cap on the WRITE path too: boot-time pruning
    // alone lets the table grow without bound during long uptimes
    // (auto-scan + weekly verify + per-job bursts). Cheap: indexed by
    // (drive_id, at), deletes nothing until the cap is crossed.
    this.eventPruneStmt ??= this.sqlite.prepare(
      `DELETE FROM events WHERE drive_id=? AND id NOT IN (
         SELECT id FROM events WHERE drive_id=? ORDER BY at DESC LIMIT ?
       )`,
    );
    this.eventPruneStmt.run(driveId, driveId, MAX_EVENTS_PER_DRIVE);
    return id;
  }

  timeline(driveId: string, limit = 200): TimelineEvent[] {
    return (
      this.sqlite
        .query("SELECT * FROM events WHERE drive_id=? ORDER BY at DESC LIMIT ?")
        .all(driveId, limit) as EventRow[]
    ).map(eventRow);
  }

  // ---- jobs -----------------------------------------------------------------
  insertJob(j: Job, origin = "web"): void {
    this.sqlite
      .query(
        `INSERT INTO jobs (id, drive_id, kind, status, progress, error, result_json,
           log_path, created_at, started_at, finished_at, origin)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        j.id,
        j.drive_id,
        j.kind,
        j.status,
        j.progress,
        j.error,
        j.result_json,
        j.log_path,
        j.created_at,
        j.started_at,
        j.finished_at,
        origin,
      );
  }

  updateJob(id: string, patch: Partial<Job>): void {
    const cur = this.getJob(id);
    if (!cur) return;
    const j = { ...cur, ...patch };
    this.sqlite
      .query(
        `UPDATE jobs SET status=?, progress=?, error=?, result_json=?,
           started_at=?, finished_at=?, message=?, phase=?, eta_seconds=?
         WHERE id=?`,
      )
      .run(
        j.status,
        j.progress,
        j.error,
        j.result_json,
        j.started_at,
        j.finished_at,
        j.message ?? null,
        j.phase ?? null,
        j.eta_seconds ?? null,
        id,
      );
  }

  /** Fine-grained progress update: fraction, human message, phase, ETA (s).
   *  ETA is tri-state: `undefined` = keep the current value (log-line updates
   *  pass no ETA and must not wipe the one `tick()` computed), `null` =
   *  explicitly clear (unknown again), a number = set. */
  setJobProgress(
    id: string,
    p: {
      progress?: number;
      message?: string;
      phase?: string;
      eta_seconds?: number | null;
    },
  ): void {
    this.sqlite
      .query(
        `UPDATE jobs SET
           progress=COALESCE(?,progress),
           message=COALESCE(?,message),
           phase=COALESCE(?,phase),
           eta_seconds=CASE WHEN ? THEN ? ELSE eta_seconds END
         WHERE id=?`,
      )
      .run(
        p.progress ?? null,
        p.message ?? null,
        p.phase ?? null,
        // 0 = omitted (keep), 1 = present (set, possibly to NULL)
        p.eta_seconds === undefined ? 0 : 1,
        p.eta_seconds === undefined ? null : p.eta_seconds,
        id,
      );
  }

  getJob(id: string): Job | null {
    return (
      (this.sqlite
        .query("SELECT * FROM jobs WHERE id=?")
        .get(id) as Job | null) ?? null
    );
  }

  jobsForDrive(driveId: string, limit = 20, activeOnly = false): Job[] {
    if (driveId === "*") {
      return this.sqlite
        .query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
        .all(limit) as Job[];
    }
    if (activeOnly) {
      return this.sqlite
        .query(
          "SELECT * FROM jobs WHERE drive_id=? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT ?",
        )
        .all(driveId, limit) as Job[];
    }
    return this.sqlite
      .query(
        "SELECT * FROM jobs WHERE drive_id=? ORDER BY created_at DESC LIMIT ?",
      )
      .all(driveId, limit) as Job[];
  }

  activeJobs(): Job[] {
    return this.sqlite
      .query(
        "SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at",
      )
      .all() as Job[];
  }

  /** Safety net for crashed/lost job completions: any 'running' job whose
   *  row went stale (no heartbeat for staleMs) is marked interrupted. The
   *  JobEngine calls this on a timer so a phantom "running 0%" can never
   *  outlive the process that owns it. */
  reapStaleRunning(staleMs: number): number {
    const cutoff = Date.now() - staleMs;
    const r = this.sqlite
      .query(
        `UPDATE jobs SET status='interrupted', finished_at=?, error=COALESCE(error,'job lost — server restarted or event stream dropped')
         WHERE status IN ('queued','running') AND id IN (
           SELECT id FROM jobs WHERE status IN ('queued','running') AND started_at IS NOT NULL AND started_at < ?
         )`,
      )
      .run(Date.now(), cutoff);
    return r.changes;
  }

  activeJobOfKind(driveId: string, kind: JobKind): Job | null {
    return (
      (this.sqlite
        .query(
          "SELECT * FROM jobs WHERE drive_id=? AND kind=? AND status IN ('queued','running')",
        )
        .get(driveId, kind) as Job | null) ?? null
    );
  }

  latestVerify(driveId: string): { ran_at: number; ok: boolean } | null {
    // Prefer the persisted per-drive verify report (single source of truth
    // for the latest run); fall back to job history for pre-migration data.
    const rep = this.getVerifyReport(driveId);
    if (rep) return { ran_at: rep.ran_at, ok: rep.ok };
    const row = this.sqlite
      .query(
        `SELECT finished_at, result_json FROM jobs
         WHERE drive_id=? AND kind='verify' AND status='done'
         ORDER BY finished_at DESC LIMIT 1`,
      )
      .get(driveId) as { finished_at: number; result_json: string } | null;
    if (!row) return null;
    let ok = false;
    try {
      ok =
        (JSON.parse(row.result_json) as { verdict?: string } | null)
          ?.verdict === "pass";
    } catch (e) {
      // a corrupt verify result must not read as "verified" — treat as
      // unknown-failure and say why on the console.
      console.error(`verify result for ${driveId} has corrupt result_json`, e);
      ok = false;
    }
    return { ran_at: row.finished_at, ok };
  }

  /** Files that changed vs the checksum ledger, from the newest checksum job.
   *  null = no checksum run recorded yet (distinct from a clean 0). */
  latestChecksum(driveId: string): { ran_at: number; changed: number } | null {
    const row = this.sqlite
      .query(
        `SELECT finished_at, result_json FROM jobs
         WHERE drive_id=? AND kind='checksum' AND status='done'
         ORDER BY finished_at DESC LIMIT 1`,
      )
      .get(driveId) as { finished_at: number; result_json: string } | null;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.result_json) as {
        changed?: unknown;
      } | null;
      const changed = parsed?.changed;
      const n = Array.isArray(changed) ? changed.length : undefined;
      return typeof n === "number"
        ? { ran_at: row.finished_at, changed: n }
        : null;
    } catch {
      return null;
    }
  }

  /** Boot-time: any job left queued/running from a dead process. */
  reapOrphanJobs(): number {
    const r = this.sqlite
      .query(
        `UPDATE jobs SET status='interrupted', finished_at=?
         WHERE status IN ('queued','running','locked')`,
      )
      .run(Date.now());
    return r.changes;
  }

  // ---- benchmarks + ledger (queries extracted to db_bench.ts at the
  // file-length guard; delegated so call sites are unchanged) ----

  addBenchmark(driveId: string, seq: number, rand4k: number): void {
    this.benchStore.addBenchmark(driveId, seq, rand4k);
  }

  benchmarks(driveId: string): BenchRun[] {
    return this.benchStore.benchmarks(driveId);
  }

  addSpeedProbe(driveId: string, mbps: number, bytesRead: number): void {
    this.benchStore.addSpeedProbe(driveId, mbps, bytesRead);
  }

  speedProbes(driveId: string): { ran_at: number; mbps: number }[] {
    return this.benchStore.speedProbes(driveId);
  }

  ledgerBiggest(driveId: string, limit: number): string[] {
    return this.benchStore.ledgerBiggest(driveId, limit);
  }

  manifestBiggest(driveId: string, limit: number): string[] {
    return this.benchStore.manifestBiggest(driveId, limit);
  }

  ledgerPut(
    driveId: string,
    path: string,
    size: number,
    mtime: number,
    hash: string,
  ): void {
    this.benchStore.ledgerPut(driveId, path, size, mtime, hash);
  }

  ledgerGet(
    driveId: string,
    path: string,
  ): { hash: string; size: number; mtime: number } | null {
    return this.benchStore.ledgerGet(driveId, path);
  }

  ledgerCount(driveId: string): number {
    return this.benchStore.ledgerCount(driveId);
  }

  /** Days since the newest ledger entry (how fresh corruption tracking is). */
  ledgerAgeDays(driveId: string): number | null {
    return this.benchStore.ledgerAgeDays(driveId);
  }

  close(): void {
    this.sqlite.close();
  }
}
