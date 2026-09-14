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

/** Numeric summaries cross a subprocess JSON boundary; counts are integers. */
export function finiteJobNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("job summary count must be a safe non-negative integer");
  return value;
}

type IntakeCounters = Omit<IntakeResult, "audit" | "auditErrors">;
type AuditError = IntakeResult["auditErrors"][number];

function isAuditError(entry: unknown): entry is AuditError {
  return (
    typeof entry === "object" &&
    entry !== null &&
    !Array.isArray(entry) &&
    typeof (entry as Record<string, unknown>).file === "string" &&
    typeof (entry as Record<string, unknown>).missing === "string"
  );
}

export function parseIngestSummary(
  summary: Record<string, unknown> | null,
): IntakeCounters {
  if (summary === null)
    throw new Error("megadj ingest returned a missing JSON summary");
  const count = (key: keyof IntakeCounters): number => {
    try {
      return finiteJobNumber(summary[key]);
    } catch (error) {
      throw new Error(
        `megadj ingest summary ${key} is invalid: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  };
  return {
    files: count("files"),
    tagged: count("tagged"),
    artAdded: count("artAdded"),
    artQueued: count("artQueued"),
    wavConverted: count("wavConverted"),
    folderDupes: count("folderDupes"),
    archiveDupes: count("archiveDupes"),
    upgrades: count("upgrades"),
    broken: count("broken"),
    compatRejected: count("compatRejected"),
    compatHires: count("compatHires"),
    shortSkipped: count("shortSkipped"),
    unchanged: count("unchanged"),
  };
}

export function parseAuditSummary(
  output: string,
): Pick<IntakeResult, "audit" | "auditErrors"> {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch (error) {
    throw new Error(
      `malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("audit summary must be an object");
  const row = value as Record<string, unknown>;
  let total: number;
  let complete: number;
  try {
    total = finiteJobNumber(row.total);
  } catch {
    throw new Error("audit summary total must be a safe non-negative integer");
  }
  try {
    complete = finiteJobNumber(row.complete);
  } catch {
    throw new Error(
      "audit summary complete must be a safe non-negative integer",
    );
  }
  if (complete > total)
    throw new Error("audit summary complete cannot exceed total");
  const incomplete = row.incomplete ?? [];
  if (!Array.isArray(incomplete) || !incomplete.every(isAuditError))
    throw new Error("audit summary incomplete rows are invalid");
  return {
    audit: { total, complete },
    auditErrors: incomplete,
  };
}

export function lastFinalLine(output: string): string | undefined {
  return output.split("\n").findLast((line) => line.startsWith("FINAL:"));
}

export function requireSuccessfulExit(
  label: string,
  exitCode: number | null,
  stderr: string,
): void {
  if (exitCode === 0) return;
  const detail = stderr.trim();
  throw new Error(
    `${label} exited ${exitCode ?? "unknown"}${detail ? `: ${detail.slice(-400)}` : ""}`,
  );
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
  const finalLine = lastFinalLine(verdict.out);
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
  if (handle.cancelled) throw new Error("cancelled");
  requireSuccessfulExit("mirror", proc.exitCode, errText);
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
  const counters = parseIngestSummary(summary);
  const { audit, auditErrors } = await auditArchive(
    deps.cfg,
    handle,
    tick,
    log,
  );
  const intake: IntakeResult = {
    ...counters,
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

export async function auditArchive(
  cfg: CrateConfig,
  handle: RunHandle,
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
  const proc = Bun.spawn(["bun", megadjCliPath(cfg.root), "audit", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: cfg.root,
  });
  handle.proc = proc;
  const [outputResult, errorResult] = await Promise.all([
    drain(proc, (line) => log(line), handle, cfg.jobTimeoutMin * 60_000),
    drain(proc.stderr, (line) => log(line, true), handle),
  ]);
  if (handle.cancelled) throw new Error("cancelled");
  const output = outputResult.out;
  const errorOutput = errorResult.out;
  if (proc.exitCode !== 0 && proc.exitCode !== 1)
    throw new Error(
      `megadj audit exited ${proc.exitCode ?? "unknown"}${
        errorOutput.trim() ? `: ${errorOutput.trim().slice(-400)}` : ""
      }`,
    );
  let result: Pick<IntakeResult, "audit" | "auditErrors">;
  try {
    result = parseAuditSummary(output);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`audit leg failed to report: ${detail}`);
    throw new Error(
      `megadj audit returned an invalid JSON summary: ${detail}`,
      {
        cause: error,
      },
    );
  }
  tick(
    1,
    1,
    `archive ${result.audit!.complete}/${result.audit!.total} complete`,
    "done",
    true,
  );
  return result;
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
