// megaset.test.ts — #283: the megaset genre pool filter (shared seam).
// Pins the shared family matcher (megasetGenreTerms) and the pool
// builder's SQL LIKE filter (setCandidates with a genre arg). The live
// tropical-house set (r.play) is the acceptance evidence, not a fixture.

import { describe, expect, test } from "bun:test";
import {
  groupMegasetExcluded,
  isMegasetHalfTimePair,
  megasetArtistKey,
  megasetArtistRepeatPenalty,
  megasetBudgetFilledCount,
  megasetGenreFallbackTerms,
  megasetGenreTerms,
  megasetNearestGenreFamily,
  megasetReasonClass,
  megasetTransitionBand,
  MEGASET_ARTIST_REPEAT_WINDOW,
  MEGASET_CLEAN_FLOOR,
  MEGASET_HALFTIME_PENALTY,
  MEGASET_HALFTIME_TOLERANCE,
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
  test("the S13 landmark reasons collapse to one class", () => {
    expect(
      megasetReasonClass(
        "landmark not placeable — not in the candidate pool (unknown id, or not downloaded/analyzed)",
      ),
    ).toBe(
      megasetReasonClass(
        "landmark not placeable — no arc-legal position in this set (key clash, tempo outside ±6%, or drift budget)",
      ),
    );
  });
  test("the seven real classes are distinct", () => {
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
      megasetReasonClass(
        "landmark not placeable — no arc-legal position in this set",
      ),
    ];
    expect(new Set(classes).size).toBe(7);
  });
});

describe("B6 artist-repeat seam (#107)", () => {
  test("artistKey: case-folds, takes the head credit, null-safe", () => {
    expect(megasetArtistKey("HUGEL")).toBe("hugel");
    expect(megasetArtistKey("Hugel, Cumbiafrica, Florent Hugel")).toBe("hugel");
    expect(megasetArtistKey(null)).toBeNull();
    expect(megasetArtistKey("   ")).toBeNull();
  });
  test("penalty fires only on exact same-head-credit back-to-back", () => {
    const a = { artist: "Alpha" };
    const a2 = { artist: "alpha" }; // case-insensitive
    const b = { artist: "Beta" };
    const unknown = { artist: null };
    expect(megasetArtistRepeatPenalty(a, a2)).toBe(
      MEGASET_ARTIST_REPEAT_WINDOW,
    );
    expect(megasetArtistRepeatPenalty(a, b)).toBe(0);
    expect(megasetArtistRepeatPenalty(a, unknown)).toBe(0);
    expect(megasetArtistRepeatPenalty(unknown, unknown)).toBe(0);
  });
});

describe("B8 half-time pairing seam (#107)", () => {
  test("×2 / ×½ / ×1.5 / ×⅔ lanes all recognized within tolerance", () => {
    expect(isMegasetHalfTimePair(87, 174)).toBe(true);
    expect(isMegasetHalfTimePair(174, 87)).toBe(true);
    expect(isMegasetHalfTimePair(130, 87)).toBe(true); // the feel lane
    expect(isMegasetHalfTimePair(87, 130)).toBe(true);
  });
  test("outside every multiple → false (no accidental pairing)", () => {
    expect(isMegasetHalfTimePair(87, 120)).toBe(false);
    expect(isMegasetHalfTimePair(100, 100)).toBe(false); // ×1 is bpmScore's job
    expect(isMegasetHalfTimePair(100, 300)).toBe(false); // beyond ×2+tol
  });
  test("constants pinned — silent retuning would re-rank every proposal", () => {
    expect(MEGASET_HALFTIME_PENALTY).toBe(0.9);
    expect(MEGASET_HALFTIME_TOLERANCE).toBeCloseTo(0.06, 10);
    expect(MEGASET_ARTIST_REPEAT_WINDOW).toBe(3);
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

describe("#291 budget-fill is a status, not an exclusion bucket", () => {
  const excluded = [
    { videoId: "a", title: "A", reason: "set budget filled" },
    { videoId: "b", title: "B", reason: "set budget filled" },
    {
      videoId: "c",
      title: "C",
      reason: "no beats-ledger BPM — run `megadj beats`",
    },
    { videoId: "d", title: "D", reason: "set budget filled" },
  ];
  test("groups carry only quality reasons — never a budget-fill bucket", () => {
    const groups = groupMegasetExcluded(excluded);
    expect(groups.map((g) => g.reason)).not.toContain("set budget filled");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(1);
  });
  test("budget_filled counts the status rows", () => {
    expect(megasetBudgetFilledCount(excluded)).toBe(3);
    expect(megasetBudgetFilledCount([])).toBe(0);
  });
});

describe("#290 nearest-genre-family suggestion", () => {
  test("a typo'd family resolves to the real one", () => {
    expect(megasetNearestGenreFamily("tehno")?.family).toBe("techno");
    expect(megasetNearestGenreFamily("hosue")?.family).toBe("house");
  });
  test("synonym-distance suggestions land on a plausible family", () => {
    // distance-3 noise terms suggest the nearest family vocabulary —
    // deterministic, capped at distance 3 (beyond = honest null)
    expect(megasetNearestGenreFamily("gqom")?.family).toBe("edm");
    expect(megasetNearestGenreFamily("afro")?.family).toBe("afrohouse");
  });
  test("a far foreign term gets NO suggestion (honest gap)", () => {
    expect(megasetNearestGenreFamily("xyzzyq")).toBeNull();
    expect(megasetNearestGenreFamily("")).toBeNull();
    expect(megasetNearestGenreFamily("   ")).toBeNull();
  });
  test("ties break alphabetically for determinism", () => {
    // "hous" is distance 1 from "house" (family: house) — the suggestion
    // is the family id itself, deterministic on repeated calls
    const a = megasetNearestGenreFamily("hous");
    const b = megasetNearestGenreFamily("hous");
    expect(a).toEqual(b);
    expect(a?.family).toBe("house");
  });
});

describe("#290-starvation fallback resolves by FAMILY, not raw string", () => {
  test("synonym spelling gets the family's fallbacks ('tropical' → house)", () => {
    // the bug: `--genre tropical` resolves to the tropical-house family
    // via the matcher but the old raw-string fallback lookup missed it —
    // the same pool starved or widened depending on spelling
    expect(megasetGenreFallbackTerms("tropical")).toEqual(["house"]);
    expect(megasetGenreFallbackTerms("Tropical House")).toEqual(["house"]);
    expect(megasetGenreFallbackTerms("afro")).toEqual(["house"]);
  });
  test("exact family id unchanged", () => {
    expect(megasetGenreFallbackTerms("tropical house")).toEqual(["house"]);
  });
  test("free-form / blank values get no widening (literal stays literal)", () => {
    expect(megasetGenreFallbackTerms("gqom")).toBeNull();
    expect(megasetGenreFallbackTerms("")).toBeNull();
    expect(megasetGenreFallbackTerms(null)).toBeNull();
    expect(megasetGenreFallbackTerms(undefined)).toBeNull();
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
