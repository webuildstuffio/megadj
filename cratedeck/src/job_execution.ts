/** Job-kind execution legs. JobEngine owns queueing and lifecycle only. */
import { basename } from "node:path";
import type { FixesPayload } from "../shared/fixes";
import { fmtBytes } from "../shared/fmt";
import type { IntakeResult, Job } from "../shared/types";
import { benchmarkDrive, checksumLedger, speedProbe } from "./bench";
import type { CrateConfig } from "./config";
import type { DB } from "./db";
import type { Guard } from "./guard";
import {
  INTAKE_FILE_LINE,
  INTAKE_PHASES,
  intakeArgs,
  intakePhaseFor,
  megadjCliPath,
  splitIntakeStdout,
} from "./intake_run";
import {
  drain,
  drainText,
  type JobLog,
  type JobTick,
  type RunHandle,
  verifyPhase,
} from "./job_runtime";
import { rbSnapshot, spawnMirror, spawnVerify } from "./rb";
import { scanVolume } from "./scan";
import { lastLines, parseVerifyReport } from "./verify_report";

export interface JobExecutionDeps {
  cfg: CrateConfig;
  db: DB;
  guard: Guard;
}

interface LegArgs {
  deps: JobExecutionDeps;
  job: Job;
  mountPoint: string;
  handle: RunHandle;
  tick: JobTick;
  log: JobLog;
}

/** Numeric summaries cross a subprocess JSON boundary; reject NaN/Infinity. */
export function finiteJobNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function executeJob(args: LegArgs): Promise<unknown> {
  switch (args.job.kind) {
    case "scan":
      return runScan(args);
    case "verify":
      return runVerify(args);
    case "mirror":
      return runMirror(args);
    case "ingest":
      return runIngest(args);
    case "benchmark":
      return runBenchmark(args);
    case "checksum":
      return runChecksum(args);
    case "speedtest":
      return runSpeedtest(args);
    case "hygiene-scan":
      return runHygiene(args, false);
    case "hygiene-apply":
      return runHygiene(args, true);
    case "fixes-scan":
      return runFixes(args, false);
    case "fixes-apply":
      return runFixes(args, true);
    default:
      return null;
  }
}

async function runScan({ deps, job, mountPoint, handle, tick }: LegArgs) {
  tick(0, 1, "walking filesystem…", "light-scan", true);
  const light = await scanVolume(mountPoint);
  deps.db.setSnapshot(job.drive_id, light);
  deps.db.event(job.drive_id, "scan", {
    kind: "light",
    files: light.file_count,
  });
  if (handle.cancelled) throw new Error("cancelled");

  let full = false;
  try {
    tick(0.5, 1, "reading rekordbox database…", "full-scan", true);
    const fullSnap = await rbSnapshot(deps.cfg, deps.guard, mountPoint);
    deps.db.setSnapshot(job.drive_id, {
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
      manifest: light.manifest,
    });
    full = true;
    deps.db.event(job.drive_id, "scan", {
      kind: "full",
      tracks: fullSnap.track_count,
    });
  } catch (error) {
    if ((error as Error).message.startsWith("REKORDBOX_RUNNING")) throw error;
  }
  tick(1, 1, full ? "scan complete" : "light scan complete", "done", true);
  return { light: true, full };
}

async function runVerify({
  deps,
  job,
  mountPoint,
  handle,
  tick,
  log,
}: LegArgs) {
  const name = basename(mountPoint);
  const startedAt = Date.now();
  tick(0, 1, `verifying ${name} — opening rekordbox DB…`, "1-databases", true);
  const proc = spawnVerify(deps.cfg, [name]);
  handle.proc = proc;
  let phaseIdx = 0;
  const rawLine = (line: string): void => {
    const match = verifyPhase(line, phaseIdx);
    if (!match) return;
    phaseIdx = match.nextIdx;
    tick(match.progress, 1, match.message, `phase-${phaseIdx}`, true);
  };
  const [verdict, errText] = await Promise.all([
    drain(
      proc,
      (line) => {
        log(line);
        rawLine(line);
      },
      handle,
      deps.cfg.verifyTimeoutMin * 60_000,
    ),
    drainText(proc.stderr),
  ]);
  const out = verdict.out + (errText ? `\n[stderr]\n${errText}` : "");
  const finalLine = verdict.out
    .split("\n")
    .find((line) => line.startsWith("FINAL:"));
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
    deps.db.getDrive(job.drive_id)?.role,
  );
  return { verdict: pass ? "pass" : "fail", ...report };
}

