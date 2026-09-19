// jobs.ts — queue with per-drive concurrency 1, progress, logs, cancel,
// and the rekordbox interlock (refuse everything while rekordbox runs).
// Verify-output parsing lives in verify_report.ts (same job family, pure
// functions) — re-exported here for import-path stability.
import type { CrateConfig } from "./config";
import type { DB } from "./db";
import type { Guard } from "./guard";
import type { Job, JobKind, VerifyReport } from "../shared/types";
import { executeJob } from "./jobs/job-execution";
import {
  createEtaEstimator,
  type JobLog,
  type JobTick,
  recordProgressIncrease,
  type RunHandle,
  withJobBudget,
} from "./jobs/job-runtime";
import { progressFromLine, rekordboxRunning } from "./rb";
import { verifyDeltas } from "./verify-report";

export type Emit = (channel: string, data: unknown) => void;

export function ownsRunningJob(
  job: Pick<Job, "id" | "status">,
  handle: RunHandle | undefined,
): handle is RunHandle {
  return job.status === "running" && handle?.jobId === job.id;
}

/** Rolling ETA estimator (pure, clock-injected → testable). Sample window
 *  advances on every call ≥1s after the last sample; rate = items/s over
 *  that window; ETA = remaining / rate. Returns null while unprimed or
 *  when the window observed no movement (honest "unknown", never a stale
 *  guess — the old inline version pinned its baseline to the first sample
 *  so the ETA froze after the first second and flapped as jobs sped up or
 *  slowed down). */
export class JobEngine {
  private running = new Map<string, RunHandle>(); // drive_id -> handle
  private queue: { job: Job; mountPoint: string }[] = [];
  private reaper: ReturnType<typeof setInterval> | null = null;
  /** last progress touch per job id — lets the reaper tell live from lost */
  private touched = new Map<string, number>();
  /** last time a job's progress FRACTION changed — the stall watchdog reads
   *  this, not `touched` (log lines keep `touched` fresh even when nothing
   *  actually moves, which is exactly the wedge we must catch). */
  private progressAt = new Map<string, number>();

  private cfg: CrateConfig;
  private db: DB;
  private guard: Guard;
  private emit: Emit;

  constructor(cfg: CrateConfig, db: DB, guard: Guard, emit: Emit) {
    this.cfg = cfg;
    this.db = db;
    this.guard = guard;
    this.emit = emit;
    this.reaper = setInterval(() => this.reapWatchdogs(), 30_000);
  }

  /** Reaper tick = two independent watchdogs: (1) phantom-job reaper — a
   *  'running' row untouched for 2 min while no in-process handle owns it
   *  lost its completion event (crash, full server freeze); mark it
   *  interrupted so the UI and the per-drive dup-check heal automatically.
   *  (2) stall watchdog — a LIVE job whose progress fraction hasn't moved
   *  for cfg.stallTimeoutMin is wedged (hung subprocess stdout, dead NFS
   *  mount, deadlock); its own 5s liveness heartbeat hides it from the
   *  reaper above forever, and the UI spins on it forever. Kill it so the
   *  normal catch path records a terminal state. */
  private reapWatchdogs(): void {
    this.reapPhantoms();
    this.killStalled();
  }

  private reapPhantoms(): void {
    const cutoff = Date.now() - 120_000;
    for (const [id, at] of this.touched) {
      if (at < cutoff) this.touched.delete(id);
    }
    const orphans = this.db
      .activeJobs()
      .filter((j) => j.started_at && j.started_at < cutoff - 60_000)
      .filter((j) => !this.running.has(j.drive_id))
      .filter((j) => (this.touched.get(j.id) ?? 0) < cutoff);
    for (const j of orphans) {
      this.db.updateJob(j.id, {
        status: "interrupted",
        error: "job lost — completion event never delivered",
        finished_at: Date.now(),
      });
      this.emit("job", this.db.getJob(j.id));
    }
    if (orphans.length)
      console.log(`cratedeck: reaped ${orphans.length} phantom job(s)`);
  }

  private killStalled(): void {
    const stallCutoff = Date.now() - this.cfg.stallTimeoutMin * 60_000;
    for (const handle of this.running.values()) {
      const job = handle.jobId ? this.db.getJob(handle.jobId) : null;
      if (!job || job.status !== "running") continue;
      const lastMove = Math.max(
        this.progressAt.get(job.id) ?? 0,
        job.started_at ?? 0,
      );
      if (lastMove > 0 && lastMove < stallCutoff && !handle.cancelled) {
        console.log(
          `cratedeck: job ${job.id.slice(0, 8)} (${job.kind}) stalled ` +
            `${Math.round((Date.now() - lastMove) / 60_000)}m without progress — cancelling`,
        );
        // visible trail: the unwind path keeps this error unless the
        // throw carries a more specific one
        this.db.updateJob(job.id, {
          error: `stalled — no progress for ${this.cfg.stallTimeoutMin} min; auto-cancelled`,
        });
        handle.cancelled = true;
        handle.proc?.kill();
      }
    }
  }

