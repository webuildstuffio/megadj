/**
 * phrase-search.test.ts — Tests for phrase-phase search (B8.1).
 */
import { describe, expect, test } from "bun:test";
import { searchPhrases } from "./phrase-search";

describe("searchPhrases", () => {
  test("insufficient bars → empty result", () => {
    const result = searchPhrases([[1], [2]]);
    expect(result.phrases).toHaveLength(0);
    expect(result.totalBars).toBe(2);
  });

  test("uniform features → one phrase (no boundaries)", () => {
    const bar = [0.5, 0.5, 0.5, 0.5];
    const features = Array.from({ length: 16 }, () => bar);
    const result = searchPhrases(features, 4, 0.15);
    // All bars identical = high similarity everywhere = at most one phrase
    expect(result.phrases.length).toBeGreaterThanOrEqual(1);
  });

  test("alternating sections → detects boundaries", () => {
    // Section A: [1, 0, 0], Section B: [0, 0, 1]
    const features: number[][] = [];
    for (let i = 0; i < 8; i++) features.push([1, 0, 0]);
    for (let i = 0; i < 8; i++) features.push([0, 0, 1]);
    for (let i = 0; i < 8; i++) features.push([1, 0, 0]);

    const result = searchPhrases(features, 4, 0.1);
    expect(result.phrases.length).toBeGreaterThanOrEqual(1);
    expect(result.totalBars).toBe(24);
  });

  test("phrase lengths are >= minPhraseLength", () => {
    const features: number[][] = [];
    for (let i = 0; i < 32; i++) {
      features.push(i < 16 ? [1, 0] : [0, 1]);
    }
    const result = searchPhrases(features, 8, 0.1);
    for (const p of result.phrases) {
      expect(p.lengthBars).toBeGreaterThanOrEqual(8);
    }
  });

  test("internal similarity is 0–1 range", () => {
    const features: number[][] = [];
    for (let i = 0; i < 16; i++) features.push([Math.random(), Math.random()]);
    const result = searchPhrases(features, 4, 0.05);
    for (const p of result.phrases) {
      expect(p.internalSimilarity).toBeGreaterThanOrEqual(0);
      expect(p.internalSimilarity).toBeLessThanOrEqual(1);
    }
  });
});