async function runMirror({ deps, handle, tick, log }: LegArgs) {
  tick(0, 1, "mirroring to mirror drive…", "mirror", true);
  const proc = spawnMirror(deps.cfg, []);
  handle.proc = proc;
  const [result, errText] = await Promise.all([
    drain(
      proc,
      (line) => log(line),
      handle,
      deps.cfg.mirrorTimeoutMin * 60_000,
    ),
    drainText(proc.stderr),
  ]);
  const out = result.out + (errText ? `\n[stderr]\n${errText}` : "");
  tick(1, 1, "mirror finished", "done", true);
  return { summary: lastLines(out, 20) };
}

async function runIngest({
  deps,
  mountPoint: folder,
  handle,
  tick,
  log,
}: LegArgs) {
  tick(0, 1, `intake from ${folder}`, INTAKE_PHASES[0]!.phase, true);
  const proc = Bun.spawn(
    ["bun", megadjCliPath(deps.cfg.root), ...intakeArgs(folder)],
    { stdout: "pipe", stderr: "pipe", cwd: deps.cfg.root },
  );
  handle.proc = proc;
  let phaseIdx = 0;
  let enrichBase: number = INTAKE_PHASES[3]!.at;
  let seen = 0;
  const onLine = (line: string): void => {
    log(line);
    const phase = intakePhaseFor(line, phaseIdx);
    if (phase) {
      phaseIdx = phase.nextIdx;
      if (phaseIdx >= 3) enrichBase = phase.progress;
      tick(
        phase.progress,
        1,
        phase.message,
        INTAKE_PHASES[phaseIdx]!.phase,
        true,
      );
      return;
    }
    if (phaseIdx >= 3 && phaseIdx < 4 && INTAKE_FILE_LINE.test(line)) {
      seen++;
      tick(
        Math.min(0.89, enrichBase + seen * 0.02),
        1,
        line.trim().slice(0, 120),
        INTAKE_PHASES[3]!.phase,
      );
    }
  };
  const [result, errResult] = await Promise.all([
    drain(proc, onLine, handle, deps.cfg.jobTimeoutMin * 60_000),
    drain(proc.stderr, onLine, handle),
  ]);
  await proc.exited;
  if (handle.cancelled) throw new Error("cancelled");
  if (proc.exitCode !== 0) {
    const suffix = errResult.out.trim()
      ? `: ${errResult.out.trim().slice(-400)}`
      : "";
    throw new Error(`megadj ingest exited ${proc.exitCode}${suffix}`);
  }
  const { summary } = splitIntakeStdout(result.out);
  const partial = (summary ?? {}) as Partial<IntakeResult>;
  const { audit, auditErrors } = await auditArchive(deps.cfg, tick, log);
  const intake: IntakeResult = {
    files: finiteJobNumber(partial.files),
    tagged: finiteJobNumber(partial.tagged),
    artAdded: finiteJobNumber(partial.artAdded),
    artQueued: finiteJobNumber(partial.artQueued),
    wavConverted: finiteJobNumber(partial.wavConverted),
    folderDupes: finiteJobNumber(partial.folderDupes),
    archiveDupes: finiteJobNumber(partial.archiveDupes),
    upgrades: finiteJobNumber(partial.upgrades),
    broken: finiteJobNumber(partial.broken),
    compatRejected: finiteJobNumber(partial.compatRejected),
    compatHires: finiteJobNumber(partial.compatHires),
    shortSkipped: finiteJobNumber(partial.shortSkipped),
    unchanged: finiteJobNumber(partial.unchanged),
    audit,
    auditErrors,
  };
  deps.db.event("local-archive", "intake", {
    folder,
    files: intake.files,
    tagged: intake.tagged,
    dupes: intake.folderDupes + intake.archiveDupes,
    audit: intake.audit,
  });
  return intake;
}

async function auditArchive(
  cfg: CrateConfig,
  tick: JobTick,
  log: JobLog,
): Promise<Pick<IntakeResult, "audit" | "auditErrors">> {
  tick(
    INTAKE_PHASES[5]!.at,
    1,
    "auditing the archive…",
    INTAKE_PHASES[5]!.phase,
    true,
  );
  let audit: IntakeResult["audit"] = null;
  let auditErrors: IntakeResult["auditErrors"] = [];
  const proc = Bun.spawn(["bun", megadjCliPath(cfg.root), "audit", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: cfg.root,
  });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  try {
    const parsed = JSON.parse(output) as {
      total: number;
      complete: number;
      incomplete?: { file: string; missing: string }[];
    };
    audit = { total: parsed.total, complete: parsed.complete };
    auditErrors = parsed.incomplete ?? [];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`audit leg failed to report: ${detail}`);
  }
  tick(
    1,
    1,
    audit ? `archive ${audit.complete}/${audit.total} complete` : "intake done",
    "done",
    true,
  );
  return { audit, auditErrors };
}

