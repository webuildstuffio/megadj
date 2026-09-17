// job_legs.ts — the job-kind execution legs (#89 diet extraction from
// job_execution.ts): every runX body that drives a leg's subprocess or
// in-process work. JobEngine owns queueing/lifecycle (jobs.ts); the
// kind→leg dispatch + summary parsers stay in job_execution.ts.
import { basename } from "node:path";
import {
  INTAKE_COUNTER_KEYS,
  type IntakeResult,
  type Job,
} from "../shared/types";
import type { FixesPayload } from "../shared/fixes";
import { errMessage as errorText, fmtBytes } from "../shared/fmt";
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
import { lastLines } from "./verify_report";
import { parseVerifyReport } from "./verify_parse";
import { recordGridHealth } from "./grid_health_routes";
import { summarizeGridHealth } from "./grid_health_parse";
import { runCliJob } from "./cli_job_leg";
/** Same shape as job_execution's JobExecutionDeps — redeclared here (a
 *  3-field wiring record) so the legs never import back from the
 *  dispatcher: the dependency arrow stays one-way (execution → legs). */
interface LegDeps {
  cfg: CrateConfig;
  db: DB;
  guard: Guard;
}

export interface LegArgs {
  deps: LegDeps;
  job: Job;
  mountPoint: string;
  handle: RunHandle;
  tick: JobTick;
  log: JobLog;
}

type IntakeCounters = Omit<IntakeResult, "audit" | "auditErrors">;

/** Numeric summaries cross a subprocess JSON boundary; counts are integers. */
export function finiteJobNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("job summary count must be a safe non-negative integer");
  return value;
}
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
  // Iterate THE key list (cratedeck/shared/types.ts SSOT, issue #159) —
  // a counter added to IntakeResult is parsed automatically; a counter
  // the producer stopped emitting fails HERE with its key named.
  return Object.fromEntries(
    INTAKE_COUNTER_KEYS.map((key) => {
      try {
        return [key, finiteJobNumber(summary[key])] as const;
      } catch (error) {
        throw new Error(
          `megadj ingest summary ${key} is invalid: ${errorText(error)}`,
          { cause: error },
        );
      }
    }),
  ) as IntakeCounters;
}

export function parseAuditSummary(
  output: string,
): Pick<IntakeResult, "audit" | "auditErrors"> {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch (error) {
    throw new Error(`malformed JSON: ${errorText(error)}`, { cause: error });
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

export async function runScan({
  deps,
  job,
  mountPoint,
  handle,
  tick,
}: LegArgs) {
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

export async function runVerify({
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

export async function runMirror({ deps, handle, tick, log }: LegArgs) {
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

export async function runIngest({
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
    const detail = errorText(error);
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

export async function runBenchmark({
  deps,
  job,
  mountPoint,
  handle,
  tick,
}: LegArgs) {
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

export async function runChecksum({
  deps,
  job,
  mountPoint,
  handle,
  tick,
}: LegArgs) {
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

export async function runSpeedtest({
  deps,
  job,
  mountPoint,
  handle,
  tick,
}: LegArgs) {
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

/** grid-health leg (#167, GA-05c): spawn `megadj rb-grid-triage --json`
 *  over the SHELF (the engine SSOT) and record the summary for the
 *  /api/grid-health reads. The mountPoint arg is the shelf volume the
 *  enqueue passed; the CLI triages the shelf's master DB. Runs through
 *  the ONE CLI spawn seam (runCliJob) — no second hand-rolled drain. */
export async function runGridHealth(args: LegArgs) {
  const summary = await runCliJob(
    cliDeps(args),
    {
      command: "rb-grid-triage",
      label: "megadj rb-grid-triage",
      argv: [args.mountPoint, "--json"],
    },
    false,
    args.handle,
  );
  const payload = summarizeGridHealth(
    summary,
    args.job.drive_id,
    args.deps.db.getDrive(args.job.drive_id)?.nickname ??
      args.deps.db.getDrive(args.job.drive_id)?.name ??
      args.job.drive_id,
  );
  recordGridHealth(args.job.drive_id, payload);
  args.deps.db.event(args.job.drive_id, "grid-health", {
    audited: payload.audited,
    offenders:
      payload.buckets.SHIFT +
      payload.buckets.PHASE +
      payload.buckets.TEMPO +
      payload.buckets.DRIFT +
      payload.buckets.CHAOS,
    syncIssues: payload.syncIssues,
  });
  args.tick(
    1,
    1,
    `${payload.audited}/${payload.total} audited · ${payload.offenders.length} flagged`,
    "done",
    true,
  );
  return payload;
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

export async function runHygiene(args: LegArgs, apply: boolean) {
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

export async function runFixes(args: LegArgs, apply: boolean) {
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
