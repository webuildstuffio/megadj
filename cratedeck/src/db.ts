// db.ts — bun:sqlite, schema, migrations, and every query (one place).
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
} from "../shared/types";
import { FleetStore } from "./fleet-db";
import type { TrackRow, PlaylistEntryRow, ManifestRow } from "./fleet";

/** Raw row shape as stored in the drives table (mounted is 0/1). */
interface DriveRow extends Omit<Drive, "mounted"> {
  mounted: number;
}

/** Raw row shape as stored in the events table. */
interface EventRow {
  id: string;
  drive_id: string;
  at: number;
  kind: string;
  data_json: string | null;
}

/** Snapshot history is capped so years of scans can't eat the host disk. */
const MAX_SNAPSHOTS_PER_DRIVE = 20;
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
`;

/** Stable stringify: key-sorted at EVERY depth, arrays kept in order, every
 *  key included. Used by the setSnapshot change-detector, which must SEE
 *  nested edits. The old `JSON.stringify(o, Object.keys(o).sort())` passed
 *  the top-level key list as the replacer — replacer arrays filter keys at
 *  ALL levels, so nested objects stringified as {} and any same-length
 *  nested change (track title/BPM edit, playlist membership swap) read as
 *  "unchanged" and was silently dropped (stale fleet tables + parity). */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    return `{${entries
      .map(([k, val]) => `${JSON.stringify(k)}:${canon(val)}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export class DB {
  readonly sqlite: Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.sqlite = new Database(dbPath);
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
    // WAL + NORMAL is the SQLite-recommended combo: durable across app
    // crashes, skips fsync-on-every-commit (huge write-churn cut).
    this.sqlite.exec("PRAGMA synchronous = NORMAL;");
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
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
    // disk-burn guard: cap per-drive snapshot history (each full snapshot can
    // be ~MBs of JSON; unbounded growth would eat the host disk over months)
    this.pruneSnapshots();
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

  /** Keep the newest MAX_SNAPSHOTS_PER_DRIVE snapshots per drive. */
  private pruneSnapshots(max = MAX_SNAPSHOTS_PER_DRIVE): void {
    this.sqlite
      .query(
        `DELETE FROM snapshots WHERE drive_id IN (
           SELECT DISTINCT drive_id FROM snapshots
         ) AND taken_at NOT IN (
           SELECT taken_at FROM snapshots s2
           WHERE s2.drive_id = snapshots.drive_id
           ORDER BY taken_at DESC LIMIT ?
         )`,
      )
      .run(max);
  }

  /** Called after each setSnapshot so history never grows unbounded. */
  private pruneSnapshotsFor(
    driveId: string,
    max = MAX_SNAPSHOTS_PER_DRIVE,
  ): void {
    this.sqlite
      .query(
        `DELETE FROM snapshots WHERE drive_id=? AND taken_at NOT IN (
           SELECT taken_at FROM snapshots WHERE drive_id=?
           ORDER BY taken_at DESC LIMIT ?
         )`,
      )
      .run(driveId, driveId, max);
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

  // ---- fleet tables (ideas.md §B6/B7/B8) ------------------------------------
  // Persistence lives in fleet-db.ts (FleetStore); db.ts delegates. Rows are
  // refreshed wholesale by setSnapshot on every scan; the pure queries in
  // fleet.ts read them via the accessors below. Lazy init: field
  // initializers run before the constructor body assigns this.sqlite.
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

  // ---- drives -------------------------------------------------------------
  private normDrive(d: DriveRow): Drive {
    return { ...d, mounted: !!d.mounted };
  }

  /** The configured master drive (role tag or exact name), else null. */
  masterDrive(): Drive | null {
    return this.allDrives().find((d) => d.role === "master") ?? null;
  }

  getDrive(id: string): Drive | null {
    const r = this.sqlite
      .query("SELECT * FROM drives WHERE id = ?")
      .get(id) as DriveRow | null;
    return r ? this.normDrive(r) : null;
  }

  getDriveByUuid(uuid: string): Drive | null {
    const r = this.sqlite
      .query("SELECT * FROM drives WHERE volume_uuid = ?")
      .get(uuid) as DriveRow | null;
    return r ? this.normDrive(r) : null;
  }

  allDrives(): Drive[] {
    return (
      this.sqlite
        .query(
          "SELECT * FROM drives ORDER BY mounted DESC, nickname IS NULL, name",
        )
        .all() as DriveRow[]
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
          d.name ?? "",
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

  /** Persist the latest verify report for a drive (or clear with null). */
  setVerifyReport(id: string, report: VerifyReport | null): void {
    this.sqlite
      .query("UPDATE drives SET verify_report_json=? WHERE id=?")
      .run(report ? JSON.stringify(report) : null, id);
  }

  getVerifyReport(id: string): VerifyReport | null {
    const r = this.sqlite
      .query<
        { verify_report_json: string | null },
        [string]
      >("SELECT verify_report_json FROM drives WHERE id=?")
      .get(id);
    if (!r?.verify_report_json) return null;
    try {
      return JSON.parse(r.verify_report_json) as VerifyReport;
    } catch {
      return null;
    }
  }

  /** Increment at mount time (ghost → mounted flip). Called by registry. */
  bumpPlugCount(id: string): void {
    this.sqlite
      .query("UPDATE drives SET plug_count = plug_count + 1 WHERE id=?")
      .run(id);
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
    // Skip the write entirely when nothing changed apart from the timestamp:
    // every scan stamps `taken_at`, so a naive JSON compare never fired and a
    // re-scan of a stable drive rewrote ~MBs of identical JSON. Key-sorted
    // stringify keeps the comparison key-order-insensitive.
    const cur = this.getDrive(id);
    if (cur?.last_snapshot_json) {
      try {
        const prev = JSON.parse(cur.last_snapshot_json) as SnapshotData;
        const strip = (s: SnapshotData): Record<string, unknown> => {
          const { taken_at: _takenAt, ...rest } = s;
          return rest;
        };
        // canon() must recurse (see its doc): nested-only edits are real
        // library changes and must invalidate the dedupe.
        if (canon(strip(prev)) === canon(strip(snap))) return;
      } catch {
        // unparsable previous blob — fall through and write
      }
    }
    const json = JSON.stringify(snap);
    this.sqlite
      .query("UPDATE drives SET last_snapshot_json=? WHERE id=?")
      .run(json, id);
    this.sqlite
      .query(
        "INSERT OR REPLACE INTO snapshots (drive_id, taken_at, kind, data_json) VALUES (?,?,?,?)",
      )
      .run(id, snap.taken_at, snap.kind, json);
    // fleet tables ride along: per-track inventory + playlist entries +
    // manifest refresh wholesale on every persisted scan (§B6/B7/B8 input)
    this.fleet.sync(id, snap);
    this.pruneSnapshotsFor(id); // disk-burn guard
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
  private eventStmt?: ReturnType<Database["prepare"]>;
  private eventPruneStmt?: ReturnType<Database["prepare"]>;
  event(
    driveId: string,
    kind: string,
    data: Record<string, unknown> = {},
  ): void {
    // prepared-once + transactional batching: timeline writes happen in
    // bursts (jobs, reconcile), WAL commit overhead dominates otherwise
    this.eventStmt ??= this.sqlite.prepare(
      "INSERT INTO events (id, drive_id, at, kind, data_json) VALUES (?,?,?,?,?)",
    );
    this.sqlite.transaction(() =>
      this.eventStmt!.run(
        crypto.randomUUID(),
        driveId,
        Date.now(),
        kind,
        JSON.stringify(data),
      ),
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
  }

  timeline(driveId: string, limit = 200): TimelineEvent[] {
    return (
      this.sqlite
        .query("SELECT * FROM events WHERE drive_id=? ORDER BY at DESC LIMIT ?")
        .all(driveId, limit) as EventRow[]
    ).map(eventRow);
  }

  recentEvents(limit = 50): TimelineEvent[] {
    return (
      this.sqlite
        .query("SELECT * FROM events ORDER BY at DESC LIMIT ?")
        .all(limit) as EventRow[]
    ).map(eventRow);
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

  /** Fine-grained progress update: fraction, human message, phase, ETA (s). */
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
           eta_seconds=?
         WHERE id=?`,
      )
      .run(
        p.progress ?? null,
        p.message ?? null,
        p.phase ?? null,
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
      .all(driveId) as {
      ran_at: number;
      seq_mbps: number;
      rand4k_mbps: number;
    }[];
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
        .get(driveId, path) as {
        hash: string;
        size: number;
        mtime: number;
      } | null) ?? null
    );
  }

  ledgerCount(driveId: string): number {
    const r = this.sqlite
      .query("SELECT COUNT(*) AS n FROM ledger WHERE drive_id=?")
      .get(driveId) as { n: number } | null;
    return r?.n ?? 0;
  }

  /** Days since the newest ledger entry (how fresh corruption tracking is). */
  ledgerAgeDays(driveId: string): number | null {
    const r = this.sqlite
      .query("SELECT MAX(last_ok) AS t FROM ledger WHERE drive_id=?")
      .get(driveId) as { t: number | null } | null;
    return r?.t ? (Date.now() - r.t) / 86_400_000 : null;
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
