/**
 * comment-v3.test.ts — Tests for comment string v3.
 *
 * Tier 2: `E6·Driving·A46·H27·Tech House`
 * Tier 3: `E6·Driving·A46·H27·Tech House-Progressive·Build`
 */
import { describe, expect, test } from "bun:test";
import {
  buildCommentV3,
  parseCommentV3,
  setPlacement,
  vibeFromMood,
  type SetPlacement,
  type Vibe,
} from "./comment-v3";

// ---------- vibeFromMood ----------

describe("vibeFromMood", () => {
  const cases: [number, number, number, Vibe][] = [
    // [aggressive, happy, valence, expected]
    [0.8, 0.1, 5.0, "Hard"],
    [0.75, 0.9, 2.0, "Hard"], // aggro wins over happy/valence
    [0.5, 0.0, 5.0, "Driving"],
    [0.45, 0.1, 5.0, "Driving"],
    [0.3, 0.5, 5.0, "Groovy"], // aggro > 0.2 AND happy > 0.3
    [0.25, 0.35, 5.0, "Groovy"],
    [0.3, 0.1, 5.0, "Medium"], // aggro > 0.2 but happy low
    [0.25, 0.0, 5.0, "Medium"],
    [0.1, 0.5, 5.0, "Bright"], // low aggro, happy > 0.3
    [0.0, 0.4, 5.0, "Bright"],
    [0.1, 0.1, 3.0, "Deep"], // low everything, valence < 4.2
    [0.0, 0.0, 4.1, "Deep"],
    [0.1, 0.1, 5.0, "Smooth"], // low everything, valence >= 4.2
    [0.0, 0.0, 4.2, "Smooth"], // boundary: exactly 4.2 is NOT Deep
  ];

  test.each(cases)(
    "aggro=%f happy=%f val=%f → %s",
    (agg, hap, val, expected) => {
      expect(vibeFromMood(agg, hap, val)).toBe(expected);
    },
  );

  test("boundary: aggressive exactly 0.7 is Driving not Hard", () => {
    expect(vibeFromMood(0.7, 0.0, 5.0)).toBe("Driving");
  });

  test("boundary: aggressive 0.2 with happy 0.3 → Smooth (both thresholds are strict >)", () => {
    expect(vibeFromMood(0.2, 0.3, 5.0)).toBe("Smooth");
  });
});

// ---------- setPlacement ----------

describe("setPlacement", () => {
  const cases: [number, Vibe, SetPlacement][] = [
    [9, "Hard", "Peak"],
    [8, "Hard", "Peak"],
    [7, "Hard", "Build"],
    [5, "Hard", "Build"],
    [8, "Driving", "Build"],
    [7, "Driving", "Build"],
    [6, "Driving", "Floor"],
    [4, "Driving", "Floor"],
    [9, "Groovy", "Floor"],
    [3, "Groovy", "Floor"],
    [7, "Medium", "Floor"],
    [3, "Medium", "Floor"],
    [8, "Bright", "Floor"],
    [6, "Bright", "Floor"],
    [5, "Bright", "Opener"],
    [3, "Bright", "Opener"],
    [7, "Smooth", "Floor"],
    [5, "Smooth", "Floor"],
    [4, "Smooth", "Opener"],
    [2, "Smooth", "Opener"],
    [5, "Deep", "Closer"],
    [2, "Deep", "Closer"],
  ];

  test.each(cases)("E%d %s → %s", (energy, vibe, expected) => {
    expect(setPlacement(energy, vibe)).toBe(expected);
  });
});

// ---------- buildCommentV3 ----------

