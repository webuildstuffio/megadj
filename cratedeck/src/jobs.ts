// jobs.ts — queue with per-drive concurrency 1, progress, logs, cancel,
// and the rekordbox interlock (refuse everything while rekordbox runs).
import { basename } from "node:path";
import type { CrateConfig } from "./config";
import type { DB } from "./db";
import type { Guard } from "./guard";
import type { Job, JobKind } from "../shared/types";
import { benchmarkDrive, checksumLedger } from "./bench";
import {
  progressFromLine,
  rbSnapshot,
  rekordboxRunning,
  spawnMirror,
  spawnVerify,
} from "./rb";
import { scanVolume } from "./scan";

export type Emit = (channel: string, data: unknown) => void;

interface RunHandle {
  proc?: Bun.Subprocess;
  cancelled: boolean;
  resolve?: () => void;
}

export class JobEngine {
  private running = new Map<string, RunHandle>(); // drive_id -> handle
  private queue: { job: Job; mountPoint: string }[] = [];

  constructor(
    private cfg: CrateConfig,
    private db: DB,
    private guard: Guard,
    private emit: Emit,
  ) {}

  interlock(): { running: boolean; pid: number | null } {
    return rekordboxRunning();
  }

  private assertInterlock(): void {
    const lock = this.interlock();
    if (lock.running) {
      throw new Error(`REKORDBOX_RUNNING (pid ${lock.pid}) — all jobs locked`);
    }
  }

  enqueue(driveId: string, kind: JobKind, mountPoint: string): Job {
    this.assertInterlock();
    const dup = this.db.activeJobOfKind(driveId, kind);
    if (dup) return dup;
    const job: Job = {
      id: crypto.randomUUID(),
      drive_id: driveId,
      kind,
      status: "queued",
      progress: 0,
      error: null,
      result_json: null,
      log_path: null,
      created_at: Date.now(),
      started_at: null,
      finished_at: null,
    };
    this.db.insertJob(job);
    this.db.event(driveId, "job-queued", { kind, job_id: job.id });
    this.queue.push({ job, mountPoint });
    this.emit("job", job);
    this.pump();
    return job;
  }

  cancel(jobId: string): boolean {
    const job = this.db.getJob(jobId);
    if (!job) return false;
    const h = this.running.get(job.drive_id);
    if (h && job.status === "running") {
      h.cancelled = true;
      h.proc?.kill();
      return true;
    }
    const qi = this.queue.findIndex((q) => q.job.id === jobId);
    if (qi >= 0) {
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
      this.db.updateJob(job.id, {
        status: "locked",
        error: (e as Error).message,
      });
      this.emit("job", this.db.getJob(job.id));
      return;
    }

    const handle: RunHandle = { cancelled: false };
    this.running.set(job.drive_id, handle);
    this.db.updateJob(job.id, { status: "running", started_at: Date.now() });
    this.emit("job", this.db.getJob(job.id));

    try {
      const result = await this.execute(job, mountPoint, handle);
      this.db.updateJob(job.id, {
        status: handle.cancelled ? "cancelled" : "done",
        progress: 1,
        finished_at: Date.now(),
        result_json: JSON.stringify(result ?? null),
      });
      this.db.event(job.drive_id, "job-done", { kind: job.kind, result });
    } catch (e) {
      const msg = (e as Error).message;
      this.db.updateJob(job.id, {
        status: handle.cancelled ? "cancelled" : "failed",
        error: msg,
        finished_at: Date.now(),
      });
      this.db.event(job.drive_id, "job-failed", { kind: job.kind, error: msg });
    } finally {
      this.running.delete(job.drive_id);
      this.emit("job", this.db.getJob(job.id));
    }
  }

  private async execute(
    job: Job,
    mountPoint: string,
    handle: RunHandle,
  ): Promise<unknown> {
    const log = (line: string) => {
      // lightweight progress: parse percent-style lines
      const p = progressFromLine(line);
      if (p !== null) {
        this.db.updateJob(job.id, { progress: p });
        this.emit("job", this.db.getJob(job.id));
      }
    };

    switch (job.kind) {
      case "scan": {
        const light = scanVolume(mountPoint);
        this.db.setSnapshot(job.drive_id, light);
        this.db.event(job.drive_id, "scan", {
          kind: "light",
          files: light.file_count,
        });
        // full (rekordbox) scan in same job when a device DB exists
        try {
          const full = rbSnapshot(this.cfg, this.guard, mountPoint);
          this.db.setSnapshot(job.drive_id, {
            ...full,
            file_count: light.file_count,
            folders: light.folders,
            junk: light.junk,
            total_bytes: light.total_bytes,
          });
          this.db.event(job.drive_id, "scan", {
            kind: "full",
            tracks: full.track_count,
          });
        } catch (e) {
          if ((e as Error).message.startsWith("REKORDBOX_RUNNING")) throw e;
          // no device DB / parse error: light scan is the answer
        }
        return { light: true, full: true };
      }
      case "verify": {
        const name = basename(mountPoint);
        const proc = spawnVerify(this.cfg, [name]);
        handle.proc = proc;
        const verdict = await drain(
          proc,
          log,
          handle,
          this.cfg.verifyTimeoutMin * 60_000,
        );
        const pass =
          /ALL PASS|all data checks PASS/i.test(verdict.out) &&
          proc.exitCode === 0;
        return {
          verdict: pass ? "pass" : "fail",
          summary: lastLines(verdict.out, 20),
        };
      }
      case "mirror": {
        const proc = spawnMirror(this.cfg, []);
        handle.proc = proc;
        const res = await drain(proc, log, handle);
        return { summary: lastLines(res.out, 20) };
      }
      case "benchmark": {
        const r = benchmarkDrive(mountPoint, this.cfg.benchmarkMb);
        this.db.addBenchmark(job.drive_id, r.seq_mbps, r.rand4k_mbps);
        this.db.event(job.drive_id, "benchmark", {
          seq: r.seq_mbps,
          rand4k: r.rand4k_mbps,
        });
        return r;
      }
      case "checksum": {
        const r = checksumLedger(this.db, this.guard, job.drive_id, mountPoint);
        this.db.event(job.drive_id, "checksum", {
          hashed: r.hashed,
          changed: r.changed.length,
        });
        if (r.changed.length) {
          this.db.event(job.drive_id, "bitrot-suspect", {
            paths: r.changed.slice(0, 50),
          });
        }
        return r;
      }
    }
  }

  async shutdown(): Promise<void> {
    for (const h of this.running.values()) h.proc?.kill();
  }
}

async function drain(
  proc: Bun.Subprocess,
  onLine: (l: string) => void,
  handle: RunHandle,
  timeoutMs = 0,
): Promise<{ out: string }> {
  let out = "";
  const stdout = proc.stdout;
  if (!stdout || typeof stdout === "number") {
    await proc.exited;
    return { out };
  }
  const reader = stdout.getReader();
  const timer = timeoutMs
    ? setTimeout(() => {
        handle.cancelled = true;
        proc.kill();
      }, timeoutMs)
    : null;
  try {
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value);
      out += chunk;
      for (const line of chunk.split("\n")) {
        if (line.trim()) onLine(line);
      }
      if (handle.cancelled) {
        proc.kill();
        break;
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
    await proc.exited;
  }
  return { out };
}

function lastLines(text: string, n: number): string {
  return text.split("\n").filter(Boolean).slice(-n).join("\n");
}
