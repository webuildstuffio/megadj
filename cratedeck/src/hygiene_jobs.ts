// hygiene_jobs.ts — the hygiene-scan / hygiene-apply job legs (§5 P2),
// extracted from jobs.ts (file-length guard). The shared spawn/drain/
// summary runner lives in cli_job_leg.ts (one implementation; this module
// was its byte-twin until jscpd flagged it).
import { runCliJob, type CliJobDeps } from "./cli_job_leg";

/** Kept as a named alias — the deps shape is the shared CliJobDeps. */
export type HygieneJobDeps = CliJobDeps;

/** Shared runner for both legs. Returns the CLI's trailing JSON summary. */
async function runShelfHygiene(
  deps: HygieneJobDeps,
  shelfVolume: string,
  apply: boolean,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  const tick = (m: string, phase: string): void =>
    deps.tick(0, 1, m, phase, true);
  tick(
    apply ? "applying confirmed findings…" : "walking the shelf…",
    apply ? "apply" : "walk",
  );
  const summary = await runCliJob(
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
    },
    apply,
    handle,
  );
  const detected = Number(summary?.detected ?? 0);
  const applied = Number(summary?.applied ?? 0);
  const failed = Number(summary?.failed ?? 0);
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
