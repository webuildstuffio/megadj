// db.ts — bun:sqlite, schema, migrations, and every query (one place).
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Drive,
  Job,
  JobKind,
  JobStatus,
  SnapshotData,
  TimelineEvent,
} from "../shared/types";

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
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
`;

export class DB {
  readonly sqlite: Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.sqlite = new Database(dbPath);
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate() {
    this.sqlite.exec(SCHEMA_V1);
    const v = this.sqlite
      .query<{ value: string }, []>("SELECT value FROM meta WHERE key='schema'")
      .get();
    if (!v) {
      this.sqlite
        .query("INSERT INTO meta (key, value) VALUES ('schema', '1')")
        .run();
    }
  }

  // ---- drives -------------------------------------------------------------
  private normDrive(d: any): Drive {
    return { ...d, mounted: !!d.mounted };
  }

  getDrive(id: string): Drive | null {
    const r = this.sqlite
      .query("SELECT * FROM drives WHERE id = ?")
      .get(id) as any;
    return r ? this.normDrive(r) : null;
  }

  getDriveByUuid(uuid: string): Drive | null {
    const r = this.sqlite
      .query("SELECT * FROM drives WHERE volume_uuid = ?")
      .get(uuid) as any;
    return r ? this.normDrive(r) : null;
  }

  allDrives(): Drive[] {
    return (
      this.sqlite
        .query(
          "SELECT * FROM drives ORDER BY mounted DESC, nickname IS NULL, name",
        )
        .all() as any[]
    ).map((r) => this.normDrive(r));
  }

  upsertDrive(d: Partial<Drive> & { id: string }): void {
    const cur = this.getDrive(d.id);
    if (!cur) {
      const now = Date.now();
      this.sqlite
        .query(
          `INSERT INTO drives (id, volume_uuid, name, capacity_bytes, fs, vendor,
             model, usb_serial, role, first_seen_at, last_seen_at,
             last_port_key, plug_count, mounted)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          d.id,
          d.volume_uuid ?? null,
          d.name,
          d.capacity_bytes ?? 0,
          d.fs ?? null,
          d.vendor ?? null,
          d.model ?? null,
          d.usb_serial ?? null,
          d.role ?? inferRole(d.name ?? ""),
          now,
          now,
          d.last_port_key ?? null,
          1,
          d.mounted ? 1 : 0,
        );
      return;
    }
    this.sqlite
      .query(
        `UPDATE drives SET name=COALESCE(?,name), capacity_bytes=COALESCE(?,capacity_bytes),
           fs=COALESCE(?,fs), vendor=COALESCE(?,vendor), model=COALESCE(?,model),
           usb_serial=COALESCE(?,usb_serial), role=COALESCE(?,role),
           last_seen_at=?, last_port_key=COALESCE(?,last_port_key),
           mounted=?, nickname=COALESCE(?,nickname)
         WHERE id=?`,
      )
      .run(
        d.name ?? null,
        d.capacity_bytes ?? null,
        d.fs ?? null,
        d.vendor ?? null,
        d.model ?? null,
        d.usb_serial ?? null,
        d.role ?? null,
        d.last_seen_at ?? Date.now(),
        d.last_port_key ?? null,
        d.mounted === undefined ? 1 : d.mounted ? 1 : 0,
        d.nickname ?? null,
        d.id,
      );
  }

  setMounted(id: string, mounted: boolean): void {
    this.sqlite
      .query("UPDATE drives SET mounted=?, last_seen_at=? WHERE id=?")
      .run(mounted ? 1 : 0, Date.now(), id);
  }

  setNickname(id: string, nickname: string | null): void {
    this.sqlite
      .query("UPDATE drives SET nickname=? WHERE id=?")
      .run(nickname, id);
  }

  setPhoto(id: string, path: string): void {
    this.sqlite
      .query("UPDATE drives SET photo_path=? WHERE id=?")
      .run(path, id);
  }

  setSnapshot(id: string, snap: SnapshotData): void {
    this.sqlite
      .query("UPDATE drives SET last_snapshot_json=? WHERE id=?")
      .run(JSON.stringify(snap), id);
    this.sqlite
      .query(
        "INSERT OR REPLACE INTO snapshots (drive_id, taken_at, kind, data_json) VALUES (?,?,?,?)",
      )
      .run(id, snap.taken_at, snap.kind, JSON.stringify(snap));
  }

  latestSnapshots(): Map<string, SnapshotData> {
    const rows = this.sqlite
      .query(
        `SELECT drive_id, data_json FROM snapshots s WHERE taken_at = (
           SELECT MAX(taken_at) FROM snapshots WHERE drive_id = s.drive_id)`,
      )
      .all() as { drive_id: string; data_json: string }[];
    return new Map(rows.map((r) => [r.drive_id, JSON.parse(r.data_json)]));
  }

  snapshots(driveId: string): SnapshotData[] {
    return (
      this.sqlite
        .query(
          "SELECT data_json FROM snapshots WHERE drive_id=? ORDER BY taken_at",
        )
        .all(driveId) as { data_json: string }[]
    ).map((r) => JSON.parse(r.data_json));
  }

  // ---- events ---------------------------------------------------------------
  event(
    driveId: string,
    kind: string,
    data: Record<string, unknown> = {},
  ): void {
    this.sqlite
      .query(
        "INSERT INTO events (id, drive_id, at, kind, data_json) VALUES (?,?,?,?,?)",
      )
      .run(
        crypto.randomUUID(),
        driveId,
        Date.now(),
        kind,
        JSON.stringify(data),
      );
  }

  timeline(driveId: string, limit = 200): TimelineEvent[] {
    return (
      this.sqlite
        .query("SELECT * FROM events WHERE drive_id=? ORDER BY at DESC LIMIT ?")
        .all(driveId, limit) as any[]
    ).map((r) => ({
      id: r.id,
      drive_id: r.drive_id,
      at: r.at,
      kind: r.kind,
      data: JSON.parse(r.data_json ?? "{}"),
    }));
  }

  recentEvents(limit = 50): TimelineEvent[] {
    return (
      this.sqlite
        .query("SELECT * FROM events ORDER BY at DESC LIMIT ?")
        .all(limit) as any[]
    ).map((r) => ({
      id: r.id,
      drive_id: r.drive_id,
      at: r.at,
      kind: r.kind,
      data: JSON.parse(r.data_json ?? "{}"),
    }));
  }

  // ---- jobs -----------------------------------------------------------------
  insertJob(j: Job): void {
    this.sqlite
      .query(
        `INSERT INTO jobs (id, drive_id, kind, status, progress, error, result_json,
           log_path, created_at, started_at, finished_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
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
      );
  }

  updateJob(id: string, patch: Partial<Job>): void {
    const cur = this.getJob(id);
    if (!cur) return;
    const j = { ...cur, ...patch };
    this.sqlite
      .query(
        `UPDATE jobs SET status=?, progress=?, error=?, result_json=?,
           started_at=?, finished_at=? WHERE id=?`,
      )
      .run(
        j.status,
        j.progress,
        j.error,
        j.result_json,
        j.started_at,
        j.finished_at,
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

  jobsForDrive(driveId: string, limit = 20): Job[] {
    if (driveId === "*") {
      return this.sqlite
        .query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
        .all(limit) as Job[];
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
        "SELECT * FROM jobs WHERE status IN ('queued','running','locked') ORDER BY created_at",
      )
      .all() as Job[];
  }

  activeJobOfKind(driveId: string, kind: JobKind): Job | null {
    return (
      (this.sqlite
        .query(
          "SELECT * FROM jobs WHERE drive_id=? AND kind=? AND status IN ('queued','running','locked')",
        )
        .get(driveId, kind) as Job | null) ?? null
    );
  }

  latestVerify(driveId: string): { ran_at: number; ok: boolean } | null {
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
      ok = JSON.parse(row.result_json)?.verdict === "pass";
    } catch {}
    return { ran_at: row.finished_at, ok };
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

  // ---- benchmarks + ledger ----------------------------------------------------
  addBenchmark(driveId: string, seq: number, rand4k: number): void {
    this.sqlite
      .query(
        "INSERT OR REPLACE INTO benchmarks (drive_id, ran_at, seq_mbps, rand4k_mbps) VALUES (?,?,?,?)",
      )
      .run(driveId, Date.now(), seq, rand4k);
  }

  benchmarks(
    driveId: string,
  ): { ran_at: number; seq_mbps: number; rand4k_mbps: number }[] {
    return this.sqlite
      .query("SELECT * FROM benchmarks WHERE drive_id=? ORDER BY ran_at")
      .all(driveId) as any[];
  }

  ledgerPut(
    driveId: string,
    path: string,
    size: number,
    mtime: number,
    hash: string,
  ): void {
    this.sqlite
      .query(
        `INSERT INTO ledger (drive_id, path, size, mtime, hash, last_ok)
         VALUES (?,?,?,?,?,?) ON CONFLICT(drive_id, path)
         DO UPDATE SET size=excluded.size, mtime=excluded.mtime,
           hash=excluded.hash, last_ok=excluded.last_ok`,
      )
      .run(driveId, path, size, mtime, hash, Date.now());
  }

  ledgerGet(
    driveId: string,
    path: string,
  ): { hash: string; size: number; mtime: number } | null {
    return (
      (this.sqlite
        .query(
          "SELECT hash, size, mtime FROM ledger WHERE drive_id=? AND path=?",
        )
        .get(driveId, path) as any | null) ?? null
    );
  }

  close(): void {
    this.sqlite.close();
  }
}

export function inferRole(volumeName: string): Drive["role"] {
  const n = volumeName.toUpperCase();
  if (n === "DJMASTER") return "master";
  if (n === "DJMIRROR") return "mirror";
  if (n.startsWith("DJ") || n.startsWith("CRATE")) return "library";
  return "unknown";
}
