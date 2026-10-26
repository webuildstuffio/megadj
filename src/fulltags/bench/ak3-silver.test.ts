/**
 * ak3-silver.test.ts — Tests for silver answer key builder (B6.3).
 */
import { describe, expect, test } from "bun:test";
import { buildSilverKeys, type StoreLabel } from "./ak3-silver";

describe("buildSilverKeys", () => {
  test("empty input → empty result", () => {
    const result = buildSilverKeys([]);
    expect(result.keys).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  test("2 concordant sources → silver key", () => {
    const labels: StoreLabel[] = [
      { trackId: "t1", source: "beatport", family: "house" },
      { trackId: "t1", source: "soundcloud", family: "house" },
    ];
    const result = buildSilverKeys(labels);
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0]!.family).toBe("house");
    expect(result.keys[0]!.concordantSources).toBe(2);
    expect(result.keys[0]!.agreement).toBe(1);
  });

  test("3 sources, 2 agree → silver key", () => {
    const labels: StoreLabel[] = [
      { trackId: "t1", source: "beatport", family: "house" },
      { trackId: "t1", source: "soundcloud", family: "house" },
      { trackId: "t1", source: "itunes", family: "techno" },
    ];
    const result = buildSilverKeys(labels);
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0]!.family).toBe("house");
    expect(result.keys[0]!.agreement).toBeCloseTo(0.667, 2);
  });

  test("only 1 source → dropped", () => {
    const labels: StoreLabel[] = [{ trackId: "t1", source: "beatport", family: "house" }];
    const result = buildSilverKeys(labels);
    expect(result.keys).toHaveLength(0);
    expect(result.dropped).toBe(1);
  });

  test("disagreement below threshold → dropped", () => {
    const labels: StoreLabel[] = [
      { trackId: "t1", source: "beatport", family: "house" },
      { trackId: "t1", source: "soundcloud", family: "techno" },
      { trackId: "t1", source: "itunes", family: "trance" },
    ];
    const result = buildSilverKeys(labels, 2, 0.6);
    expect(result.keys).toHaveLength(0);
    expect(result.dropped).toBe(1);
  });

  test("multiple tracks batched", () => {
    const labels: StoreLabel[] = [
      { trackId: "t1", source: "bp", family: "house" },
      { trackId: "t1", source: "sc", family: "house" },
      { trackId: "t2", source: "bp", family: "techno" },
      { trackId: "t2", source: "sc", family: "techno" },
      { trackId: "t3", source: "bp", family: "house" },
    ];
    const result = buildSilverKeys(labels);
    expect(result.keys).toHaveLength(2); // t1, t2
    expect(result.dropped).toBe(1); // t3
    expect(result.total).toBe(3);
  });
});