describe("buildCommentV3", () => {
  test("Tier 2: full comment with all fields", () => {
    expect(
      buildCommentV3({
        energy: 6,
        vibe: "Driving",
        aggressive: 46,
        happy: 27,
        genre2: "Tech House",
        genre3: null,
        primaryGenre: "House",
        placement: null,
      }),
    ).toBe("E6·Driving·A46·H27·Tech House");
  });

  test("Tier 3: with genres and placement", () => {
    expect(
      buildCommentV3({
        energy: 6,
        vibe: "Driving",
        aggressive: 46,
        happy: 27,
        genre2: "Tech House",
        genre3: "Progressive",
        primaryGenre: "House",
        placement: "Build",
      }),
    ).toBe("E6·Driving·A46·H27·Tech House-Progressive·Build");
  });

  test("energy only", () => {
    expect(
      buildCommentV3({
        energy: 8,
        vibe: null,
        aggressive: null,
        happy: null,
        genre2: null,
        genre3: null,
        primaryGenre: null,
        placement: null,
      }),
    ).toBe("E8");
  });

  test("vibe only", () => {
    expect(
      buildCommentV3({
        energy: null,
        vibe: "Hard",
        aggressive: null,
        happy: null,
        genre2: null,
        genre3: null,
        primaryGenre: null,
        placement: null,
      }),
    ).toBe("Hard");
  });

  test("energy + vibe, no extras", () => {
    expect(
      buildCommentV3({
        energy: 5,
        vibe: "Smooth",
        aggressive: null,
        happy: null,
        genre2: null,
        genre3: null,
        primaryGenre: null,
        placement: null,
      }),
    ).toBe("E5·Smooth");
  });

  test("A/H below threshold (< 5) omitted", () => {
    expect(
      buildCommentV3({
        energy: 5,
        vibe: "Smooth",
        aggressive: 2,
        happy: 3,
        genre2: "Deep House",
        genre3: null,
        primaryGenre: "House",
        placement: null,
      }),
    ).toBe("E5·Smooth·Deep House");
  });

  test("A/H at threshold (= 5) shown", () => {
    expect(
      buildCommentV3({
        energy: 7,
        vibe: "Driving",
        aggressive: 5,
        happy: 5,
        genre2: null,
        genre3: null,
        primaryGenre: null,
        placement: null,
      }),
    ).toBe("E7·Driving·A5·H5");
  });

  test("high aggressive, low happy", () => {
    expect(
      buildCommentV3({
        energy: 9,
        vibe: "Hard",
        aggressive: 95,
        happy: 3,
        genre2: "Techno",
        genre3: null,
        primaryGenre: "EDM",
        placement: "Peak",
      }),
    ).toBe("E9·Hard·A95·Techno·Peak");
  });

  test("secondary = primary genre deduplicated (casefold)", () => {
    expect(
      buildCommentV3({
        energy: 7,
        vibe: "Driving",
        aggressive: 46,
        happy: 27,
        genre2: "House",
        genre3: "Tech House",
        primaryGenre: "house",
        placement: null,
      }),
    ).toBe("E7·Driving·A46·H27·Tech House");
  });

  test("secondary = primary, tertiary also = primary → no genres", () => {
    expect(
      buildCommentV3({
        energy: 7,
        vibe: "Groovy",
        aggressive: 25,
        happy: 46,
        genre2: "House",
        genre3: "house",
        primaryGenre: "House",
        placement: null,
      }),
    ).toBe("E7·Groovy·A25·H46");
  });

  test("energy rounds to nearest integer", () => {
    expect(
      buildCommentV3({
        energy: 6.7,
        vibe: "Deep",
        aggressive: null,
        happy: null,
        genre2: null,
        genre3: null,
        primaryGenre: null,
        placement: null,
      }),
    ).toBe("E7·Deep");
  });

  test("empty when all null", () => {
    expect(
      buildCommentV3({
        energy: null,
        vibe: null,
        aggressive: null,
        happy: null,
        genre2: null,
        genre3: null,
        primaryGenre: null,
        placement: null,
      }),
    ).toBe("");
  });

  test("empty genre strings treated as null", () => {
    expect(
      buildCommentV3({
        energy: 5,
        vibe: "Bright",
        aggressive: 10,
        happy: 72,
        genre2: "",
        genre3: "",
        primaryGenre: null,
        placement: null,
      }),
    ).toBe("E5·Bright·A10·H72");
  });

  test("NaN energy is skipped", () => {
    expect(
      buildCommentV3({
        energy: Number.NaN,
        vibe: "Medium",
        aggressive: 30,
        happy: null,
        genre2: null,
        genre3: null,
        primaryGenre: null,
        placement: null,
      }),
    ).toBe("Medium·A30");
  });

  test("Infinity energy is skipped", () => {
    expect(
      buildCommentV3({
        energy: Number.POSITIVE_INFINITY,
        vibe: "Driving",
        aggressive: null,
        happy: 50,
        genre2: null,
        genre3: null,
        primaryGenre: null,
        placement: null,
      }),
    ).toBe("Driving·H50");
  });

  test("NaN aggressive is skipped", () => {
    expect(
      buildCommentV3({
        energy: 7,
        vibe: "Hard",
        aggressive: Number.NaN,
        happy: 20,
        genre2: null,
        genre3: null,
        primaryGenre: null,
        placement: null,
      }),
    ).toBe("E7·Hard·H20");
  });

  test("real library example: MEDUZA NO SLEEP", () => {
    expect(
      buildCommentV3({
        energy: 10,
        vibe: "Driving",
        aggressive: 67,
        happy: 34,
        genre2: "Tech House",
        genre3: null,
        primaryGenre: "Techhouse",
        placement: null,
      }),
    ).toBe("E10·Driving·A67·H34·Tech House");
  });

  test("real library example: CIREZ D Diamond Girl", () => {
    expect(
      buildCommentV3({
        energy: 5,
        vibe: "Driving",
        aggressive: 58,
        happy: 27,
        genre2: "EDM",
        genre3: null,
        primaryGenre: "Techno",
        placement: null,
      }),
    ).toBe("E5·Driving·A58·H27·EDM");
  });

  test("placement only renders when provided", () => {
    const without = buildCommentV3({
      energy: 9,
      vibe: "Hard",
      aggressive: 95,
      happy: null,
      genre2: "Techno",
      genre3: null,
      primaryGenre: "EDM",
      placement: null,
    });
    const withPlacement = buildCommentV3({
      energy: 9,
      vibe: "Hard",
      aggressive: 95,
      happy: null,
      genre2: "Techno",
      genre3: null,
      primaryGenre: "EDM",
      placement: "Peak",
    });
    expect(without).toBe("E9·Hard·A95·Techno");
    expect(withPlacement).toBe("E9·Hard·A95·Techno·Peak");
  });
});