  /** Stop background work (SIGINT path). */
  markTouched(jobId: string): void {
    this.touched.set(jobId, Date.now());
  }

  interlock(): { running: boolean; pid: number | null } {
    return rekordboxRunning();
  }

  /** Interlock verdict straight from pgrep, bypassing the 1s TTL cache.
   *  Safety gates (job start, snapshot start) must use this. */
  interlockFresh(): { running: boolean; pid: number | null } {
    return rekordboxRunning({ fresh: true });
  }

  private assertInterlock(): void {
    const lock = this.interlockFresh();
    if (lock.running) {
      throw new Error(`REKORDBOX_RUNNING (pid ${lock.pid}) — all jobs locked`);
    }
  }

  /** Who asked for this job — O87 attribution. "mcp:<session>" for agent
   *  calls, "web", "deckctl", "auto" (auto-scheduler). Rendered in the
   *  timeline + jobs list so "why did this verify run at 3am" is answerable.
   *  Optional column: pre-migration rows read as "web" (the UI default). */
  enqueue(
    driveId: string,
    kind: JobKind,
    mountPoint: string,
    origin = "web",
  ): Job {
    this.assertInterlock();
    const dup = this.db.activeJobOfKind(driveId, kind);
    if (dup) return dup;
    const job: Job = {
      id: crypto.randomUUID(),
      drive_id: driveId,
      kind,
      status: "queued",
      progress: 0,
      message: null,
      phase: null,
      eta_seconds: null,
      error: null,
      result_json: null,
      log_path: null,
      created_at: Date.now(),
      started_at: null,
      finished_at: null,
    };
    this.db.insertJob(job, origin);
    this.db.event(driveId, "job-queued", {
      kind,
      job_id: job.id,
      origin,
    });
    this.queue.push({ job, mountPoint });
    this.emit("job", job);
    this.pump();
    return job;
  }

  cancel(jobId: string): boolean {
    const job = this.db.getJob(jobId);
    if (!job) return false;
    const h = this.running.get(job.drive_id);
    if (ownsRunningJob(job, h)) {
      h.cancelled = true;
      h.proc?.kill();
      return true;
    }
    const qi = this.queue.findIndex((q) => q.job.id === jobId);
    if (qi !== -1) {
      this.queue.splice(qi, 1);
      this.db.updateJob(jobId, {
        status: "cancelled",
        finished_at: Date.now(),
      });
      this.emit("job", this.db.getJob(jobId));
      return true;
    }
    return false;
  }

  private pump(): void {
    // per-drive concurrency 1: skip if that drive already has a running job
    const runningDrives = new Set(this.running.keys());
    const next = this.queue.find((q) => !runningDrives.has(q.job.drive_id));
    if (!next) return;
    this.queue = this.queue.filter((q) => q !== next);
    this.run(next.job, next.mountPoint).finally(() => this.pump());
  }

