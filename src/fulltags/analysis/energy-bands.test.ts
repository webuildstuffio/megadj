/**
 * energy-bands.test.ts — Tests for percentile energy bands (B7.3).
 */
import { describe, expect, test } from "bun:test";
import { buildEnergyReference, bandFromReference } from "./energy-bands";

describe("buildEnergyReference", () => {
  test("empty scores → zero percentiles", () => {
    const ref = buildEnergyReference([]);
    expect(ref.trackCount).toBe(0);
    expect(ref.percentiles).toHaveLength(9);
  });

  test("uniform scores → evenly spaced percentiles", () => {
    const scores = Array.from({ length: 100 }, (_, i) => i / 100);
    const ref = buildEnergyReference(scores);
    expect(ref.trackCount).toBe(100);
    expect(ref.percentiles).toHaveLength(9);
    expect(ref.percentiles[0]).toBeCloseTo(0.1, 1);
    expect(ref.percentiles[4]).toBeCloseTo(0.5, 1);
  });
});

describe("bandFromReference", () => {
  test("lowest score → band 1", () => {
    const ref = buildEnergyReference(
      Array.from({ length: 100 }, (_, i) => i / 100),
    );
    expect(bandFromReference(0.01, ref)).toBe(1);
  });

  test("highest score → band 9 (E1–E9 cap)", () => {
    const ref = buildEnergyReference(
      Array.from({ length: 100 }, (_, i) => i / 100),
    );
    expect(bandFromReference(0.99, ref)).toBe(9);
  });

  test("mid score → mid band", () => {
    const ref = buildEnergyReference(
      Array.from({ length: 100 }, (_, i) => i / 100),
    );
    const band = bandFromReference(0.5, ref);
    expect(band).toBeGreaterThanOrEqual(4);
    expect(band).toBeLessThanOrEqual(6);
  });

  test("empty reference → default band 5", () => {
    const ref = buildEnergyReference([]);
    expect(bandFromReference(0.5, ref)).toBe(5);
  });
});
