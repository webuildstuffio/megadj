/**
 * ak4-silver.test.ts — Tests for AK4 agent-researched silver (B6.4).
 */
import { describe, expect, test } from "bun:test";
import { evaluateAK4, identifyHardCases, type AK4Evidence } from "./ak4-silver";
import type { GenreFamily } from "../genre/taxonomy-v3";

describe("evaluateAK4", () => {
  test("empty → zeros", () => {
    const result = evaluateAK4([], new Map());
    expect(result.totalCases).toBe(0);
  });

  test("perfect agreement → 100%", () => {
    const silver: AK4Evidence[] = [
      {
        trackId: "t1",
        sources: ["beatport", "discogs"],
        reasoning: "All sources agree on house",
        confidence: 0.95,
        silverFamily: "house",
        silverSubgenre: "deep house",
      },
    ];
    const est = new Map([
      ["t1", { family: "house" as GenreFamily, subgenre: "deep house" }],
    ]);
    const result = evaluateAK4(silver, est);
    expect(result.agreement).toBe(1);
    expect(result.l3Enrichment).toBe(1);
    expect(result.disputes).toBe(0);
  });

  test("family mismatch → dispute", () => {
    const silver: AK4Evidence[] = [
      {
        trackId: "t1",
        sources: ["bandcamp"],
        reasoning: "Label catalog is tech house",
        confidence: 0.8,
        silverFamily: "tech house",
        silverSubgenre: null,
      },
    ];
    const est = new Map([
      ["t1", { family: "house" as GenreFamily, subgenre: null }],
    ]);
    const result = evaluateAK4(silver, est);
    expect(result.disputes).toBe(1);
    expect(result.agreement).toBe(0);
  });
});

describe("identifyHardCases", () => {
  test("filters by confidence and agreement", () => {
    const tracks = [
      { trackId: "t1", confidence: 0.3, sourceAgreement: 0.8 },
      { trackId: "t2", confidence: 0.9, sourceAgreement: 0.9 },
      { trackId: "t3", confidence: 0.5, sourceAgreement: 0.3 },
    ];
    const cases = identifyHardCases(tracks);
    expect(cases).toContain("t1");
    expect(cases).toContain("t3");
    expect(cases).not.toContain("t2");
  });

  test("respects maxCases limit", () => {
    const tracks = Array.from({ length: 500 }, (_, i) => ({
      trackId: `t${i}`,
      confidence: 0.1,
      sourceAgreement: 0.1,
    }));
    const cases = identifyHardCases(tracks, 100);
    expect(cases).toHaveLength(100);
  });

  test("sorts by confidence ascending", () => {
    const tracks = [
      { trackId: "high", confidence: 0.5, sourceAgreement: 0.1 },
      { trackId: "low", confidence: 0.1, sourceAgreement: 0.1 },
    ];
    const cases = identifyHardCases(tracks);
    expect(cases[0]).toBe("low");
  });
});
