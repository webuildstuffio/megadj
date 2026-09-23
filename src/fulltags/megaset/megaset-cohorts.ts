// megaset-cohorts.ts — the genre-cohort builder CLI spoke (#295): ONE
// command that produces the full warmup/peak plan per genre family,
// instead of a hand-run `megadj megaset` incantation per cohort.
//
// The PLAN ENGINE lives in deck/megaset/cohorts.ts (surface-neutral) —
// this spoke owns only the CLI contract: human logs, --json via
// writeJson, exit codes (0 complete plan · 1 an arm fell short · 2 bad
// input). The API route and MCP tool wrap the SAME engine, never a
// re-derivation.
//
// Honesty rules (inherited from the engine): blank-genre rows are
// OUTSIDE SCOPE (reported, never guessed); a family that matches zero
// rows still reports (pool 0, complete false); a short arm keeps its
// shortfall visible and drops the exit to 1.
import { join } from "node:path";
import { ArchiveReader } from "../../deck/db/reader";
import { loadConfig } from "../../deck/config";
import { DB_PATH } from "../../cli-env";
import { commandLog } from "../../shared/progress";
import { crateDeckRoot } from "../../shared/volume";
import {
  writeJson,
  finishCommandError,
  setExit,
} from "../../shared/cli-output";
import { parseMegasetQuery } from "../../deck/megaset/engine";
import {
  buildCohortPlan,
  parseCohortFamilies,
} from "../../deck/megaset/cohorts";

export interface MegasetCohortsOptions {
  minutes?: number | undefined;
  limit?: number | undefined;
  /** Comma-separated family ids (keys of MEGASET_GENRE_FAMILIES); absent
   *  = the curated default cohort list (MEGASET_COHORT_FAMILIES). */
  families?: string | undefined;
  json?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
}

export async function megasetCohorts(
  opts: MegasetCohortsOptions,
): Promise<void> {
  const log = commandLog(opts);
  const cfg = loadConfig(crateDeckRoot());
  const archive = new ArchiveReader(
    DB_PATH,
    join(cfg.volumesRoot, cfg.shelfDrive, "Contents"),
  );

  // minutes: same clamp/parse as the single-set command (10–240)
  const parsed = parseMegasetQuery({
    preset: "peak",
    minutes: opts.minutes ?? null,
  });
  if ("error" in parsed) {
    await finishCommandError({
      command: "megaset-cohorts",
      json: opts.json === true,
      error: parsed.error,
      exitCode: 2,
    });
    return;
  }

  // family validation lives in the SHARED engine parse (same error text
  // the route + MCP tool surface — one message, three surfaces)
  const families = parseCohortFamilies(opts.families);
  if ("error" in families) {
    await finishCommandError({
      command: "megaset-cohorts",
      json: opts.json === true,
      error: families.error,
      exitCode: 2,
    });
    return;
  }

  if (!archive.available()) {
    await finishCommandError({
      command: "megaset-cohorts",
      json: opts.json === true,
      error: `no archive at ${DB_PATH} — run \`megadj sync\`/\`megadj drop\` first`,
      exitCode: 1,
    });
    return;
  }

  const plan = buildCohortPlan(archive, {
    minutes: parsed.minutes,
    families: families.families,
    limit: opts.limit,
  });

  for (const row of plan.cohorts) {
    log(
      `  ${row.family}: warmup ${row.warmup.actualMinutes}min (${row.warmup.steps} tracks${row.warmup.complete ? "" : ", SHORT"}) · peak ${row.peak.actualMinutes}min (${row.peak.steps} tracks${row.peak.complete ? "" : ", SHORT"})`,
    );
  }
  log(
    `megaset-cohorts: ${plan.cohorts.length} cohort(s) × warmup+peak @ ${plan.minutes}min — ${plan.allComplete ? "all complete" : "at least one arm SHORT (exit 1)"}`,
  );
  if (!plan.allComplete) setExit(1);
  await writeJson({
    command: "megaset-cohorts" as const,
    minutes: plan.minutes,
    families: plan.families,
    cohorts: plan.cohorts,
    allComplete: plan.allComplete,
    outsideScope: {
      blankGenreNote: plan.blankGenreNote,
    },
    stagesMs: { plan: plan.elapsedMs },
  });
  archive.close();
}