  private async run(job: Job, mountPoint: string): Promise<void> {
    try {
      this.assertInterlock();
    } catch (e) {
      // transient: rekordbox appeared between enqueue and start. Not a
      // terminal state — release it so a later retry isn't deadlocked by
      // activeJobOfKind() counting 'locked' as active forever.
      this.db.updateJob(job.id, {
        status: "failed",
        error: (e as Error).message,
        finished_at: Date.now(),
      });
      this.emit("job", this.db.getJob(job.id));
      return;
    }

    const handle: RunHandle = { cancelled: false, jobId: job.id };
    this.running.set(job.drive_id, handle);
    this.db.updateJob(job.id, { status: "running", started_at: Date.now() });
    this.emit("job", this.db.getJob(job.id));

    // Throttled progress pipe: coalesces bursts to ≤4 writes/s and derives a
    // rolling ETA from observed throughput. Keeps SSE + UI live without
    // hammering SQLite.
    let lastWrite = 0;
    const eta = createEtaEstimator();
    const tick = (
      done: number,
      total: number,
      message: string,
      phase: string,
      force = false,
    ) => {
      const now = Date.now();
      const p = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
      // remember when the fraction last INCREASED — feeds the stall
      // watchdog (equal p on every tick = not moving, exactly the wedge).
      recordProgressIncrease(this.progressAt, job.id, p, now, phase);
      if (!force && now - lastWrite < 250) return;
      lastWrite = now;
      const etaS = eta(done, total, now);
      this.db.setJobProgress(job.id, {
        progress: p,
        message,
        phase,
        eta_seconds: etaS,
      });
      this.emit("job", this.db.getJob(job.id));
    };

    try {
      const result = await this.execute(job, mountPoint, handle, tick);
      // Verify runs persist their granular report on the drive itself, so the
      // UI/CLI can show the latest breakdown without walking job history.
      // Deltas vs the previous stored run make trends visible ("2 NEW broken
      // grids since last verify") without the user diffing by hand.
      if (job.kind === "verify" && result && !handle.cancelled) {
        const r = result as Partial<VerifyReport> & { verdict?: string };
        if (r.checks) {
          const prev = this.db.getVerifyReport(job.drive_id);
          const withDeltas: VerifyReport = {
            ...(r as VerifyReport),
            deltas: verifyDeltas(prev, r as VerifyReport),
            prev_ran_at: prev?.ran_at ?? null,
          };
          this.db.setVerifyReport(job.drive_id, withDeltas);
        }
      }
      this.db.updateJob(job.id, {
        status: handle.cancelled ? "cancelled" : "done",
        // cancelled jobs keep their real last progress — forcing 1 drew a
        // full green bar over a job that never finished (a lie the dock
        // then had to contradict with the status chip).
        ...(handle.cancelled ? {} : { progress: 1 }),
        finished_at: Date.now(),
        result_json: JSON.stringify(result ?? null),
      });
      this.db.event(job.drive_id, "job-done", {
        kind: job.kind,
        origin: job.origin,
        result,
      });
    } catch (e) {
      const msg = (e as Error).message;
      // A watchdog pre-stamps its reason (stall/budget) via updateJob; the
      // unwind error here is usually the generic "cancelled" — don't let it
      // wipe the useful trail.
      const cur = this.db.getJob(job.id);
      const error =
        handle.cancelled && cur?.error && !cur.error.startsWith("cancel")
          ? cur.error
          : msg;
      this.db.updateJob(job.id, {
        status: handle.cancelled ? "cancelled" : "failed",
        error,
        finished_at: Date.now(),
      });
      this.db.event(job.drive_id, "job-failed", {
        kind: job.kind,
        origin: job.origin,
        error,
      });
    } finally {
      this.running.delete(job.drive_id);
      for (const key of this.progressAt.keys()) {
        if (key.startsWith(`${job.id}:p:`)) this.progressAt.delete(key);
      }
      this.progressAt.delete(job.id);
      this.emit("job", this.db.getJob(job.id));
    }
  }

  private async execute(
    job: Job,
    mountPoint: string,
    handle: RunHandle,
    tick: (
      done: number,
      total: number,
      message: string,
      phase: string,
      force?: boolean,
    ) => void,
  ): Promise<unknown> {
    // Live liveness tracking: touch on start + every 5s so the phantom-job
    // reaper can distinguish "running" from "lost". Verify/mirror log lines
    // ALSO update the job message live (throttled) — the dock shows exactly
    // what the script is printing, when it prints it.
    this.markTouched(job.id);
    const heartbeat = setInterval(() => this.markTouched(job.id), 5_000);
    let lastMsg = 0;
    let progressStage = 0;
    const log = (line: string, isError = false) => {
      const text = line.trim();
      if (!text) return;
      this.markTouched(job.id);
      const p = progressFromLine(text);
      const now = Date.now();
      const isHeading = /^#{1,3} |===|^### /.test(text);
      if (isHeading) progressStage++;
      // Parsed progress is a real fraction signal. Ordinary log activity must
      // never refresh the stall clock: a wedged subprocess may keep logging.
      recordProgressIncrease(
        this.progressAt,
        job.id,
        p,
        now,
        `log-${progressStage}`,
      );
      if (p !== null || isHeading || now - lastMsg > 400) {
        lastMsg = now;
        this.db.setJobProgress(job.id, {
          ...(p !== null ? { progress: p } : {}),
          message: (isError ? "⚠ " : "") + text.slice(0, 120),
        });
        this.emit("job", this.db.getJob(job.id));
      }
    };
    try {
      return await withJobBudget(
        this.executeInner(job, mountPoint, handle, tick, log),
        handle,
        this.cfg.jobTimeoutMin,
      );
    } finally {
      clearInterval(heartbeat);
      this.touched.delete(job.id);
    }
  }

  private executeInner(
    job: Job,
    mountPoint: string,
    handle: RunHandle,
    tick: JobTick,
    log: JobLog,
  ): Promise<unknown> {
    return executeJob({
      deps: { cfg: this.cfg, db: this.db, guard: this.guard },
      job,
      mountPoint,
      handle,
      tick,
      log,
    });
  }

  async shutdown(): Promise<void> {
    if (this.reaper) clearInterval(this.reaper);
    for (const h of this.running.values()) h.proc?.kill();
  }
}

export { createEtaEstimator, drain, verifyPhase } from "./jobs/job-runtime";

export { sanitizeVerifyReport, verifyDeltas } from "./verify-report";
export { parseVerifyReport } from "./verify-parse";
