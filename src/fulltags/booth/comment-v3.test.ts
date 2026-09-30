/**
 * comment-v3.test.ts — Tests for comment string v3.
 *
 * Format: `E6·Driving·House-Tech House`
 */
import { describe, expect, test } from "bun:test";
import {
  buildCommentV3,
  parseCommentV3,
  vibeFromMood,
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

// ---------- buildCommentV3 ----------

describe("buildCommentV3", () => {
  test("full comment with all fields", () => {
    expect(
      buildCommentV3({
        energy: 6,
        vibe: "Driving",
        genre2: "House",
        genre3: "Tech House",
      }),
    ).toBe("E6·Driving·House-Tech House");
  });

  test("energy only", () => {
    expect(
      buildCommentV3({ energy: 8, vibe: null, genre2: null, genre3: null }),
    ).toBe("E8");
  });

  test("vibe only", () => {
    expect(
      buildCommentV3({
        energy: null,
        vibe: "Hard",
        genre2: null,
        genre3: null,
      }),
    ).toBe("Hard");
  });

  test("energy + vibe, no genres", () => {
    expect(
      buildCommentV3({ energy: 5, vibe: "Smooth", genre2: null, genre3: null }),
    ).toBe("E5·Smooth");
  });

  test("one genre only (secondary)", () => {
    expect(
      buildCommentV3({
        energy: 7,
        vibe: "Groovy",
        genre2: "Disco",
        genre3: null,
      }),
    ).toBe("E7·Groovy·Disco");
  });

  test("two genres dash-joined", () => {
    expect(
      buildCommentV3({
        energy: 9,
        vibe: "Hard",
        genre2: "Techno",
        genre3: "Industrial",
      }),
    ).toBe("E9·Hard·Techno-Industrial");
  });

  test("energy rounds to nearest integer", () => {
    expect(
      buildCommentV3({
        energy: 6.7,
        vibe: "Deep",
        genre2: null,
        genre3: null,
      }),
    ).toBe("E7·Deep");
  });

  test("empty when all null", () => {
    expect(
      buildCommentV3({
        energy: null,
        vibe: null,
        genre2: null,
        genre3: null,
      }),
    ).toBe("");
  });

  test("empty genre strings treated as null", () => {
    expect(
      buildCommentV3({ energy: 5, vibe: "Bright", genre2: "", genre3: "" }),
    ).toBe("E5·Bright");
  });

  test("NaN energy is skipped", () => {
    expect(
      buildCommentV3({
        energy: Number.NaN,
        vibe: "Medium",
        genre2: null,
        genre3: null,
      }),
    ).toBe("Medium");
  });

  test("Infinity energy is skipped", () => {
    expect(
      buildCommentV3({
        energy: Number.POSITIVE_INFINITY,
        vibe: "Driving",
        genre2: null,
        genre3: null,
      }),
    ).toBe("Driving");
  });
});

// ---------- parseCommentV3 ----------

describe("parseCommentV3", () => {
  test("round-trip: full comment", () => {
    const parsed = parseCommentV3("E6·Driving·House-Tech House");
    expect(parsed.energy).toBe(6);
    expect(parsed.vibe).toBe("Driving");
    expect(parsed.genres).toBe("House-Tech House");
  });

  test("energy only", () => {
    const parsed = parseCommentV3("E8");
    expect(parsed.energy).toBe(8);
    expect(parsed.vibe).toBeNull();
    expect(parsed.genres).toBeNull();
  });

  test("vibe only", () => {
    const parsed = parseCommentV3("Hard");
    expect(parsed.energy).toBeNull();
    expect(parsed.vibe).toBe("Hard");
    expect(parsed.genres).toBeNull();
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

  test("genres with dashes parse as single string", () => {
    const parsed = parseCommentV3("E7·Groovy·Drum & Bass-Jungle");
    expect(parsed.genres).toBe("Drum & Bass-Jungle");
  });

  test("empty string", () => {
    const parsed = parseCommentV3("");
    expect(parsed.energy).toBeNull();
    expect(parsed.vibe).toBeNull();
    expect(parsed.genres).toBeNull();
  });

  test("energy + genres, no vibe", () => {
    const parsed = parseCommentV3("E4·House-Techno");
    expect(parsed.energy).toBe(4);
    expect(parsed.vibe).toBeNull();
    expect(parsed.genres).toBe("House-Techno");
  });
});
