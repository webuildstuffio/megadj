/**
 * l3-rank.test.ts — Tests for L3 ranked subgenres (B5.4).
 */
import { describe, expect, test } from "bun:test";
import { rankL3, type L3Evidence } from "./l3-rank";

describe("rankL3", () => {
  test("ranks by evidence weight", () => {
    const evidence: L3Evidence[] = [
      { rawGenre: "deep house", family: "house", weight: 3 },
      { rawGenre: "funky house", family: "house", weight: 1 },
      { rawGenre: "deep house", family: "house", weight: 2 },
    ];
    const ranked = rankL3("house", 0.85, evidence);
    expect(ranked[0]!.subgenre).toBe("deep house");
    expect(ranked[0]!.voteCount).toBe(2);
    expect(ranked[1]!.subgenre).toBe("funky house");
    expect(ranked[1]!.voteCount).toBe(1);
  });

  test("probabilities scale with family posterior", () => {
    const evidence: L3Evidence[] = [{ rawGenre: "deep house", family: "house", weight: 5 }];
    const ranked = rankL3("house", 0.9, evidence);
    expect(ranked[0]!.probability).toBe(0.9);
  });

  test("multiple L3 subgenres split probability", () => {
    const evidence: L3Evidence[] = [
      { rawGenre: "deep house", family: "house", weight: 1 },
      { rawGenre: "acid house", family: "house", weight: 1 },
    ];
    const ranked = rankL3("house", 1.0, evidence);
    expect(ranked[0]!.probability).toBe(0.5);
    expect(ranked[1]!.probability).toBe(0.5);
  });

  test("ignores evidence from other families", () => {
    const evidence: L3Evidence[] = [
      { rawGenre: "deep house", family: "house", weight: 3 },
      { rawGenre: "minimal techno", family: "techno", weight: 5 },
    ];
    const ranked = rankL3("house", 0.8, evidence);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.subgenre).toBe("deep house");
  });

  test("no L3 evidence → uniform priors", () => {
    const ranked = rankL3("house", 0.5, []);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((r) => r.voteCount === 0)).toBe(true);
  });

  test("maxResults limits output", () => {
    const evidence: L3Evidence[] = [
      { rawGenre: "deep house", family: "house", weight: 3 },
      { rawGenre: "funky house", family: "house", weight: 2 },
      { rawGenre: "acid house", family: "house", weight: 1 },
      { rawGenre: "soulful house", family: "house", weight: 1 },
    ];
    const ranked = rankL3("house", 0.9, evidence, 2);
    expect(ranked).toHaveLength(2);
  });

  test("unknown family → empty", () => {
    // @ts-expect-error testing unknown family
    const ranked = rankL3("bluegrass", 0.5, []);
    expect(ranked).toHaveLength(0);
  });
});
