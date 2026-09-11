// jobs.ts — queue with per-drive concurrency 1, progress, logs, cancel,
// and the rekordbox interlock (refuse everything while rekordbox runs).
// Verify-output parsing lives in verify_report.ts (same job family, pure
// functions) — re-exported here for import-path stability.
import { basename } from "node:path";
import type { CrateConfig } from "./config";
import type { DB } from "./db";
import type { Guard } from "./guard";
import type { Job, JobKind, VerifyReport } from "../shared/types";
import type { FixesPayload } from "../shared/fixes";

/** Map a megadj booth-fix --json summary onto the /api/fixes wire shape. */
function toPayload(
  summary: Record<string, unknown>,
  scannedPath: string,
): FixesPayload {
  return {
    fleet: (summary.fleet as string[]) ?? [],
    checked: Number(summary.checked ?? 0),
    fixable: Number(summary.fixable ?? 0),
    applied: Number(summary.applied ?? 0),
    rows: (summary.rows as FixesPayload["rows"]) ?? [],
    scannedPath,
  };
}
import { fmtBytes } from "../shared/fmt";
import { benchmarkDrive, checksumLedger, speedProbe } from "./bench";
import { lastLines, parseVerifyReport, verifyDeltas } from "./verify_report";
import {
  progressFromLine,
  rbSnapshot,
  rekordboxRunning,
  spawnMirror,
  spawnVerify,
} from "./rb";
import { scanVolume } from "./scan";
import {
  intakeArgs,
  intakePhaseFor,
  megadjCliPath,
  splitIntakeStdout,
  INTAKE_FILE_LINE,
  INTAKE_PHASES,
} from "./intake_run";
import type { IntakeResult } from "../shared/types";

export type Emit = (channel: string, data: unknown) => void;

/** Rolling ETA estimator (pure, clock-injected → testable). Sample window
 *  advances on every call ≥1s after the last sample; rate = items/s over
 *  that window; ETA = remaining / rate. Returns null while unprimed or
 *  when the window observed no movement (honest "unknown", never a stale
 *  guess — the old inline version pinned its baseline to the first sample
 *  so the ETA froze after the first second and flapped as jobs sped up or
 *  slowed down). */
export function createEtaEstimator(): (
  done: number,
  total: number,
  now: number,
) => number | null {
  let lastCount = 0;
  let lastTime = -1;
  let etaS: number | null = null;
  return (done, total, now) => {
    if (lastTime < 0) {
      // first call: prime the window, no rate yet
      lastCount = done;
      lastTime = now;
      return null;
    }
    if (now - lastTime >= 1_000) {
      const rate = (done - lastCount) / ((now - lastTime) / 1000);
      etaS = rate > 0 ? Math.max(0, Math.round((total - done) / rate)) : null;
      lastCount = done;
      lastTime = now;
    }
    return etaS;
  };
}

