// megaset.test.ts — #283: the megaset genre pool filter (shared seam).
// Pins the shared family matcher (megasetGenreTerms) and the pool
// builder's SQL LIKE filter (setCandidates with a genre arg). The live
// tropical-house set (r.play) is the acceptance evidence, not a fixture.

import { describe, expect, test } from "bun:test";
import {
  megasetGenreTerms,
  megasetReasonClass,
  megasetTransitionBand,
  MEGASET_CLEAN_FLOOR,
  MEGASET_TIGHT_FLOOR,
} from "./megaset";

describe("megasetReasonClass (Sep 21 exclusion-shape collapse)", () => {
  test("per-track number strings collapse to their CLASS", () => {
    // the live noise: 130 distinct buckets for 3,681 exclusions
    expect(
      megasetReasonClass(
        "68.2-minute continuous mix exceeds the 15-minute track cap",
      ),
    ).toBe(
      megasetReasonClass(
        "68.6-minute continuous mix exceeds the 15-minute track cap",
      ),
    );
    expect(
      megasetReasonClass(
        "56-second audio sample is below the 1-minute track floor",
      ),
    ).toBe(
      megasetReasonClass(
        "7-second audio sample is below the 1-minute track floor",
      ),
    );
  });
  test("the six real classes are distinct", () => {
    const classes = [
      megasetReasonClass("set budget filled"),
      megasetReasonClass(
        "15.2-minute continuous mix exceeds the 15-minute track cap",
      ),
      megasetReasonClass(
        "30-second audio sample is below the 1-minute track floor",
      ),
      megasetReasonClass("no beats-ledger BPM — run `megadj beats`"),
      megasetReasonClass(
        "no compatible transition (key clash, tempo outside ±6%, or beyond the set's drift budget)",
      ),
      megasetReasonClass(
        "requested opener is not in the candidate pool (unknown id, or not downloaded/analyzed)",
      ),
    ];
    expect(new Set(classes).size).toBe(6);
  });
});

describe("megasetTransitionBand (Sep 21 calibration)", () => {
  test("live-scale blends read clean; sub-floor reads tight", () => {
    // measured live blends Sep 21: 1.10–1.19 across presets
    expect(megasetTransitionBand(1.1).label).toBe("clean");
    expect(megasetTransitionBand(1.19).label).toBe("clean");
    // mid band
    expect(megasetTransitionBand(0.8).label).toBe("ok");
    // the old fixed cut-offs made EVERYTHING ≥0.75 clean — dead column
    expect(megasetTransitionBand(0.3).label).toBe("tight");
  });
  test("the floors are pinned so a silent re-scale of the score is visible", () => {
    expect(MEGASET_TIGHT_FLOOR).toBe(0.5);
    expect(MEGASET_CLEAN_FLOOR).toBe(1.05);
  });
});

describe("megasetGenreTerms (#283 family matcher)", () => {
  test("absent/blank = no filter (empty terms)", () => {
    expect(megasetGenreTerms(null)).toEqual([]);
    expect(megasetGenreTerms(undefined)).toEqual([]);
    expect(megasetGenreTerms("")).toEqual([]);
    expect(megasetGenreTerms("   ")).toEqual([]);
  });

  test("exact family id returns itself + its synonyms", () => {
    const terms = megasetGenreTerms("house");
    expect(terms[0]).toBe("house");
    expect(terms).toContain("house");
  });

  test("raw value that CONTAINS a family id resolves to that family", () => {
    // "tropical" contains no family id, but IS a synonym of tropical house
    const t = megasetGenreTerms("tropical");
    expect(t[0]).toBe("tropical house");
    expect(t).toContain("tropical house");
    expect(t).toContain("latin house");
  });

  test("synonym hit resolves to the family ('dnb')", () => {
    expect(megasetGenreTerms("dnb")[0]).toBe("dnb");
    expect(megasetGenreTerms("drum & bass")[0]).toBe("dnb");
  });

  test("case-folded compare ('TECHNO' → techno family)", () => {
    expect(megasetGenreTerms("TECHNO")[0]).toBe("techno");
  });

  test("free-form unknown value IS the term (gqom → literal 'gqom')", () => {
    expect(megasetGenreTerms("gqom")).toEqual(["gqom"]);
  });
});

// The SQL leg is exercised by the LIVE acceptance run (rb-playlist dry +
// megaset --genre against the real archive DB) — see the day's MD write-up.
// Engine-level: a filtered pool that matches zero rows must produce the
// honest empty-chain result, never a crash.
describe("buildMegaset with a genre-filtered pool", () => {
  test("empty pool → empty chain + all-missing style exclusions, no crash", async () => {
    const { buildMegaset, SET_PRESETS } = await import("../src/megaset/engine");
    const built = buildMegaset({
      candidates: [],
      preset: SET_PRESETS.warmup!,
      minutes: 60,
    });
    expect(built.steps).toEqual([]);
    expect(built.complete).toBe(false);
    expect(built.shortfallMinutes).toBe(60);
  });
});
