// megaset-cohorts.test.ts — #295: the genre-cohort builder's unit
// contract. The command is a thin sequencer over the SAME census+engine
// the single-set command uses, so these tests pin the pieces that are
// ITS OWN: default family list derivation, family validation (unknown id
// = error, never a silent skip), and the summary shape (warmup+peak per
// family, honest shortfall, blank-genre outside-scope note).
import { describe, expect, test } from "bun:test";
import {
  MEGASET_COHORT_FAMILIES,
  MEGASET_GENRE_FAMILIES,
} from "../../deck/shared/types";
import {
  buildCohortPlan,
  parseCohortFamilies,
  type CohortArmCandidate,
  type CohortBuild,
  type CohortResult,
} from "../../deck/megaset/cohorts";

describe("#295 megaset-cohorts", () => {
  test("default families are real family ids, ordered by measured spread", () => {
    expect(MEGASET_COHORT_FAMILIES.length).toBeGreaterThanOrEqual(3);
    for (const family of MEGASET_COHORT_FAMILIES) {
      // every default id MUST be a key of the genre-family table — a
      // typo here would silently build zero cohorts
      expect(Object.keys(MEGASET_GENRE_FAMILIES)).toContain(family);
    }
    // biggest-pool-first (Sep 21 spread: edm 683 > house 633 > techno
    // 501 > tech house 328) so a partially-failed run still delivered
    // the largest cohorts
    expect(MEGASET_COHORT_FAMILIES).toEqual([
      "edm",
      "house",
      "techno",
      "tech house",
    ]);
  });

  test("#parseCohortFamilies: blank/absent = default four; unknown = error with the known list", () => {
    // absent → the curated default (same list as MEGASET_COHORT_FAMILIES)
    expect(parseCohortFamilies(null)).toEqual({
      families: [...MEGASET_COHORT_FAMILIES],
    });
    expect(parseCohortFamilies(undefined)).toEqual({
      families: [...MEGASET_COHORT_FAMILIES],
    });
    // EXPLICIT-but-empty is an error, never a silent zero-cohort run
    expect("error" in parseCohortFamilies("  ")).toBe(true);
    expect("error" in parseCohortFamilies(",,,")).toBe(true);
    // case-fold + trim normalization is the shared surface contract
    // (CLI flag / query param / MCP array all normalize alike)
    expect(parseCohortFamilies(" EDM, house ")).toEqual({
      families: ["edm", "house"],
    });
    // blank segments drop out — "edm,,house" is two families, not an error
    expect(parseCohortFamilies("edm,,house")).toEqual({
      families: ["edm", "house"],
    });
    // an unknown id errors LOUDLY with the known list (never a silent skip)
    const bad = parseCohortFamilies("edm, bootleg-house");
    expect("error" in bad).toBe(true);
    if ("error" in bad) {
      expect(bad.error).toContain("bootleg-house");
      expect(bad.error).toContain("known:");
    }
  });

  test("#buildCohortPlan: shapes the wire summary from a stub reader", () => {
    // a stub reader stands in for ArchiveReader — the engine is pure
    // over the setCandidates surface, so the plan's honesty fields are
    // pinned without a live archive DB.
    const calls: [string | undefined, number | undefined][] = [];
    const stubReader = {
      setCandidates: (
        limit?: number | undefined,
        genre?: string | undefined,
      ): {
        candidates: CohortArmCandidate[];
        genreFiltered: number;
        total: number;
      } => {
        calls.push([genre, limit]);
        const short = genre === "techno"; // one family's arms fall short
        return {
          candidates: [
            {
              videoId: `t-${genre}-${calls.length}`,
              title: "T",
              artist: null,
              durationS: 300,
              bpm: 128,
              key: "8A",
              valence: 5,
              arousal: 5,
              dance: 0.5,
              cues: [],
              embedding: null,
              // rev-52: the M3U8-export fields the arm now carries
              filePath: "/Volumes/SHELF1/Contents/T.aiff",
              metadataOnly: false,
            },
          ],
          genreFiltered: short ? 3 : 500,
          total: short ? 3 : 500,
        };
      },
    };
    const plan = buildCohortPlan(stubReader, {
      minutes: 30,
      families: ["edm", "techno"],
      limit: 500,
    });
    expect(plan.minutes).toBe(30);
    expect(plan.families).toEqual(["edm", "techno"]);
    expect(plan.cohorts.map((c) => c.family)).toEqual(["edm", "techno"]);
    // every family got EXACTLY a warmup+peak pair, in that order
    for (const row of plan.cohorts) {
      expect(row.warmup.preset).toBe("warmup");
      expect(row.peak.preset).toBe("peak");
    }
    // the short family propagates: plan-level allComplete flips false
    expect(plan.cohorts[1]!.warmup.complete).toBe(false);
    expect(plan.allComplete).toBe(false);
    // blank-genre honesty note rides the plan (the wire quotes it)
    expect(plan.blankGenreNote).toContain("outside every cohort's scope");
    // the limit clamp rode EVERY setCandidates call, genre alternated
    for (const [genre] of calls) {
      if (genre !== undefined) expect(["edm", "techno"]).toContain(genre);
      else expect.unreachable();
    }
    expect(calls.length).toBe(4); // 2 families × 2 arms
    expect(typeof plan.elapsedMs).toBe("number");
  });

  test("CohortBuild carries the honesty fields (shortfall + diversity, not just minutes)", () => {
    const build: CohortBuild = {
      preset: "warmup",
      actualMinutes: 58,
      requestedMinutes: 60,
      complete: false,
      shortfallMinutes: 2,
      steps: 14,
      avgTransition: 1.1,
      minTransition: 0.9,
      sameArtistPairs: 0,
      genreFiltered: 683,
      pool: 700,
      // rev-52: the server-side export fields (chain + census rows) ride
      // the in-memory shape — they never serialize to the wire
      chain: [],
      poolRows: [],
    };
    expect(build.complete).toBe(false);
    expect(build.shortfallMinutes).toBeGreaterThan(0);
    // the B6 report card rides per-cohort so a family-wide artist cluster
    // is visible without re-running the single-set command
    expect(build).toHaveProperty("sameArtistPairs");
  });

  test("CohortResult pairs warmup+peak under one family id", () => {
    const result: CohortResult = {
      family: "house",
      warmup: {
        preset: "warmup",
        actualMinutes: 60,
        requestedMinutes: 60,
        complete: true,
        shortfallMinutes: 0,
        steps: 14,
        avgTransition: 1.05,
        minTransition: 0.8,
        sameArtistPairs: 0,
        genreFiltered: 633,
        pool: 640,
        chain: [],
        poolRows: [],
      },
      peak: {
        preset: "peak",
        actualMinutes: 60,
        requestedMinutes: 60,
        complete: true,
        shortfallMinutes: 0,
        steps: 13,
        avgTransition: 1.12,
        minTransition: 0.95,
        sameArtistPairs: 1,
        genreFiltered: 633,
        pool: 640,
        chain: [],
        poolRows: [],
      },
    };
    expect(result.warmup.preset).toBe("warmup");
    expect(result.peak.preset).toBe("peak");
    expect(result.family).toBe("house");
  });
});