interface RunHandle {
  proc?: Bun.Subprocess;
  cancelled: boolean;
  /** the running job's id — lets the reaper's stall watchdog find the row */
  jobId?: string;
  resolve?: () => void;
}

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

      // Stall watchdog: a LIVE job whose progress hasn't moved for
      // cfg.stallTimeoutMin is wedged (hung subprocess stdout, dead NFS
      // mount, deadlock) — its own 5s liveness heartbeat hides it from the
      // reaper above forever, and the UI spins on it forever. Kill it so
      // the normal catch path records a terminal state.
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
      const prevP = this.progressAt.get(`${job.id}:p`);
      if (prevP === undefined || p > prevP) {
        this.progressAt.set(`${job.id}:p`, p);
        this.progressAt.set(job.id, now);
      }
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
      this.progressAt.delete(`${job.id}:p`);
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
    const log = (line: string, isError = false) => {
      const text = line.trim();
      if (!text) return;
      this.markTouched(job.id);
      const p = progressFromLine(text);
      const now = Date.now();
      const isHeading = /^#{1,3} |===|^### /.test(text);
      // stdout progress = life: a subprocess leg (verify/mirror) can sit on
      // one phase for 20+ real minutes of copying/hashing, and a HEALTHY
      // run keeps printing. A wedged one stops. Feeding the stall watchdog
      // from log output (not just fraction movement) keeps it from
      // false-killing a slow mirror mid-copy.
      if (!isHeading) this.progressAt.set(job.id, now);
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
      // Hard wall-clock budget for the whole job (default 120m, config
      // override [jobs] job_timeout_min). Verify/mirror already carry their
      // own shorter spawn timeouts; benchmark/checksum/scan had NONE — a
      // wedged read spun forever, and the liveness heartbeat below actively
      // hid it from the phantom reaper. Budget expiry cancels the handle
      // (the normal cancellation paths honor it) and throws a clear error.
      let budget: ReturnType<typeof setTimeout> | null = null;
      const budgetMs = this.cfg.jobTimeoutMin * 60_000;
      const budgetHit = new Promise<never>((_, reject) => {
        budget = setTimeout(() => {
          handle.cancelled = true;
          handle.proc?.kill();
          reject(
            new Error(
              `job exceeded its ${this.cfg.jobTimeoutMin} min wall-clock budget — cancelled`,
            ),
          );
        }, budgetMs);
      });
      try {
        return await Promise.race([
          this.executeInner(job, mountPoint, handle, tick, log),
          budgetHit,
        ]);
      } finally {
        if (budget) clearTimeout(budget);
      }
    } finally {
      clearInterval(heartbeat);
      this.touched.delete(job.id);
    }
  }

  /** The structural view hygiene_jobs.ts runs against (seam rule — the
   *  legs stay decoupled from the class; drain is injected to avoid a
   *  jobs.ts ← hygiene_jobs.ts import cycle). The legs get the LIVE tick
   *  and log closures plus the run handle, so progress + cancellation
   *  behave exactly like the in-file legs. */
  private hygieneDeps(
    job: Job,
    tick: (
      done: number,
      total: number,
      message: string,
      phase: string,
      force?: boolean,
    ) => void,
    log: (line: string, isError?: boolean) => void,
    handle: RunHandle,
  ) {
    return {
      cfg: this.cfg,
      jobTimeoutMin: this.cfg.jobTimeoutMin,
      cancelled: (): boolean =>
        handle.cancelled || this.db.getJob(job.id)?.status !== "running",
      killProc: (p: Bun.Subprocess): void => p.kill(),
      log: (line: string): void => log(line),
      tick,
      drain: ((
        stream: ReadableStream<Uint8Array>,
        onLine: (l: string) => void,
        h: { cancelled: boolean; proc?: Bun.Subprocess },
        timeoutMs: number,
      ) => drain(stream, onLine, h, timeoutMs)) as typeof drain,
      drainText: (s: ReadableStream<Uint8Array> | undefined): Promise<string> =>
        drainText(s),
    };
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
        const light = await scanVolume(mountPoint);
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
        // markers in a known order; verifyPhase() maps each to the ABSOLUTE
        // progress it starts (the old inline version (a) required leading
        // spaces on trimmed lines — the longest phase never matched — and
        // (b) computed progress as from/to, i.e. 0.15/0.35 = 43%).
        //   0.00–0.15 open DBs · 0.15–0.35 hardware view · 0.35–0.80 per-track
        //   0.80–0.90 relations · 0.90–0.95 cross-drive · 0.95–0.99 hashing ·
        //   0.99–1.00 verdict
        let phaseIdx = 0;
        const rawLine = (line: string) => {
          const m = verifyPhase(line, phaseIdx);
          if (m) {
            phaseIdx = m.nextIdx;
            tick(m.progress, 1, m.message, `phase-${phaseIdx}`, true);
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
          finalLine !== undefined &&
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
          // Role-aware dual-db (shelf tier: parity is informational) —
          // dropping this arg silently re-fails shelf drives (Sep 10).
          this.db.getDrive(job.drive_id)?.role,
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
      case "ingest": {
        // mountPoint carries the SOURCE FOLDER for this kind (drive jobs
        // carry a volume there — same slot, different payload).
        const folder = mountPoint;
        tick(0, 1, `intake from ${folder}`, INTAKE_PHASES[0]!.phase, true);
        const proc = Bun.spawn(
          ["bun", megadjCliPath(this.cfg.root), ...intakeArgs(folder)],
          { stdout: "pipe", stderr: "pipe", cwd: this.cfg.root },
        );
        handle.proc = proc;
        // Phase-driven progress off megadj's own log lines (same pattern
        // as verify): markers only ever advance the phase index, so a
        // repeated "[dupe]" can't rewind the bar. Within the enrich phase
        // each per-file row ("  = ok:" / "  ~ f: …") nudges toward 0.9.
        // The human log lands on STDERR in --json mode (progress.ts keeps
        // stdout as the one summary object), so both streams are drained.
        let phaseIdx = 0;
        let enrichBase: number = INTAKE_PHASES[3]!.at;
        let seen = 0;
        const onLine = (l: string): void => {
          log(l);
          const m = intakePhaseFor(l, phaseIdx);
          if (m) {
            phaseIdx = m.nextIdx;
            if (phaseIdx >= 3) enrichBase = m.progress;
            tick(
              m.progress,
              1,
              m.message,
              INTAKE_PHASES[phaseIdx]!.phase,
              true,
            );
            return;
          }
          // enrich-phase per-file rows: nudge the fraction forward
          if (phaseIdx >= 3 && phaseIdx < 4 && INTAKE_FILE_LINE.test(l)) {
            seen++;
            tick(
              Math.min(0.89, enrichBase + seen * 0.02),
              1,
              l.trim().slice(0, 120),
              INTAKE_PHASES[3]!.phase,
            );
          }
        };
        const [res, errRes] = await Promise.all([
          drain(proc, onLine, handle, this.cfg.jobTimeoutMin * 60_000),
          drain(proc.stderr, onLine, handle),
        ]);
        await proc.exited;
        if (handle.cancelled) throw new Error("cancelled");
        const errText = errRes.out;
        if (proc.exitCode !== 0) {
          throw new Error(
            `megadj ingest exited ${proc.exitCode}${
              errText.trim() ? `: ${errText.trim().slice(-400)}` : ""
            }`,
          );
        }
        const { summary } = splitIntakeStdout(res.out);
        const s = (summary ?? {}) as Partial<IntakeResult>;
        // Verify leg: the post-run archive audit (ground truth over every
        // file, not just this batch). Failures land in the result, not a
        // failed job — ingest itself succeeded.
        tick(
          INTAKE_PHASES[5]!.at,
          1,
          "auditing the archive…",
          INTAKE_PHASES[5]!.phase,
          true,
        );
        let audit: IntakeResult["audit"] = null;
        let auditErrors: IntakeResult["auditErrors"] = [];
        const ap = Bun.spawn(
          ["bun", megadjCliPath(this.cfg.root), "audit", "--json"],
          { stdout: "pipe", stderr: "pipe", cwd: this.cfg.root },
        );
        const aOut = await new Response(ap.stdout).text();
        await ap.exited;
        try {
          const a = JSON.parse(aOut) as {
            total: number;
            complete: number;
            incomplete?: { file: string; missing: string }[];
          };
          audit = { total: a.total, complete: a.complete };
          auditErrors = a.incomplete ?? [];
        } catch {
          // audit output unreadable — ingest verdict still stands; the
          // summary names it so the UI can show "audit unavailable"
          log("audit leg failed to report — see server log");
        }
        tick(
          1,
          1,
          audit
            ? `archive ${audit.complete}/${audit.total} complete`
            : "intake done",
          "done",
          true,
        );
        const result: IntakeResult = {
          files: Number(s.files ?? 0),
          tagged: Number(s.tagged ?? 0),
          artAdded: Number(s.artAdded ?? 0),
          artQueued: Number(s.artQueued ?? 0),
          wavConverted: Number(s.wavConverted ?? 0),
          folderDupes: Number(s.folderDupes ?? 0),
          archiveDupes: Number(s.archiveDupes ?? 0),
          upgrades: Number(s.upgrades ?? 0),
          broken: Number(s.broken ?? 0),
          compatRejected: Number(s.compatRejected ?? 0),
          compatHires: Number(s.compatHires ?? 0),
          shortSkipped: Number(s.shortSkipped ?? 0),
          unchanged: Number(s.unchanged ?? 0),
          audit,
          auditErrors,
        };
        this.db.event("local-archive", "intake", {
          folder,
          files: result.files,
          tagged: result.tagged,
          dupes: result.folderDupes + result.archiveDupes,
          audit: result.audit,
        });
        return result;
      }
      case "benchmark": {
        tick(0, 1, "reading largest files sequentially…", "bench-seq", true);
        // benchmarkDrive is now async + cancellation-aware: reads abort
        // promptly on cancel instead of running to completion, and the
        // event loop stays live throughout (SSE heartbeat keeps firing).
        const r = await benchmarkDrive(
          mountPoint,
          this.cfg.benchmarkMb,
          handle,
        );
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
      case "speedtest": {
        // Minimal ~10MB sequential read — measures real throughput without
        // burning the disk or the bus (the full benchmark is the heavy
        // sibling; this answers "is this link actually USB3?" in <1s).
        // Read-only and tiny, so no interlock. Known-big paths come from
        // the checksum ledger first, then the scan manifest — the walk
        // fallback alone takes minutes on a 4TB exFAT volume.
        tick(0, 1, "probing read speed (~10MB)…", "speedtest", true);
        const ledgerPaths = this.db.ledgerBiggest(job.drive_id, 5);
        const manifestPaths = this.db.manifestBiggest(job.drive_id, 5);
        const r = await speedProbe(mountPoint, 10, handle, [
          ...ledgerPaths,
          ...manifestPaths,
        ]);
        this.db.addSpeedProbe(job.drive_id, r.mbps, r.bytes_read);
        this.db.event(job.drive_id, "speedtest", {
          mbps: r.mbps,
          bytes_read: r.bytes_read,
        });
        tick(1, 1, `read ${r.mbps.toLocaleString()} MB/s`, "done", true);
        return { mbps: r.mbps, bytes_read: r.bytes_read };
      }
      case "hygiene-scan": {
        // mountPoint carries the SHELF VOLUME (same slot as drive jobs).
        // Engine SSOT stays megadj's CLI — this module only renders phases.
        const { runHygieneScan } = await import("./hygiene_jobs");
        return runHygieneScan(
          this.hygieneDeps(job, tick, log, handle),
          mountPoint,
          handle,
        );
      }
      case "hygiene-apply": {
        // CONFIRMED findings only (the confirm step IS the human gate).
        const { runHygieneApply } = await import("./hygiene_jobs");
        return runHygieneApply(
          this.hygieneDeps(job, tick, log, handle),
          mountPoint,
          handle,
        );
      }
      case "fixes-scan": {
        // mountPoint carries the shelf's Contents dir (the music dir the
        // booth gates audit). Engine SSOT stays megadj's booth-fix CLI.
        const { runFixesScan } = await import("./fixes_jobs");
        const summary = await runFixesScan(
          this.hygieneDeps(job, tick, log, handle),
          mountPoint,
          handle,
        );
        const { recordFixes } = await import("./fixes_routes");
        recordFixes(toPayload(summary, mountPoint));
        return summary;
      }
      case "fixes-apply": {
        // SAFE subset only: renames + tag sanitization. `none` rows are
        // proposals — booth-fix's CLI already refuses to auto-execute them.
        const { runFixesApply } = await import("./fixes_jobs");
        const summary = await runFixesApply(
          this.hygieneDeps(job, tick, log, handle),
          mountPoint,
          handle,
        );
        // rescan for post-apply truth (fixable should drop toward 0) and
        // cache it — the UI banner reads this after the job finishes
        const { runFixesScan: rescan } = await import("./fixes_jobs");
        const after = await rescan(
          this.hygieneDeps(job, tick, log, handle),
          mountPoint,
          handle,
        );
        const { recordFixes } = await import("./fixes_routes");
        recordFixes(toPayload(after, mountPoint));
        return summary;
      }
      default:
        return null;
    }
  }

  async shutdown(): Promise<void> {
    if (this.reaper) clearInterval(this.reaper);
    for (const h of this.running.values()) h.proc?.kill();
  }
}

/** Read a subprocess stream line-by-line (onLine per complete line) while
 *  capturing the full text. Exported for tests — the capture must contain
 *  every byte exactly once (a regression once duplicated every chunk).
 *  Accepts the raw stream form too (the intake job line-drains STDERR —
 *  ingest --json routes its human log there, progress.ts) — pass the
 *  stream directly and it shares the handle's cancelled flag for kill. */
export async function drain(
  proc: Bun.Subprocess | ReadableStream<Uint8Array> | number | undefined,
  onLine: (l: string) => void,
  handle?: RunHandle,
  timeoutMs = 0,
): Promise<{ out: string }> {
  const stream =
    proc && typeof proc === "object" && "stdout" in proc
      ? proc.stdout
      : (proc as ReadableStream<Uint8Array> | number | undefined);
  return drainStream(stream, onLine, handle, timeoutMs, proc);
}

async function drainStream(
  stream: ReadableStream<Uint8Array> | number | undefined,
  onLine: (l: string) => void,
  handle: RunHandle | undefined,
  timeoutMs: number,
  proc: Bun.Subprocess | ReadableStream<Uint8Array> | number | undefined,
): Promise<{ out: string }> {
  let out = "";
  if (!stream || typeof stream === "number") {
    if (proc && typeof proc === "object" && "exited" in proc) await proc.exited;
    return { out };
  }
  const reader = stream.getReader();
  const timer = timeoutMs
    ? setTimeout(() => {
        if (handle) handle.cancelled = true;
        if (proc && typeof proc === "object" && "kill" in proc) proc.kill();
      }, timeoutMs)
    : null;
  try {
    const dec = new TextDecoder();
    let carry = ""; // partial line from the previous chunk
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // stream:true — a multi-byte UTF-8 char split across chunks must not
      // become a replacement char in the captured output
      const text = dec.decode(value, { stream: true });
      const chunk = carry + text;
      const lines = chunk.split("\n");
      carry = lines.pop() ?? ""; // last element may be incomplete
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
      // append only the NEW bytes: `carry` was already counted when its
      // chunk arrived (the old `out += chunk` re-added it every iteration,
      // duplicating text through the whole captured output)
      out += text;
      if (handle?.cancelled) {
        if (proc && typeof proc === "object" && "kill" in proc) proc.kill();
        break;
      }
    }
    out += dec.decode(); // flush a buffered partial multi-byte sequence
    if (carry.trim()) onLine(carry); // flush the final partial line
  } finally {
    if (timer) clearTimeout(timer);
    if (proc && typeof proc === "object" && "exited" in proc) await proc.exited;
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

export {
  parseVerifyReport,
  sanitizeVerifyReport,
  verifyDeltas,
} from "./verify_report";

/** Where a line belongs in usb_verify.py's phase order → absolute progress.
 *
 * Phases are matched IN ORDER (once phase N fires, earlier phases are
 * skipped) so repeated/hashed noise lines can't rewind the bar. Returns the
 * absolute progress the phase starts at (not a from/to span — the old inline
 * mapping computed from/to as done/total and showed garbage percentages).
 *
 * Lines are matched UNTRIMMED: usb_verify.py indents per-drive output
 * ("  tracks: 3512"), and the previous trimmed-input regexes never matched,
 * leaving the bar at ~15% through the longest phase. */
export function verifyPhase(
  line: string,
  phaseIdx: number,
): { progress: number; message: string; nextIdx: number } | null {
  const PHASES: [RegExp, number, string][] = [
    [/^### /, 0.15, "checking hardware DB view (export.pdb)…"],
    [/^  tracks:/, 0.35, "checking every track: files, grids, BPM…"],
    [/^  playlists:/, 0.8, "checking playlists + relations…"],
    [/=== cross-drive ===/, 0.85, "comparing master ↔ mirror…"],
    [/^  hashed \d+\//, 0.9, "hashing ANLZ files on both drives…"],
    [/audio hash spot-check/, 0.95, "spot-hashing audio files…"],
    [/^FINAL:/, 0.99, "writing verdict…"],
  ];
  for (let i = phaseIdx; i < PHASES.length; i++) {
    const [re, progress, message] = PHASES[i]!;
    if (re.test(line)) {
      return { progress, message, nextIdx: i + 1 };
    }
  }
  return null;
}