async function runBenchmark({ deps, job, mountPoint, handle, tick }: LegArgs) {
  tick(0, 1, "reading largest files sequentially…", "bench-seq", true);
  const result = await benchmarkDrive(mountPoint, deps.cfg.benchmarkMb, handle);
  deps.db.addBenchmark(job.drive_id, result.seq_mbps, result.rand4k_mbps);
  deps.db.event(job.drive_id, "benchmark", {
    seq: result.seq_mbps,
    rand4k: result.rand4k_mbps,
  });
  tick(1, 1, `${result.seq_mbps} MB/s sequential`, "done", true);
  return result;
}

async function runChecksum({ deps, job, mountPoint, handle, tick }: LegArgs) {
  const result = await checksumLedger(
    deps.db,
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
  deps.db.event(job.drive_id, "checksum", {
    hashed: result.hashed,
    changed: result.changed.length,
  });
  if (result.changed.length) {
    deps.db.event(job.drive_id, "bitrot-suspect", {
      paths: result.changed.slice(0, 50),
    });
  }
  tick(
    1,
    1,
    result.changed.length
      ? `${result.changed.length} file(s) changed vs ledger`
      : `${result.hashed.toLocaleString()} files clean`,
    "done",
    true,
  );
  return result;
}

async function runSpeedtest({ deps, job, mountPoint, handle, tick }: LegArgs) {
  tick(0, 1, "probing read speed (~10MB)…", "speedtest", true);
  const result = await speedProbe(mountPoint, 10, handle, [
    ...deps.db.ledgerBiggest(job.drive_id, 5),
    ...deps.db.manifestBiggest(job.drive_id, 5),
  ]);
  deps.db.addSpeedProbe(job.drive_id, result.mbps, result.bytes_read);
  deps.db.event(job.drive_id, "speedtest", {
    mbps: result.mbps,
    bytes_read: result.bytes_read,
  });
  tick(1, 1, `read ${result.mbps.toLocaleString()} MB/s`, "done", true);
  return { mbps: result.mbps, bytes_read: result.bytes_read };
}

function cliDeps({ deps, job, handle, tick, log }: LegArgs) {
  return {
    cfg: deps.cfg,
    jobTimeoutMin: deps.cfg.jobTimeoutMin,
    cancelled: (): boolean =>
      handle.cancelled || deps.db.getJob(job.id)?.status !== "running",
    killProc: (proc: Bun.Subprocess): void => proc.kill(),
    log: (line: string): void => log(line),
    tick,
    drain: (
      stream: ReadableStream<Uint8Array>,
      onLine: (line: string) => void,
      runHandle: { cancelled: boolean; proc?: Bun.Subprocess },
      timeoutMs: number,
    ) => drain(stream, onLine, runHandle, timeoutMs),
    drainText: (stream: ReadableStream<Uint8Array> | undefined) =>
      drainText(stream),
  };
}

async function runHygiene(args: LegArgs, apply: boolean) {
  const jobs = await import("./hygiene_jobs");
  const run = apply ? jobs.runHygieneApply : jobs.runHygieneScan;
  return run(cliDeps(args), args.mountPoint, args.handle);
}

function toPayload(
  summary: Record<string, unknown>,
  scannedPath: string,
): FixesPayload {
  return {
    fleet: (summary.fleet as string[]) ?? [],
    checked: finiteJobNumber(summary.checked),
    fixable: finiteJobNumber(summary.fixable),
    applied: finiteJobNumber(summary.applied),
    rows: (summary.rows as FixesPayload["rows"]) ?? [],
    scannedPath,
  };
}

async function runFixes(args: LegArgs, apply: boolean) {
  const jobs = await import("./fixes_jobs");
  const run = apply ? jobs.runFixesApply : jobs.runFixesScan;
  const summary = await run(cliDeps(args), args.mountPoint, args.handle);
  if (apply) {
    const after = await jobs.runFixesScan(
      cliDeps(args),
      args.mountPoint,
      args.handle,
    );
    const { recordFixes } = await import("./fixes_routes");
    recordFixes(toPayload(after, args.mountPoint));
  } else {
    const { recordFixes } = await import("./fixes_routes");
    recordFixes(toPayload(summary, args.mountPoint));
  }
  return summary;
}
