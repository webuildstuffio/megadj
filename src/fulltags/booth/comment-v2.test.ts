/**
 * comment-v2.test.ts — Tests for comment string v2 (B10.1).
 */
import { describe, expect, test } from "bun:test";
import { buildCommentV2, parseCommentV2 } from "./comment-v2";

describe("buildCommentV2", () => {
  test("full comment with all fields", () => {
    const result = buildCommentV2({
      key: "8A",
      energy: 6,
      moodHeads: new Map([
        ["mood_party", false],
        ["mood_dance", true],
        ["mood_electronic", true],
        ["mood_aggressive", false],
        ["mood_happy", false],
      ]),
      headFireRates: new Map([
        ["mood_party", 0.3],
        ["mood_dance", 0.45],
        ["mood_electronic", 0.75],
        ["mood_aggressive", 0.1],
        ["mood_happy", 0.2],
      ]),
      genre: "house",
    });
    expect(result).toBe("8A · E6 · DANCE · house");
  });

  test("suppresses mood heads with fire rate > 70%", () => {
    const result = buildCommentV2({
      key: "11B",
      energy: 8,
      moodHeads: new Map([
        ["mood_electronic", true],
        ["mood_aggressive", true],
      ]),
      headFireRates: new Map([
        ["mood_electronic", 0.85], // > 70%, suppressed
        ["mood_aggressive", 0.15],
      ]),
      genre: "techno",
    });
    expect(result).toBe("11B · E8 · AGGRO · techno");
  });

  test("no mood tag when all fired heads are above cap", () => {
    const result = buildCommentV2({
      key: "3A",
      energy: 4,
      moodHeads: new Map([["mood_electronic", true]]),
      headFireRates: new Map([["mood_electronic", 0.9]]),
      genre: "ambient",
    });
    expect(result).toBe("3A · E4 · ambient");
  });

  test("omits ungated fields", () => {
    const result = buildCommentV2({
      key: "5B",
      energy: null,
      moodHeads: new Map(),
      headFireRates: new Map(),
      genre: null,
    });
    expect(result).toBe("5B");
  });

  test("empty when nothing gated", () => {
    const result = buildCommentV2({
      key: null,
      energy: null,
      moodHeads: new Map(),
      headFireRates: new Map(),
      genre: null,
    });
    expect(result).toBe("");
  });

  test("only one mood tag shown", () => {
    const result = buildCommentV2({
      key: "1A",
      energy: 9,
      moodHeads: new Map([
        ["mood_party", true],
        ["mood_aggressive", true],
      ]),
      headFireRates: new Map([
        ["mood_party", 0.2],
        ["mood_aggressive", 0.1],
      ]),
      genre: "hardstyle",
    });
    // Only the first fired head below cap
    expect(result).toBe("1A · E9 · PARTY · hardstyle");
  });

  test("energy rounds to integer", () => {
    const result = buildCommentV2({
      key: null,
      energy: 7.3,
      moodHeads: new Map(),
      headFireRates: new Map(),
      genre: null,
    });
    expect(result).toBe("E7");
  });
});

describe("parseCommentV2", () => {
  test("round-trip: build → parse", () => {
    const comment = "8A · E6 · DANCE · house";
    const parsed = parseCommentV2(comment);
    expect(parsed.key).toBe("8A");
    expect(parsed.energy).toBe(6);
    expect(parsed.mood).toBe("DANCE");
    expect(parsed.genre).toBe("house");
  });

  test("parse key-only", () => {
    const parsed = parseCommentV2("11B");
    expect(parsed.key).toBe("11B");
    expect(parsed.energy).toBeNull();
    expect(parsed.mood).toBeNull();
    expect(parsed.genre).toBeNull();
  });

  test("parse empty string", () => {
    const parsed = parseCommentV2("");
    expect(parsed.key).toBeNull();
  });
});
