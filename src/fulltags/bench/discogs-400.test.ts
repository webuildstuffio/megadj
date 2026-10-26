/**
 * discogs-400.test.ts — Tests for Discogs-400 L3 voter (B9.3).
 */
import { describe, expect, test } from "bun:test";
import {
  deriveVotes,
  evaluateDiscogs400,
  DISCOGS_400_VOTE_WEIGHT,
  type Discogs400Output,
} from "./discogs-400";
import type { GenreFamily } from "../genre/taxonomy-v3";

describe("deriveVotes", () => {
  test("empty outputs → empty votes", () => {
    expect(deriveVotes([])).toEqual([]);
  });

  test("maps best prediction to family", () => {
    const outputs: Discogs400Output[] = [
      {
        trackId: "t1",
        predictions: [
          { label: "Deep House", probability: 0.8 },
          { label: "Ambient", probability: 0.1 },
        ],
      },
    ];
    const votes = deriveVotes(outputs);
    expect(votes).toHaveLength(1);
    expect(votes[0]!.family).toBe("house");
    expect(votes[0]!.subgenre).toBe("deep house");
    expect(votes[0]!.weight).toBe(DISCOGS_400_VOTE_WEIGHT);
  });

  test("unmappable predictions → null family", () => {
    const outputs: Discogs400Output[] = [
      { trackId: "t1", predictions: [{ label: "Obscure Noise Art", probability: 0.9 }] },
    ];
    const votes = deriveVotes(outputs);
    expect(votes[0]!.family).toBeNull();
  });
});

describe("evaluateDiscogs400", () => {
  test("empty → zeros", () => {
    const result = evaluateDiscogs400([], new Map());
    expect(result.total).toBe(0);
  });

  test("perfect family match → 100%", () => {
    const votes = [
      {
        trackId: "t1",
        family: "house" as GenreFamily,
        subgenre: "deep house",
        confidence: 0.9,
        weight: 0.4,
      },
    ];
    const gt = new Map([["t1", { family: "house" as GenreFamily, subgenre: "deep house" }]]);
    const result = evaluateDiscogs400(votes, gt);
    expect(result.familyAgreement).toBe(1);
    expect(result.l3Agreement).toBe(1);
  });

  test("family match but L3 mismatch", () => {
    const votes = [
      {
        trackId: "t1",
        family: "house" as GenreFamily,
        subgenre: "tech house",
        confidence: 0.7,
        weight: 0.4,
      },
    ];
    const gt = new Map([["t1", { family: "house" as GenreFamily, subgenre: "deep house" }]]);
    const result = evaluateDiscogs400(votes, gt);
    expect(result.familyAgreement).toBe(1);
    expect(result.l3Agreement).toBe(0);
  });
});
