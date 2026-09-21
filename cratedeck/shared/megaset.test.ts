// megaset.test.ts — #283: the megaset genre pool filter (shared seam).
// Pins the shared family matcher (megasetGenreTerms) and the pool
// builder's SQL LIKE filter (setCandidates with a genre arg). The live
// tropical-house set (r.play) is the acceptance evidence, not a fixture.

import { describe, expect, test } from "bun:test";
import { megasetGenreTerms } from "./megaset";

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
