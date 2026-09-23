// cohorts.ts — the genre-cohort PLAN engine (#295), extracted from the
// CLI spoke so every surface shares ONE build path (the megadj rule:
// one source of truth per shared surface — engine + census + route +
// MCP + web all call this). Pure over an OPEN ArchiveReader: no config
// loads, no env reads, no clock (except the caller's timing), no stdout.
//
// Honesty rules (inherited from #295's CLI contract):
// - blank-genre rows are OUTSIDE SCOPE — never guessed into a family;
// - a family that matches zero rows still reports (pool 0, complete
//   false) — a gap is visible, never silently skipped;
// - an arm that can't fill the budget keeps its shortfall visible.
//
// The CLI wraps this with logging + exit codes; the API route wraps it
// with json(); the MCP tool aims callers at the route. None re-derive
// the plan.
import { buildMegaset } from "./engine";
import {
  clampMegasetPool,
  MEGASET_GENRE_FAMILIES,
  MEGASET_COHORT_FAMILIES,
  MEGASET_PRESET_DEFS,
} from "../shared/types";

/** One warmup-or-peak build for one family — the per-arm honesty fields
 *  (shortfall + diversity report card ride per arm so a family-wide
 *  artist cluster is visible without re-running the single-set build). */
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

/** One cohort's outcome: the warmup + peak pair under one family id. */
export interface CohortResult {
  family: string;
  warmup: CohortBuild;
  peak: CohortBuild;
}

/** The full plan — the wire shape every surface quotes. */
export interface CohortPlan {
  minutes: number;
  families: readonly string[];
  cohorts: CohortResult[];
  /** True when every arm of every family filled the budget. */
  allComplete: boolean;
  /** Blank-genre rows are correctly UNCLAIMED by any cohort — the
   *  honest-gap rule (#290 class): never guessed into a family. */
  blankGenreNote: string;
  /** Measured wall-clock for the whole plan (ms) — the caller's timing
   *  rides on the wire, never a fixed schedule. */
  elapsedMs: number;
}

export interface CohortPlanInput {
  minutes: number;
  /** Validated family ids (keys of MEGASET_GENRE_FAMILIES). Absent =
   *  the curated default cohort list. */
  families?: readonly string[] | undefined;
  limit?: number | undefined;
}

/** Validate + normalize a raw families list (CLI flag / query param /
 *  MCP arg): unknown ids are an ERROR (never a silent skip — the same
 *  contract as an unknown preset), and an explicit-but-empty list is an
 *  ERROR too (the old CLI twin silently ran zero cohorts and exited 0 —
 *  a no-op dressed as success). Null/undefined = the curated default. */
export function parseCohortFamilies(
  raw: string | null | undefined,
): { families: string[] } | { error: string } {
  if (raw === null || raw === undefined)
    return { families: [...MEGASET_COHORT_FAMILIES] };
  const requested = raw
    .split(",")
    .map((f) => f.trim().toLowerCase())
    .filter((f) => f !== "");
  if (requested.length === 0) {
    return {
      error:
        "families resolved to an empty list — name at least one family or omit the flag for the default four",
    };
  }
  const unknown = requested.filter((f) => !(f in MEGASET_GENRE_FAMILIES));
  if (unknown.length > 0) {
    return {
      error: `unknown genre family: ${unknown.join(", ")} — known: ${Object.keys(MEGASET_GENRE_FAMILIES).join(", ")}`,
    };
  }
  return { families: requested };
}

/** One warmup-or-peak build for one family, through the SAME census +
 *  engine the single-set build uses. The reader is passed in (the
 *  caller owns its lifecycle — the route keeps ONE open across the
 *  whole plan instead of the CLI's old 2-per-family reopen). */
export function buildCohortArm(
  archive: {
    setCandidates: (
      limit?: number | undefined,
      genre?: string | undefined,
    ) => {
      candidates: Parameters<typeof buildMegaset>[0]["candidates"];
      genreFiltered: number;
      total: number;
    };
  },
  family: string,
  presetId: "warmup" | "peak",
  minutes: number,
  limit?: number | undefined,
): CohortBuild {
  const census = archive.setCandidates(
    limit === undefined ? undefined : clampMegasetPool(limit),
    family,
  );
  // the preset registry is a table of defs — resolve the arm id to the
  // SAME def the engine scores against (no string leaks into the engine)
  const presetDef = MEGASET_PRESET_DEFS.find((p) => p.id === presetId);
  if (presetDef === undefined) {
    throw new Error(`cohort arm preset "${presetId}" is not in the registry`);
  }
  const built = buildMegaset({
    candidates: census.candidates,
    preset: presetDef,
    minutes,
  });
  return {
    preset: presetId,
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
}

/** The full warmup+peak plan over an OPEN reader. Times itself (wall
 *  clock) — the elapsedMs on the plan is MEASURED, never a schedule. */
export function buildCohortPlan(
  archive: Parameters<typeof buildCohortArm>[0],
  input: CohortPlanInput,
): CohortPlan {
  const families: readonly string[] =
    input.families ??
    (() => {
      const parsed = parseCohortFamilies(null);
      return "families" in parsed ? parsed.families : [];
    })();
  const t0 = Date.now();
  const cohorts: CohortResult[] = [];
  let allComplete = true;
  for (const family of families) {
    const warmup = buildCohortArm(
      archive,
      family,
      "warmup",
      input.minutes,
      input.limit,
    );
    const peak = buildCohortArm(
      archive,
      family,
      "peak",
      input.minutes,
      input.limit,
    );
    if (!warmup.complete || !peak.complete) allComplete = false;
    cohorts.push({ family, warmup, peak });
  }
  return {
    minutes: input.minutes,
    families,
    cohorts,
    allComplete,
    blankGenreNote:
      "tracks with no genre tag are outside every cohort's scope by design (missing genre = honest gap, never a guess)",
    elapsedMs: Date.now() - t0,
  };
}
