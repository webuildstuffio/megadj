// jobs.ts — queue with per-drive concurrency 1, progress, logs, cancel,
// and the rekordbox interlock (refuse everything while rekordbox runs).
// Verify-output parsing lives in verify_report.ts (same job family, pure
// functions) — re-exported here for import-path stability.
import { basename } from "node:path";
import type { CrateConfig } from "./config";
import type { DB } from "./db";
import type { Guard } from "./guard";
import type { Job, JobKind, VerifyReport } from "../shared/types";
import { fmtBytes } from "../shared/fmt";
import { benchmarkDrive, checksumLedger } from "./bench";
import { lastLines, parseVerifyReport, verifyDeltas } from "./verify_report";
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
  private reaper: ReturnType<typeof setInterval> | null = null;
  /** last progress touch per job id — lets the reaper tell live from lost */
  private touched = new Map<string, number>();

  constructor(
    private cfg: CrateConfig,
    private db: DB,
    private guard: Guard,
    private emit: Emit,
  ) {
    // Phantom-job reaper: if a 'running' row hasn't been touched in 2 min
    // while no in-process handle owns it, the completion event was lost
    // (crash, full server freeze). Mark it interrupted so the UI and the
    // per-drive dup-check heal automatically.
    this.reaper = setInterval(() => {
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
    }, 30_000);
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

    const handle: RunHandle = { cancelled: false };
    this.running.set(job.drive_id, handle);
    this.db.updateJob(job.id, { status: "running", started_at: Date.now() });
    this.emit("job", this.db.getJob(job.id));

    // Throttled progress pipe: coalesces bursts to ≤4 writes/s and derives a
    // rolling ETA from observed throughput. Keeps SSE + UI live without
    // hammering SQLite.
    let lastWrite = 0;
    let lastCount = 0;
    let lastTime = 0;
    let etaS: number | null = null;
    const tick = (
      done: number,
      total: number,
      message: string,
      phase: string,
      force = false,
    ) => {
      const now = Date.now();
      const p = total > 0 ? Math.min(1, done / total) : 0;
      if (!force && now - lastWrite < 250) return;
      if (lastCount > 0 && now > lastTime) {
        const rate = (done - lastCount) / ((now - lastTime) / 1000);
        if (rate > 0) etaS = Math.round((total - done) / rate);
      }
      lastWrite = now;
      if (lastCount === 0 || now - lastTime > 1000) {
        lastCount = done;
        lastTime = now;
      }
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
    const log = (line: string, isError = false) => {
      const text = line.trim();
      if (!text) return;
      this.markTouched(job.id);
      const p = progressFromLine(text);
      const now = Date.now();
      const isHeading = /^#{1,3} |===|^### /.test(text);
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
      return await this.executeInner(job, mountPoint, handle, tick, log);
    } finally {
      clearInterval(heartbeat);
      this.touched.delete(job.id);
    }
  }

  private async executeInner(
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
    log: (line: string, isError?: boolean) => void,
  ): Promise<unknown> {
    switch (job.kind) {
      case "scan": {
        tick(0, 1, "walking filesystem…", "light-scan", true);
        const light = scanVolume(mountPoint);
        this.db.setSnapshot(job.drive_id, light);
        this.db.event(job.drive_id, "scan", {
          kind: "light",
          files: light.file_count,
        });
        let full = false;
        // honour cancel between phases: no point launching the 10–90s
        // rekordbox snapshot for a job the user already cancelled
        if (handle.cancelled) throw new Error("cancelled");
        // full (rekordbox) scan in same job when a device DB exists
        try {
          tick(0.5, 1, "reading rekordbox database…", "full-scan", true);
          const fullSnap = await rbSnapshot(this.cfg, this.guard, mountPoint);
          // merge: full gives DJ/DB data, light keeps filesystem truth
          this.db.setSnapshot(job.drive_id, {
            ...fullSnap,
            file_count: light.file_count,
            folders: light.folders,
            junk: light.junk,
            total_bytes: light.total_bytes,
            free_bytes: light.free_bytes,
            capacity_bytes: light.capacity_bytes ?? fullSnap.capacity_bytes,
            by_ext: light.by_ext,
            largest: light.largest,
            age: light.age,
            manifest: light.manifest, // fleet §B8 byte truth
          });
          full = true;
          this.db.event(job.drive_id, "scan", {
            kind: "full",
            tracks: fullSnap.track_count,
          });
        } catch (e) {
          if ((e as Error).message.startsWith("REKORDBOX_RUNNING")) throw e;
          // no device DB / parse error: light scan is the answer
        }
        tick(
          1,
          1,
          full ? "scan complete" : "light scan complete",
          "done",
          true,
        );
        return { light: true, full };
      }
      case "verify": {
        const name = basename(mountPoint);
        const startedAt = Date.now();
        tick(
          0,
          1,
          `verifying ${name} — opening rekordbox DB…`,
          "1-databases",
          true,
        );
        const proc = spawnVerify(this.cfg, [name]);
        handle.proc = proc;
        // Phase-driven progress: the script prints deterministic section
        // markers in a known order. Map each to a progress span so the bar
        // + ETA move meaningfully instead of sitting at 0% for 14s.
        //   0.00–0.15 open DBs · 0.15–0.35 hardware view · 0.35–0.80 per-track
        //   0.80–0.95 relations · 0.95–1.00 verdict  (cross-drive phases get
        //   appended as they print: 0.80–0.95 hash parity, then audio spot)
        const PHASES: [RegExp, number, number, string][] = [
          [/^### /, 0.15, 0.35, "checking hardware DB view (export.pdb)…"],
          [/^  tracks:/, 0.35, 0.8, "checking every track: files, grids, BPM…"],
          [/^  playlists:/, 0.8, 0.9, "checking playlists + relations…"],
          [/=== cross-drive ===/, 0.9, 0.95, "comparing master ↔ mirror…"],
          [/^  hashed \d+\//, 0.9, 0.97, "hashing ANLZ files on both drives…"],
          [/audio hash spot-check/, 0.97, 0.99, "spot-hashing audio files…"],
          [/^FINAL:/, 0.99, 1, "writing verdict…"],
        ];
        let phaseIdx = 0;
        const rawLine = (line: string) => {
          const text = line.trim();
          for (let i = phaseIdx; i < PHASES.length; i++) {
            const [re, from, to, msg] = PHASES[i]!;
            if (re.test(text)) {
              phaseIdx = i + 1;
              tick(from, to, msg, `phase-${phaseIdx}`, true);
              break;
            }
          }
        };
        const [verdict, errText] = await Promise.all([
          drain(
            proc,
            (l) => {
              log(l);
              rawLine(l);
            },
            handle,
            this.cfg.verifyTimeoutMin * 60_000,
          ),
          drainText(proc.stderr),
        ]);
        const out = verdict.out + (errText ? `\n[stderr]\n${errText}` : "");
        // usb_verify.py prints `FINAL: ALL PASS` or `FINAL: FAILED: …`;
        // trust that line over the exit code (uv can exit non-zero on
        // warnings) but require the FINAL marker to exist at all.
        const finalLine = verdict.out
          .split("\n")
          .find((l) => l.startsWith("FINAL:"));
        const pass =
          !!finalLine &&
          /FINAL: ALL PASS/.test(finalLine) &&
          proc.exitCode === 0;
        tick(
          1,
          1,
          pass
            ? "verify passed"
            : `verify FAILED — ${finalLine ?? "no FINAL line (crashed?)"}`.slice(
                0,
                200,
              ),
          "done",
          true,
        );
        const report = parseVerifyReport(
          out,
          pass,
          finalLine ?? null,
          Math.round((Date.now() - startedAt) / 1000),
        );
        return {
          verdict: pass ? "pass" : "fail",
          ...report,
        };
      }
      case "mirror": {
        tick(0, 1, "mirroring to mirror drive…", "mirror", true);
        const proc = spawnMirror(this.cfg, []);
        handle.proc = proc;
        const [res, errText] = await Promise.all([
          // mirror gets a hard timeout like verify: a hung uv/python sync
          // must not run forever while the liveness heartbeat hides it
          // from the phantom-job reaper.
          drain(
            proc,
            (l) => log(l),
            handle,
            this.cfg.mirrorTimeoutMin * 60_000,
          ),
          drainText(proc.stderr),
        ]);
        const out = res.out + (errText ? `\n[stderr]\n${errText}` : "");
        tick(1, 1, "mirror finished", "done", true);
        return { summary: lastLines(out, 20) };
      }
      case "benchmark": {
        tick(0, 1, "reading largest files sequentially…", "bench-seq", true);
        if (handle.cancelled) throw new Error("cancelled");
        const r = benchmarkDrive(mountPoint, this.cfg.benchmarkMb);
        // benchmarkDrive is sync I/O (repo-invariant exception for now):
        // at least refuse to PERSIST results for a job cancelled mid-read.
        if (handle.cancelled) throw new Error("cancelled");
        this.db.addBenchmark(job.drive_id, r.seq_mbps, r.rand4k_mbps);
        this.db.event(job.drive_id, "benchmark", {
          seq: r.seq_mbps,
          rand4k: r.rand4k_mbps,
        });
        tick(1, 1, `${r.seq_mbps} MB/s sequential`, "done", true);
        return r;
      }
      case "checksum": {
        const r = await checksumLedger(
          this.db,
          this.guard,
          job.drive_id,
          mountPoint,
          8 * 1024 * 1024 * 1024,
          handle,
          (done, total, bytes) =>
            tick(
              done,
              total,
              `hashing ${done.toLocaleString()}/${total.toLocaleString()} files (${fmtBytes(bytes)})`,
              "checksum",
            ),
        );
        this.db.event(job.drive_id, "checksum", {
          hashed: r.hashed,
          changed: r.changed.length,
        });
        if (r.changed.length) {
          this.db.event(job.drive_id, "bitrot-suspect", {
            paths: r.changed.slice(0, 50),
          });
        }
        tick(
          1,
          1,
          r.changed.length
            ? `${r.changed.length} file(s) changed vs ledger`
            : `${r.hashed.toLocaleString()} files clean`,
          "done",
          true,
        );
        return r;
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.reaper) clearInterval(this.reaper);
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
    let carry = ""; // partial line from the previous chunk
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = carry + dec.decode(value);
      const lines = chunk.split("\n");
      carry = lines.pop() ?? ""; // last element may be incomplete
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
      out += chunk;
      if (handle.cancelled) {
        proc.kill();
        break;
      }
    }
    if (carry.trim()) onLine(carry); // flush the final partial line
  } finally {
    if (timer) clearTimeout(timer);
    await proc.exited;
  }
  return { out };
}

/** Collect a subprocess stream (e.g. stderr) to text without line callbacks. */
async function drainText(
  stream: ReadableStream<Uint8Array> | number | undefined,
): Promise<string> {
  if (!stream || typeof stream === "number") return "";
  try {
    return await new Response(stream).text();
  } catch {
    return "";
  }
}

export { parseVerifyReport, verifyDeltas } from "./verify_report";
