// fixes_jobs.ts — the fixes-scan / fixes-apply job legs. The shared
// spawn/drain/summary runner lives in cli_job_leg.ts (one implementation;
// this module was its byte-twin until jscpd flagged it). Scope: booth-fix
// runs against the shelf Contents when mountPoint is a shelf volume
// (MEGADJ_MUSIC_DIR).
import { runCliJob, type CliJobDeps } from "./cli_job_leg";

/** Kept as a named alias — the deps shape is the shared CliJobDeps. */
export type FixesJobDeps = CliJobDeps;

/** Shared runner. apply=false is the dry-run (plan only); apply=true is
 *  booth-fix --apply --yes (the safe subset: renames + tag sanitization). */
async function runBoothFix(
  deps: FixesJobDeps,
  musicDir: string,
  apply: boolean,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  const tick = (m: string, phase: string): void =>
    deps.tick(0, 1, m, phase, true);
  tick(
    apply ? "applying safe fixes…" : "auditing booth compatibility…",
    apply ? "apply" : "scan",
  );
  const summary = await runCliJob(
    deps,
    {
      command: "booth-fix",
      label: "megadj booth-fix",
      argv: [...(apply ? ["--apply", "--yes"] : []), "--json"],
      env: { MEGADJ_MUSIC_DIR: musicDir },
    },
    apply,
    handle,
  );
  const fixable = Number(summary?.fixable ?? 0);
  const applied = Number(summary?.applied ?? 0);
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