// ---------- parseCommentV3 ----------

describe("parseCommentV3", () => {
  test("round-trip: Tier 2 full comment", () => {
    const parsed = parseCommentV3("E6·Driving·A46·H27·Tech House");
    expect(parsed.energy).toBe(6);
    expect(parsed.vibe).toBe("Driving");
    expect(parsed.aggressive).toBe(46);
    expect(parsed.happy).toBe(27);
    expect(parsed.genres).toBe("Tech House");
    expect(parsed.placement).toBeNull();
  });

  test("round-trip: Tier 3 with placement", () => {
    const parsed = parseCommentV3(
      "E6·Driving·A46·H27·Tech House-Progressive·Build",
    );
    expect(parsed.energy).toBe(6);
    expect(parsed.vibe).toBe("Driving");
    expect(parsed.aggressive).toBe(46);
    expect(parsed.happy).toBe(27);
    expect(parsed.genres).toBe("Tech House-Progressive");
    expect(parsed.placement).toBe("Build");
  });

  test("energy only", () => {
    const parsed = parseCommentV3("E8");
    expect(parsed.energy).toBe(8);
    expect(parsed.vibe).toBeNull();
    expect(parsed.aggressive).toBeNull();
    expect(parsed.happy).toBeNull();
    expect(parsed.genres).toBeNull();
    expect(parsed.placement).toBeNull();
  });

  test("vibe only", () => {
    const parsed = parseCommentV3("Hard");
    expect(parsed.energy).toBeNull();
    expect(parsed.vibe).toBe("Hard");
  });

  test("all seven vibes parse correctly", () => {
    for (const v of [
      "Hard",
      "Driving",
      "Groovy",
      "Medium",
      "Bright",
      "Deep",
      "Smooth",
    ]) {
      const parsed = parseCommentV3(`E5·${v}`);
      expect(parsed.vibe).toBe(v);
    }
  });

  test("all five placements parse correctly", () => {
    for (const p of ["Peak", "Build", "Floor", "Opener", "Closer"]) {
      const parsed = parseCommentV3(`E5·Hard·${p}`);
      expect(parsed.placement).toBe(p);
    }
  });

  test("genres with dashes parse as single string", () => {
    const parsed = parseCommentV3("E7·Groovy·A25·H46·Drum & Bass-Jungle");
    expect(parsed.genres).toBe("Drum & Bass-Jungle");
    expect(parsed.aggressive).toBe(25);
    expect(parsed.happy).toBe(46);
  });

  test("empty string", () => {
    const parsed = parseCommentV3("");
    expect(parsed.energy).toBeNull();
    expect(parsed.vibe).toBeNull();
    expect(parsed.aggressive).toBeNull();
    expect(parsed.happy).toBeNull();
    expect(parsed.genres).toBeNull();
    expect(parsed.placement).toBeNull();
  });

  test("aggressive without happy", () => {
    const parsed = parseCommentV3("E9·Hard·A95·Techno");
    expect(parsed.aggressive).toBe(95);
    expect(parsed.happy).toBeNull();
    expect(parsed.genres).toBe("Techno");
  });

  test("happy without aggressive", () => {
    const parsed = parseCommentV3("E5·Bright·H80·Deep House");
    expect(parsed.aggressive).toBeNull();
    expect(parsed.happy).toBe(80);
  });

  test("legacy v3 format (no A/H) still parses", () => {
    const parsed = parseCommentV3("E6·Driving·House-Tech House");
    expect(parsed.energy).toBe(6);
    expect(parsed.vibe).toBe("Driving");
    expect(parsed.genres).toBe("House-Tech House");
    expect(parsed.aggressive).toBeNull();
    expect(parsed.happy).toBeNull();
  });
});
