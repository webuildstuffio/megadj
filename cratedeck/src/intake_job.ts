// intake_job.ts — the `ingest` job-kind runner (extracted from jobs.ts,
// file-length cap; pre-existing bulk + the intake rev pushed the file over).
// Same seam shape as hygiene_jobs.ts: a plain function taking the engine
// context, so jobs.ts stays the queue/interlock owner and this module only
// renders the intake leg. `drain`/`RunHandle` arrive injected (they are
// private to jobs.ts); everything else imports from leaf modules.
import type { IntakeResult } from "../shared/types";
import { megadjCliPath } from "./intake_run";
import {
  intakeArgs,
  intakePhaseFor,
  INTAKE_FILE_LINE,
  INTAKE_PHASES,
  splitIntakeStdout,
} from "./intake_run";

/** Structural view of the handle jobs.ts owns (cancel flag + proc slot). */
export interface IntakeRunHandle {
  proc?: Bun.Subprocess;
  cancelled: boolean;
}

/** The line-drainer jobs.ts injects (its exported `drain`, so the capture
 *  contract — every byte exactly once — is the regression-tested one). */
export type DrainFn = (
  proc: Bun.Subprocess | ReadableStream<Uint8Array> | number | undefined,
  onLine: (l: string) => void,
  handle?: IntakeRunHandle,
  timeoutMs?: number,
) => Promise<{ out: string }>;

export interface IntakeJobCtx {
  root: string;
  jobTimeoutMin: number;
  drain: DrainFn;
  event: (driveId: string, kind: string, data: Record<string, unknown>) => void;
}

export async function runIntake(
  ctx: IntakeJobCtx,
  folder: string,
  handle: IntakeRunHandle,
  tick: (
    done: number,
    total: number,
    message: string,
    phase: string,
    force?: boolean,
  ) => void,
  log: (line: string, isError?: boolean) => void,
): Promise<IntakeResult> {
  tick(0, 1, `intake from ${folder}`, INTAKE_PHASES[0]!.phase, true);
  const proc = Bun.spawn(
    ["bun", megadjCliPath(ctx.root), ...intakeArgs(folder)],
    { stdout: "pipe", stderr: "pipe", cwd: ctx.root },
  );
  handle.proc = proc;
  // Phase-driven progress off megadj's own log lines (same pattern as
  // verify): markers only ever advance the phase index, so a repeated
  // "[dupe]" can't rewind the bar. Within the enrich phase each per-file
  // row ("  = ok:" / "  ~ f: …") nudges toward 0.9. The human log lands
  // on STDERR in --json mode (progress.ts keeps stdout as the one summary
  // object), so both streams are drained.
  let phaseIdx = 0;
  let enrichBase: number = INTAKE_PHASES[3]!.at;
  let seen = 0;
  const onLine = (l: string): void => {
    log(l);
    const m = intakePhaseFor(l, phaseIdx);
    if (m) {
      phaseIdx = m.nextIdx;
      if (phaseIdx >= 3) enrichBase = m.progress;
      tick(m.progress, 1, m.message, INTAKE_PHASES[phaseIdx]!.phase, true);
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
    ctx.drain(proc, onLine, handle, ctx.jobTimeoutMin * 60_000),
    ctx.drain(proc.stderr, onLine, handle),
  ]);
  await proc.exited;
  if (handle.cancelled) throw new Error("cancelled");
  const errText = typeof errRes === "string" ? errRes : errRes.out;
  if (proc.exitCode !== 0) {
    throw new Error(
      `megadj ingest exited ${proc.exitCode}${
        errText.trim() ? `: ${errText.trim().slice(-400)}` : ""
      }`,
    );
  }
  const { summary } = splitIntakeStdout(res.out);
  const s = (summary ?? {}) as Partial<IntakeResult>;
  // Verify leg: the post-run archive audit (ground truth over every file,
  // not just this batch). Failures land in the result, not a failed job —
  // ingest itself succeeded.
  tick(
    INTAKE_PHASES[5]!.at,
    1,
    "auditing the archive…",
    INTAKE_PHASES[5]!.phase,
    true,
  );
  let audit: IntakeResult["audit"] = null;
  let auditErrors: IntakeResult["auditErrors"] = [];
  const ap = Bun.spawn(["bun", megadjCliPath(ctx.root), "audit", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: ctx.root,
  });
  const aOut = await new Response(ap.stdout).text();
  await ap.exited;
  try {
    const a = JSON.parse(aOut) as {
      total: number;
      complete: number;
      incomplete?: Array<{ file: string; missing: string }>;
    };
    audit = { total: a.total, complete: a.complete };
    auditErrors = a.incomplete ?? [];
  } catch {
    // audit output unreadable — ingest verdict still stands; the summary
    // names it so the UI can show "audit unavailable"
    log("audit leg failed to report — see server log");
  }
  tick(
    1,
    1,
    audit ? `archive ${audit.complete}/${audit.total} complete` : "intake done",
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
  ctx.event("local-archive", "intake", {
    folder,
    files: result.files,
    tagged: result.tagged,
    dupes: result.folderDupes + result.archiveDupes,
    audit: result.audit,
  });
  return result;
}
