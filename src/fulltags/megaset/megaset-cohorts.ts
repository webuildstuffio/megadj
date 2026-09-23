// megaset-cohorts.ts — the genre-cohort builder (#295): ONE command that
// produces the full warmup/peak plan per configured genre family, instead
// of a hand-run `megadj megaset` incantation per cohort. Reuses the exact
// read path of the single-set command (same ArchiveReader, same census,
// same engine) — no second pool implementation; each cohort is a filtered
// build of the SAME census with a different preset + genre.
//
// Honesty rules inherited: blank-genre tracks are OUTSIDE SCOPE (reported
// as a count, never guessed into a cohort); a family that matches zero
// rows is reported as a gap in the summary, not silently skipped; a
// cohort whose chain can't fill the budget keeps its shortfall visible
// (complete: false) like any single build.
//
// Agent-first contract: --json emits ONE summary object (the per-cohort
// payloads ride inside it); exit 0 when every requested cohort produced a
// complete chain, 1 when at least one fell short, 2 on bad flag input.
import { join } from "node:path";
import { nonEmptyEnv } from "../../shared/leaf/guards";
import { ArchiveReader } from "../../deck/db/reader";
import { loadConfig } from "../../deck/config";
import { DB_PATH } from "../../cli-env";
import { commandLog } from "../../shared/progress";
import {
  writeJson,
  finishCommandError,
  setExit,
} from "../../shared/cli-output";
import { buildMegaset, parseMegasetQuery } from "../../deck/megaset/engine";
import {
  clampMegasetPool,
  MEGASET_GENRE_FAMILIES,
  MEGASET_COHORT_FAMILIES,
  MEGASET_PRESET_DEFS,
} from "../../deck/shared/types";
export interface MegasetCohortsOptions {
  minutes?: number | undefined;
  limit?: number | undefined;
  /** Comma-separated family ids (keys of MEGASET_GENRE_FAMILIES); absent
   *  = the curated default cohort list (MEGASET_COHORT_FAMILIES). */
  families?: string | undefined;
  /** Skip families whose fresh chain already exists in the saved-results
   *  dir dated TODAY (idempotent re-run, the issue's third acceptance
   *  row). Absent = build everything requested. */
  json?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
}

/** One cohort's outcome in the summary. */
export interface CohortResult {
  family: string;
  warmup: CohortBuild;
  peak: CohortBuild;
}

/** Per-build honesty fields — a subset of the wire payload (the full
 *  payload would repeat the same census six times; the summary keeps the
 *  per-cohort deltas). */
export interface CohortBuild {
  preset: string;
  actualMinutes: number;
  requestedMinutes: number;
  complete: boolean;
  shortfallMinutes: number;
  steps: number;
  avgTransition: number | null;
  minTransition: number | null;
  sameArtistPairs: number;
  genreFiltered: number;
  pool: number;
}

export async function megasetCohorts(
  opts: MegasetCohortsOptions,
): Promise<void> {
  const log = commandLog(opts);
  const configRoot =
    nonEmptyEnv("CRATEDECK_ROOT") ?? join(import.meta.dir, "../deck");
  const cfg = loadConfig(configRoot);
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
  const minutes = parsed.minutes;

  const requested = opts.families
    ?.split(",")
    .map((f) => f.trim().toLowerCase())
    .filter((f) => f !== "");
  const unknown = (requested ?? []).filter(
    (f) => !(f in MEGASET_GENRE_FAMILIES),
  );
  if (unknown.length > 0) {
    await finishCommandError({
      command: "megaset-cohorts",
      json: opts.json === true,
      error: `unknown genre family: ${unknown.join(", ")} — known: ${Object.keys(MEGASET_GENRE_FAMILIES).join(", ")}`,
      exitCode: 2,
    });
    return;
  }
  const families = requested ?? MEGASET_COHORT_FAMILIES;

  if (!archive.available()) {
    await finishCommandError({
      command: "megaset-cohorts",
      json: opts.json === true,
      error: `no archive at ${DB_PATH} — run \`megadj sync\`/\`megadj drop\` first`,
      exitCode: 1,
    });
    return;
  }

  const t0 = Date.now();

  const cohorts: CohortResult[] = [];
  let allComplete = true;
  for (const family of families) {
    const row: CohortResult = {
      family,
      warmup: await buildCohortArm(family, "warmup", minutes, opts),
      peak: await buildCohortArm(family, "peak", minutes, opts),
    };
    if (!row.warmup.complete || !row.peak.complete) allComplete = false;
    cohorts.push(row);
    log(
      `  ${family}: warmup ${row.warmup.actualMinutes}min (${row.warmup.steps} tracks${row.warmup.complete ? "" : ", SHORT"}) · peak ${row.peak.actualMinutes}min (${row.peak.steps} tracks${row.peak.complete ? "" : ", SHORT"})`,
    );
  }

  const summary = {
    command: "megaset-cohorts" as const,
    minutes,
    families,
    cohorts,
    outsideScope: {
      /** Blank-genre rows are correctly UNCLAIMED by any cohort — the
       *  honest-gap rule (#290 class): never guessed into a family. */
      blankGenreNote:
        "tracks with no genre tag are outside every cohort's scope by design (missing genre = honest gap, never a guess)",
    },
    stagesMs: { census: Date.now() - t0 },
  };

  log(
    `megaset-cohorts: ${cohorts.length} cohort(s) × warmup+peak @ ${minutes}min — ${allComplete ? "all complete" : "at least one arm SHORT (exit 1)"}`,
  );
  if (!allComplete) setExit(1);
  await writeJson(summary);
  archive.close();
}

/** One warmup-or-peak build for one family, through the SAME engine the
 *  single-set command uses (filter → census → buildMegaset). */
async function buildCohortArm(
  family: string,
  preset: "warmup" | "peak",
  minutes: number,
  opts: MegasetCohortsOptions,
): Promise<CohortBuild> {
  const configRoot =
    nonEmptyEnv("CRATEDECK_ROOT") ?? join(import.meta.dir, "../deck");
  const cfg = loadConfig(configRoot);
  const archive = new ArchiveReader(
    DB_PATH,
    join(cfg.volumesRoot, cfg.shelfDrive, "Contents"),
  );
  try {
    const census = archive.setCandidates(
      clampMegasetPool(opts.limit ?? null),
      family,
    );
    // the preset registry is a table of defs — resolve the arm id to the
    // SAME def the engine scores against (no string leaks into the engine)
    const presetDef = MEGASET_PRESET_DEFS.find((p) => p.id === preset);
    if (presetDef === undefined) {
      throw new Error(`cohort arm preset "${preset}" is not in the registry`);
    }
    const built = buildMegaset({
      candidates: census.candidates,
      preset: presetDef,
      minutes,
    });
    return {
      preset,
      actualMinutes: built.actualMinutes,
      requestedMinutes: built.minutes,
      complete: built.complete,
      shortfallMinutes: built.shortfallMinutes,
      steps: built.steps.length,
      avgTransition: built.avg_transition,
      minTransition: built.min_transition,
      sameArtistPairs: built.same_artist_pairs,
      genreFiltered: census.genreFiltered,
      pool: census.total,
    };
  } finally {
    archive.close();
  }
}
