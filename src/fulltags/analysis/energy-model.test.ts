/**
 * energy-model.test.ts — Tests for pairwise energy model (B7.2).
 */
import { describe, expect, test } from "bun:test";
import { fitEnergyModel, scoreToBand, type EnergyPair } from "./energy-model";

describe("fitEnergyModel", () => {
  test("empty input → empty output", () => {
    expect(fitEnergyModel([])).toHaveLength(0);
  });

  test("single pair: winner scores higher", () => {
    const pairs: EnergyPair[] = [{ winnerId: "A", loserId: "B" }];
    const scores = fitEnergyModel(pairs);
    expect(scores).toHaveLength(2);
    const a = scores.find((s) => s.trackId === "A");
    const b = scores.find((s) => s.trackId === "B");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.score).toBeGreaterThan(b!.score);
  });

  test("consistent ordering: A > B > C", () => {
    const pairs: EnergyPair[] = [
      { winnerId: "A", loserId: "B" },
      { winnerId: "B", loserId: "C" },
      { winnerId: "A", loserId: "C" },
    ];
    const scores = fitEnergyModel(pairs);
    const a = scores.find((s) => s.trackId === "A")!;
    const b = scores.find((s) => s.trackId === "B")!;
    const c = scores.find((s) => s.trackId === "C")!;
    expect(a.score).toBeGreaterThan(b.score);
    expect(b.score).toBeGreaterThan(c.score);
  });

  test("equal matchups → similar scores", () => {
    const pairs: EnergyPair[] = [
      { winnerId: "A", loserId: "B" },
      { winnerId: "B", loserId: "A" },
    ];
    const scores = fitEnergyModel(pairs);
    const a = scores.find((s) => s.trackId === "A")!;
    const b = scores.find((s) => s.trackId === "B")!;
    expect(Math.abs(a.score - b.score)).toBeLessThan(0.1);
  });

  test("scores produce valid energy bands (1–10)", () => {
    const pairs: EnergyPair[] = [
      { winnerId: "A", loserId: "B" },
      { winnerId: "A", loserId: "C" },
      { winnerId: "B", loserId: "C" },
    ];
    const scores = fitEnergyModel(pairs);
    for (const s of scores) {
      expect(s.band).toBeGreaterThanOrEqual(1);
      expect(s.band).toBeLessThanOrEqual(9);
    }
  });
});

describe("scoreToBand", () => {
  test("0 → 1 (minimum band)", () => {
    expect(scoreToBand(0)).toBe(1);
  });

  test("1.0 → 9 (maximum band, E9 cap)", () => {
    expect(scoreToBand(1.0)).toBe(9);
  });

  test("band never exceeds 9", () => {
    expect(scoreToBand(0.99)).toBe(9);
    expect(scoreToBand(1.5)).toBe(9);
  });

  test("0.5 → 5", () => {
    expect(scoreToBand(0.5)).toBe(5);
  });

  test("0.15 → 2", () => {
    expect(scoreToBand(0.15)).toBe(2);
  });
});
