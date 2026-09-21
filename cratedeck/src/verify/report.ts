// verify_report.ts — turning usb_verify.py output into explained verdicts.
// Split from jobs.ts: the JobEngine runs jobs; THIS file owns the contract
// between usb_verify.py's human/JSON output and the structured report the
// UI, CLI, and tests consume. Pure functions only — no I/O, no engine.
import type { VerifyDelta, VerifyReport } from "../../shared/types";

export function lastLines(text: string, n: number): string {
  return text.split("\n").filter(Boolean).slice(-n).join("\n");
}

/** The failed checks of a verify report — callers read VerifyCheck directly
 *  (see verify_report.test.ts for the meaning+fix contract). */

/** The usb_verify.py structured payload (the "VERIFY_JSON: {...}" line). */

/**
 * Normalize a PERSISTED verify report to the honest shape.
 *
 * Legacy reports written before the crash guard can carry the defect this
 * file exists to kill: a run that crashed mid-script stored ok:false with
 * ZERO failing checks (or a green "all ? tracks" fields line, or a raw
 * Python traceback as the summary). Those rows read as a real verdict to
 * every consumer — UI "0 of 0 checks", badge logic, deltas — so a crash
 * masqueraded as a measured (almost-healthy) drive. This pass re-marks
 * them: no FINAL line + no failing checks ⇒ exactly one script-failed
 * check, traceback stripped from the readable surface. Pure function —
 * applied on read in db.getVerifyReport, so old rows heal in place
 * without a migration.
 */
export function sanitizeVerifyReport(r: VerifyReport): VerifyReport {
  if (r.final !== null) return r; // a completed run: trust it as stored
  const failing = r.checks.filter((c) => c.status !== "pass");
  if (failing.length > 0) return r; // already honest (or another failure mode)
  const summary = r.summary ?? "";
  const isTraceback = summary.includes("Traceback (most recent call last)");
  const tail = isTraceback
    ? "run crashed with an error (traceback in the job log)"
    : "verify script crashed before producing a verdict";
  const withCrash: VerifyReport = {
    ...r,
    ok: false,
    checks: [
      ...r.checks,
      {
        id: "script-failed",
        label: "Verify script itself",
        status: "fail",
        detail: `${tail} — no checks were measured`,
        meaning:
          "A verify that crashes halfway measured nothing; the drive state is UNKNOWN, not almost-healthy. Re-run verify once the drive is mounted.",
        fix: "Re-run verify with the drive mounted and rekordbox closed; if it crashes again, check the job log for the underlying error.",
      },
    ],
  };
  return withCrash;
}

/** Compare a fresh verify report against the previously stored one:
 *  per-check offender-count deltas so the UI can show "2 new broken grids
 *  since last run" instead of making the user re-derive that themselves. */
export function verifyDeltas(
  prev: VerifyReport | null,
  next: VerifyReport,
): VerifyDelta[] {
  if (!prev) return [];
  const prevBy = new Map(prev.checks.map((c) => [c.id, c]));
  const deltas: VerifyDelta[] = [];
  for (const c of next.checks) {
    if (c.id === "pioneer-variance") continue; // informational, not tracked
    const p = prevBy.get(c.id);
    if (!p && c.status === "pass") continue; // newly available healthy check
    const count = c.offender_count ?? 0;
    const prevCount =
      p?.offender_count ??
      // legacy reports had no offender_count — derive from detail via status
      (p ? (p.status === "pass" ? 0 : NaN) : 0);
    if (Number.isNaN(prevCount)) continue; // can't compare legacy fails
    if (count !== prevCount || p?.status !== c.status) {
      deltas.push({
        check_id: c.id,
        label: c.label,
        delta: count - prevCount,
        prev_status: p?.status ?? null,
        prev_count: prevCount,
        count,
      });
    }
  }
  return deltas;
}
