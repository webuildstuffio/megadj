// fixes_jobs.ts — the fixes-scan / fixes-apply job legs. The shared
// spawn/drain/summary runner lives in cli_job_leg.ts (one implementation;
// this module was its byte-twin until jscpd flagged it). Scope: booth-fix
// runs against the shelf Contents when mountPoint is a shelf volume
// (MEGADJ_MUSIC_DIR).
import { runCliJobLeg, summaryCount, type CliJobDeps } from "./cli-job-leg";

/** Kept as a named alias — the deps shape is the shared CliJobDeps. */
export type FixesJobDeps = CliJobDeps;

/** Shared runner. apply=false is the dry-run (plan only); apply=true is
 *  booth-fix --apply --yes (the safe subset: renames + tag sanitization).
 *  Phase open/close + tick assembly live in runCliJobLeg (#98). */
async function runBoothFix(
  deps: FixesJobDeps,
  musicDir: string,
  apply: boolean,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  const summary = await runCliJobLeg(
    deps,
    {
      command: "booth-fix",
      label: "megadj booth-fix",
      argv: [...(apply ? ["--apply", "--yes"] : []), "--json"],
      env: { MEGADJ_MUSIC_DIR: musicDir },
      scan: { message: "auditing booth compatibility…", phase: "scan" },
      apply: { message: "applying safe fixes…", phase: "apply" },
    },
    apply,
    handle,
  );
  const tick = (m: string, phase: string): void =>
    deps.tick(0, 1, m, phase, true);
  const fixable = summaryCount(summary?.fixable);
  const applied = summaryCount(summary?.applied);
  tick(apply ? `applied ${applied} fix(es)` : `${fixable} fixable`, "done");
  return summary;
}

/** fixes-scan: dry-run booth-fix over the drive's Contents → plan rows. */
export function runFixesScan(
  deps: FixesJobDeps,
  musicDir: string,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  return runBoothFix(deps, musicDir, false, handle);
}

/** fixes-apply: executes the SAFE subset (renames + tag rewrites; the
 *  "none" action rows are proposals, never auto-executed). */
export function runFixesApply(
  deps: FixesJobDeps,
  musicDir: string,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  return runBoothFix(deps, musicDir, true, handle);
}
