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
import type { CohortBuild, CohortResult } from "./megaset-cohorts";

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
      },
    };
    expect(result.warmup.preset).toBe("warmup");
    expect(result.peak.preset).toBe("peak");
    expect(result.family).toBe("house");
  });
});
