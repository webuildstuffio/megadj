// jobs.ts — queue with per-drive concurrency 1, progress, logs, cancel,
// and the rekordbox interlock (refuse everything while rekordbox runs).
import { basename } from "node:path";
import type { CrateConfig } from "./config";
import type { DB } from "./db";
import type { Guard } from "./guard";
import type { Job, JobKind } from "../shared/types";
import { fmtBytes } from "../shared/fmt";
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
        return {
          verdict: pass ? "pass" : "fail",
          final: finalLine ?? null,
          ...parseVerifyFindings(verdict.out),
          summary: lastLines(out, 20),
        };
      }
      case "mirror": {
        tick(0, 1, "mirroring to DJMIRROR…", "mirror", true);
        const proc = spawnMirror(this.cfg, []);
        handle.proc = proc;
        const [res, errText] = await Promise.all([
          drain(proc, (l) => log(l), handle),
          drainText(proc.stderr),
        ]);
        const out = res.out + (errText ? `\n[stderr]\n${errText}` : "");
        tick(1, 1, "mirror finished", "done", true);
        return { summary: lastLines(out, 20) };
      }
      case "benchmark": {
        tick(0, 1, "reading largest files sequentially…", "bench-seq", true);
        const r = benchmarkDrive(mountPoint, this.cfg.benchmarkMb);
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

function lastLines(text: string, n: number): string {
  return text.split("\n").filter(Boolean).slice(-n).join("\n");
}

export interface VerifyFinding {
  id: string;
  label: string;
  detail: string;
  meaning: string;
  fix: string;
}

/** Parse usb_verify.py output into structured, human-explained findings.
 *  The script prints stable "key: value" lines; regex them out so the UI and
 *  CLI can render a proper report instead of a raw wall of text. */
export function parseVerifyFindings(out: string): {
  findings: VerifyFinding[];
  stats: Record<string, number>;
} {
  const stats: Record<string, number> = {};
  const grab = (re: RegExp): number | null => {
    const m = out.match(re);
    if (!m?.[1]) return null;
    const v = parseInt(m[1], 10);
    if (Number.isNaN(v)) return null;
    return v;
  };
  const pdb = grab(/export\.pdb=(\d+) tracks vs OneLibrary DB=(\d+)/);
  const odb = grab(/OneLibrary DB=(\d+) tracks/);
  if (pdb !== null && odb !== null) {
    stats.pdb_tracks = pdb;
    stats.onelibrary_tracks = odb;
  }
  const missingAudio = grab(/missing audio: (\d+)/);
  const missingAnlz = grab(/missing analysis: (\d+)/);
  const noBpm = grab(/no BPM: (\d+)/);
  const badLen = grab(/bad length: (\d+)/);
  const badGrids = grab(/bad grids \(generated\): (\d+)/);
  const pioneerVar = grab(/pioneer-native variance \(informational\): (\d+)/);
  const dangling = grab(/dangling: (\d+)/);
  const artistFk = grab(/artist FK bad: (\d+)/);
  const anlzHash = grab(/ANLZ missing at hash path AND at DB path: (\d+)/);
  const playlists = grab(/playlists: (\d+)/);
  if (playlists !== null) stats.playlists = playlists;

  const findings: VerifyFinding[] = [];
  const push = (f: VerifyFinding) => findings.push(f);

  if (pdb !== null && odb !== null && pdb !== odb) {
    const delta = odb - pdb;
    push({
      id: "pdb-parity",
      label:
        delta > 0
          ? `Legacy DB behind by ${delta} tracks`
          : `Legacy DB has ${-delta} stale rows`,
      detail: `export.pdb ${pdb} vs OneLibrary ${odb}`,
      meaning:
        "USB drives carry TWO databases: exportLibrary.db (new rekordbox) and export.pdb (what CDJ/XDJ hardware actually reads). If they disagree, hardware players see a different library than rekordbox does.",
      fix:
        delta > 0
          ? "Re-run the USB export from rekordbox (with the drive connected) so export.pdb catches up"
          : "Stale tombstones in export.pdb — re-run the USB export to rebuild it",
    });
  }
  const missingAnalysis = (missingAnlz ?? 0) + (anlzHash ?? 0);
  if (missingAnalysis > 0) {
    push({
      id: "anlz-missing",
      label: `${missingAnalysis} track(s) missing beatgrid/waveform files`,
      detail: `${missingAnlz ?? 0} missing at DB path, ${anlzHash ?? 0} missing at hardware hash path`,
      meaning:
        "ANLZ files store waveforms + beatgrids. Without them, CDJs show no waveform and no Beat Sync for those tracks.",
      fix: "In rekordbox: select the tracks → Track → Analyze, then re-export to the drive",
    });
  }
  if (missingAudio !== null && missingAudio > 0) {
    push({
      id: "audio-missing",
      label: `${missingAudio} track(s) in the DB have no audio file on disk`,
      detail: "DB rows pointing at non-existent files",
      meaning:
        "These tracks show in the browser but won't load (dead entries).",
      fix: "In rekordbox: File → Library maintenance, or remove the broken rows, then re-export",
    });
  }
  if ((noBpm ?? 0) > 0 || (badLen ?? 0) > 0) {
    push({
      id: "fields",
      label: `${(noBpm ?? 0) + (badLen ?? 0)} track(s) missing BPM or length`,
      detail: `${noBpm ?? 0} without BPM, ${badLen ?? 0} with implausible length`,
      meaning: "Breaks BPM sync and search-by-BPM on hardware.",
      fix: "Analyze those tracks in rekordbox, re-export",
    });
  }
  if ((badGrids ?? 0) > 0) {
    push({
      id: "grids",
      label: `${badGrids} track(s) with bad beatgrids`,
      detail: "grid data inconsistent with track length/BPM",
      meaning: "Beat Sync/Beat Jump will be wrong for these tracks.",
      fix: "Re-analyze those specific tracks in rekordbox",
    });
  }
  if ((dangling ?? 0) > 0 || (artistFk ?? 0) > 0) {
    push({
      id: "relations",
      label: `${(dangling ?? 0) + (artistFk ?? 0)} broken DB reference(s)`,
      detail: `${dangling ?? 0} dangling playlist entries, ${artistFk ?? 0} bad artist links`,
      meaning:
        "Playlist or artist views may crash or show blank entries on hardware.",
      fix: "Usually heals on the next full rekordbox export; if persistent, rebuild the playlist",
    });
  }
  if (out.includes("DB byte-identical: false")) {
    push({
      id: "db-parity",
      label: "Master and mirror databases DIFFER",
      detail: "exportLibrary.db hashes don't match across drives",
      meaning:
        "The two drives will behave differently in the booth — playlists/track data won't match.",
      fix: "Re-run the mirror sync so both drives get the same DB",
    });
  }
  const audioMismatch = grab(/audio hash spot-check \(40\): (\d+) mismatches/);
  if (audioMismatch !== null && audioMismatch > 0) {
    push({
      id: "audio-parity",
      label: `${audioMismatch}/40 sampled audio files differ between drives`,
      detail: "same track, different bytes — probably different rips",
      meaning: "One drive has a different version of the song than the other.",
      fix: "Copy the master's version over the mirror's (usb_verify prints which files)",
    });
  }
  if (pioneerVar !== null) {
    stats.pioneer_variance = pioneerVar;
  }
  return { findings, stats };
}
