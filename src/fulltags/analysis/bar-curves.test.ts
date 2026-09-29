/**
 * bar-curves.test.ts — Tests for bar-curve aggregation (B2.2).
 */
import { describe, expect, test } from "bun:test";
import { patchesToBars, extractCurve, type PatchFeature } from "./bar-curves";

describe("patchesToBars", () => {
  test("empty patches → empty bars", () => {
    expect(patchesToBars([], [0, 2, 4])).toEqual([]);
  });

  test("too few boundaries → empty bars", () => {
    const patches: PatchFeature[] = [{ timeSeconds: 1.0, features: [0.5] }];
    expect(patchesToBars(patches, [0])).toEqual([]);
  });

  test("aggregates patches into bars by mean", () => {
    const patches: PatchFeature[] = [
      { timeSeconds: 0.5, features: [1.0, 0.0] },
      { timeSeconds: 1.5, features: [3.0, 2.0] },
      { timeSeconds: 2.5, features: [5.0, 4.0] },
      { timeSeconds: 3.5, features: [7.0, 6.0] },
    ];
    const bars = patchesToBars(patches, [0, 2, 4]);
    expect(bars).toHaveLength(2);
    expect(bars[0]!.features[0]).toBe(2); // mean(1, 3)
    expect(bars[1]!.features[0]).toBe(6); // mean(5, 7)
  });

  test("skips bars with no patches", () => {
    const patches: PatchFeature[] = [{ timeSeconds: 0.5, features: [1.0] }];
    // Bar 0: [0,2) has a patch, Bar 1: [2,4) has none
    const bars = patchesToBars(patches, [0, 2, 4]);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.barIndex).toBe(0);
  });
});

describe("extractCurve", () => {
  test("extracts single dimension", () => {
    const bars = [
      { barIndex: 0, startTime: 0, endTime: 2, features: [1.0, 2.0] },
      { barIndex: 1, startTime: 2, endTime: 4, features: [3.0, 4.0] },
    ];
    const curve = extractCurve(bars, 0);
    expect(curve).toEqual([
      { barIndex: 0, value: 1.0 },
      { barIndex: 1, value: 3.0 },
    ]);
  });

  test("out-of-bounds dimension → 0", () => {
    const bars = [{ barIndex: 0, startTime: 0, endTime: 2, features: [1.0] }];
    const curve = extractCurve(bars, 5);
    expect(curve[0]!.value).toBe(0);
  });
});
