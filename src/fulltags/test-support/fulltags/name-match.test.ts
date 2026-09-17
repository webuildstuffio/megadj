/**
 * name-match.test.ts — pins the SHARED name-matching vocabulary
 * (name-match.ts) that the SC, Beatport, and Bandcamp scorers all call.
 * The three near-copied tokenizers/gates drifted for months (issue #85
 * flagged the hygiene twin); these tests pin the seam they now share.
 */
import { describe, expect, test } from "bun:test";
import {
  ARTIST_MIN_LEN,
  artistGate,
  artistGateFails,
  hasTitleTokenOverlap,
  nameTokens,
  primaryArtist,
  titleOverlap,
} from "../../name-match";

describe("name-match: primaryArtist", () => {
  test("takes the first comma/ampersand-separated artist", () => {
    expect(primaryArtist("Tvardovsky, Aleksei")).toBe("tvardovsky");
    expect(primaryArtist("ANOTR & 54")).toBe("anotr");
  });

  test("null/empty/junk artist → empty string (gate then skips)", () => {
    expect(primaryArtist(null)).toBe("");
    expect(primaryArtist("")).toBe("");
    expect(primaryArtist("   ")).toBe("");
  });
});

describe("name-match: nameTokens", () => {
  test("folds case + separators, drops ≤2-char tokens", () => {
    expect(nameTokens("Depths of Consciousness (Mix)")).toEqual([
      "depths",
      "consciousness",
      "mix",
    ]);
    expect(nameTokens("ANOTR x 54")).toEqual(["anotr"]); // "x","54" dropped
  });
});

describe("name-match: titleOverlap", () => {
  test("identical token sets → 1.0 regardless of order/separators", () => {
    expect(
      titleOverlap("Depths of Consciousness", "consciousness depths"),
    ).toBe(1);
  });

  test("disjoint names → 0", () => {
    expect(titleOverlap("Astral Projection", "Depths of Consciousness")).toBe(
      0,
    );
  });

  test("partial overlap → shared/max ratio", () => {
    // {depths, consciousness, mix} vs {depths, consciousness} → 2/3
    expect(
      titleOverlap("Depths of Consciousness (Mix)", "Depths Consciousness"),
    ).toBeCloseTo(2 / 3);
  });
});

describe("name-match: artistGate (the hard gate all three sources share)", () => {
  test("query artist present in candidates → 6 exact / 4 contained", () => {
    expect(artistGate("Tvardovsky", ["Tvardovsky"])).toBe(6);
    expect(artistGate("Tvardovsky", ["Tvardovsky Records"])).toBe(4);
  });

  test("known artist absent → 0 (the Taylor Swift class)", () => {
    expect(artistGate("Taylor Swift", ["Dubspeed Compilation Channel"])).toBe(
      0,
    );
  });

  test("sub-ARTIST_MIN_LEN artist doesn't gate (can't separate)", () => {
    expect(artistGate("DJ", ["Anyone Else"])).toBe(0);
    expect(artistGate("AB", ["Anyone Else"])).toBe(0);
    expect(ARTIST_MIN_LEN).toBe(3);
  });

  test("gate is case-insensitive", () => {
    expect(artistGate("TVARDOVSKY", ["tvardovsky"])).toBe(6);
  });

  test("artistGateFails mirrors the drop decision", () => {
    expect(artistGateFails("Taylor Swift", ["Someone Else"])).toBe(true);
    expect(artistGateFails("Tvardovsky", ["Tvardovsky"])).toBe(false);
    expect(artistGateFails("DJ", ["Someone Else"])).toBe(false);
  });
});

describe("name-match: hasTitleTokenOverlap", () => {
  test("true on ≥1 shared token", () => {
    expect(hasTitleTokenOverlap("Depths Mix", "Mix by Someone")).toBe(true);
  });
  test("false on disjoint", () => {
    expect(hasTitleTokenOverlap("Astral Projection", "Neon Heights")).toBe(
      false,
    );
  });
});
