import type { Database } from "bun:sqlite";
import type { Job, JobKind, TimelineEvent } from "../shared/types";
import { MAX_EVENTS_PER_DRIVE } from "./db_core";
import { DBLibrary } from "./db_library";
import { errMessage } from "../../src/shared/leaf/fmt";

interface EventRow {
  id: string;
  drive_id: string;
  at: number;
  kind: string;
  data_json: string | null;
}

function eventRow(row: EventRow): TimelineEvent {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data_json ?? "{}") as Record<string, unknown>;
  } catch (error) {
    console.error(`timeline event ${row.id} has corrupt data_json`, error);
    data = { corrupt: true, raw: row.data_json ?? null };
  }
  return {
    id: row.id,
    drive_id: row.drive_id,
    at: row.at,
    kind: row.kind,
    data,
  };
}

/** Timeline and job persistence layered over library state. */
export class DBActivity extends DBLibrary {
  private eventStmt?: ReturnType<Database["prepare"]>;
  private eventPruneStmt?: ReturnType<Database["prepare"]>;

  event(
    driveId: string,
    kind: string,
    data: Record<string, unknown> = {},
  ): string {
    this.eventStmt ??= this.sqlite.prepare(
      "INSERT INTO events (id, drive_id, at, kind, data_json) VALUES (?,?,?,?,?)",
    );
    const id = crypto.randomUUID();
    this.sqlite.transaction(() =>
      this.eventStmt!.run(id, driveId, Date.now(), kind, JSON.stringify(data)),
    )();
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

  insertJob(job: Job, origin = "web"): void {
    this.sqlite
      .query(
        `INSERT INTO jobs (id, drive_id, kind, status, progress, error, result_json,
           log_path, created_at, started_at, finished_at, origin)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        job.id,
        job.drive_id,
        job.kind,
        job.status,
        job.progress,
        job.error,
        job.result_json,
        job.log_path,
        job.created_at,
        job.started_at,
        job.finished_at,
        origin,
      );
  }

  updateJob(id: string, patch: Partial<Job>): void {
    const current = this.getJob(id);
    if (!current) return;
    const job = { ...current, ...patch };
    this.sqlite
      .query(
        `UPDATE jobs SET status=?, progress=?, error=?, result_json=?,
           started_at=?, finished_at=?, message=?, phase=?, eta_seconds=?
         WHERE id=?`,
      )
      .run(
        job.status,
        job.progress,
        job.error,
        job.result_json,
        job.started_at,
        job.finished_at,
        job.message ?? null,
        job.phase ?? null,
        job.eta_seconds ?? null,
        id,
      );
  }

  setJobProgress(
    id: string,
    progress: {
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
        progress.progress ?? null,
        progress.message ?? null,
        progress.phase ?? null,
        progress.eta_seconds === undefined ? 0 : 1,
        progress.eta_seconds === undefined ? null : progress.eta_seconds,
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

  reapStaleRunning(staleMs: number): number {
    const cutoff = Date.now() - staleMs;
    const result = this.sqlite
      .query(
        `UPDATE jobs SET status='interrupted', finished_at=?, error=COALESCE(error,'job lost — server restarted or event stream dropped')
         WHERE status IN ('queued','running') AND id IN (
           SELECT id FROM jobs WHERE status IN ('queued','running') AND started_at IS NOT NULL AND started_at < ?
         )`,
      )
      .run(Date.now(), cutoff);
    return result.changes;
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
    const report = this.getVerifyReport(driveId);
    if (report) return { ran_at: report.ran_at, ok: report.ok };
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
    } catch (error) {
      console.error(
        `verify result for ${driveId} has corrupt result_json`,
        error,
      );
    }
    return { ran_at: row.finished_at, ok };
  }

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
      const count = Array.isArray(changed) ? changed.length : undefined;
      return typeof count === "number"
        ? { ran_at: row.finished_at, changed: count }
        : null;
    } catch (error) {
      console.error(
        `checksum result for ${driveId} has corrupt result_json`,
        errMessage(error),
      );
      return null;
    }
  }

  reapOrphanJobs(): number {
    const result = this.sqlite
      .query(
        `UPDATE jobs SET status='interrupted', finished_at=?
         WHERE status IN ('queued','running','locked')`,
      )
      .run(Date.now());
    return result.changes;
  }
}
