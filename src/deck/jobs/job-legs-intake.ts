import type { IntakeResult } from "../shared/types";
import { errMessage as errorText } from "../../shared/leaf/fmt";
import { parseAuditSummary, parseIngestSummary } from "./job-legs-parse";
import type { CrateConfig } from "../config";
import {
  INTAKE_FILE_LINE,
  INTAKE_PHASES,
  intakeArgs,
  intakePhaseFor,
  megadjCliPath,
  splitIntakeStdout,
} from "../intake-run";
import {
  drain,
  type JobLog,
  type JobTick,
  type RunHandle,
} from "./job-runtime";
import type { LegArgs } from "./job-legs-types";

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
  const intake: IntakeResult = { ...counters, audit, auditErrors };
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
    // DEGRADE, don't fail (#260 super-sure live find): the audit is a
    // read-only post-check AFTER the ingest's durable work is done — a
    // truncated/empty child stdout (live Sep 20: job 42a682db died at
    // 97% on JSON.parse("") when the audit bun spawn emitted nothing)
    // marks real imported tracks as a FAILED job and hides them behind
    // an error chip. The IntakeResult wire type already carries
    // `audit: null` for exactly this case; the UI renders an honest
    // "audit unavailable" instead of a fake failure.
    const detail = errorText(error);
    log(`audit leg failed to report — continuing without it: ${detail}`);
    return { audit: null, auditErrors: [] };
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
