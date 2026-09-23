// hygiene_jobs.ts — the hygiene-scan / hygiene-apply job legs (§5 P2),
// extracted from jobs.ts (file-length guard). The shared spawn/drain/
// summary runner lives in cli_job_leg.ts (one implementation; this module
// was its byte-twin until jscpd flagged it).
import {
  runCliJobLeg,
  summaryCount,
  type CliJobDeps,
} from "../jobs/cli-job-leg";

/** Kept as a named alias — the deps shape is the shared CliJobDeps. */
export type HygieneJobDeps = CliJobDeps;

/** Shared runner for both legs. Returns the CLI's trailing JSON summary.
 *  Phase open/close + tick assembly live in runCliJobLeg (#98). */
async function runShelfHygiene(
  deps: HygieneJobDeps,
  shelfVolume: string,
  apply: boolean,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  const summary = await runCliJobLeg(
    deps,
    {
      command: "shelf-hygiene",
      label: "megadj shelf-hygiene",
      argv: [
        ...(apply ? ["--apply", "--yes"] : []),
        "--json",
        "--shelf",
        shelfVolume,
      ],
      scan: { message: "walking the shelf…", phase: "walk" },
      apply: { message: "applying confirmed findings…", phase: "apply" },
    },
    apply,
    handle,
  );
  const tick = (m: string, phase: string): void =>
    deps.tick(0, 1, m, phase, true);
  const detected = summaryCount(summary?.detected);
  const applied = summaryCount(summary?.applied);
  const failed = summaryCount(summary?.failed);
  tick(
    apply ? `applied ${applied}, failed ${failed}` : `${detected} findings`,
    "done",
  );
  return summary;
}

/** hygiene-scan: detect + upsert findings; census → result_json. */
export function runHygieneScan(
  deps: HygieneJobDeps,
  shelfVolume: string,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  return runShelfHygiene(deps, shelfVolume, false, handle);
}

/** hygiene-apply: executes CONFIRMED findings only (the confirm step IS
 *  the human gate). Quarantine-only, never deletes; receipts land on rows. */
export function runHygieneApply(
  deps: HygieneJobDeps,
  shelfVolume: string,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  return runShelfHygiene(deps, shelfVolume, true, handle);
}
