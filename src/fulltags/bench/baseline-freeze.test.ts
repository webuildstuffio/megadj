/**
 * baseline-freeze.test.ts — Tests for baseline freeze (B0.3).
 */
import { describe, expect, test } from "bun:test";
import { freezeBaseline, compareToBaseline } from "./baseline-freeze";

describe("freezeBaseline", () => {
  test("creates snapshot with correct tag", () => {
    const snapshot = freezeBaseline(
      "v2-final",
      [{ stage: "key", accuracy: 0.85, total: 100 }],
      500,
    );
    expect(snapshot.tag).toBe("v2-final");
    expect(snapshot.benchSetSize).toBe(500);
    expect(snapshot.stages.get("key")!.accuracy).toBe(0.85);
  });

  test("stores CI bounds when provided", () => {
    const snapshot = freezeBaseline(
      "v3-rc1",
      [
        {
          stage: "bpm",
          accuracy: 0.92,
          total: 200,
          ciLower: 0.88,
          ciUpper: 0.95,
        },
      ],
      500,
    );
    const bpm = snapshot.stages.get("bpm")!;
    expect(bpm.ciLower).toBe(0.88);
    expect(bpm.ciUpper).toBe(0.95);
  });
});

describe("compareToBaseline", () => {
  test("no change → zero delta", () => {
    const baseline = freezeBaseline(
      "v2",
      [{ stage: "key", accuracy: 0.85, total: 100 }],
      500,
    );
    const comparisons = compareToBaseline(
      [{ stage: "key", accuracy: 0.85 }],
      baseline,
    );
    expect(comparisons[0]!.delta).toBe(0);
    expect(comparisons[0]!.regression).toBe(false);
  });

  test("improvement → positive delta", () => {
    const baseline = freezeBaseline(
      "v2",
      [{ stage: "key", accuracy: 0.8, total: 100 }],
      500,
    );
    const comparisons = compareToBaseline(
      [{ stage: "key", accuracy: 0.9 }],
      baseline,
    );
    expect(comparisons[0]!.delta).toBeGreaterThan(0);
  });

  test("significant regression detected", () => {
    const baseline = freezeBaseline(
      "v2",
      [
        {
          stage: "key",
          accuracy: 0.85,
          total: 100,
          ciLower: 0.8,
          ciUpper: 0.9,
        },
      ],
      500,
    );
    const comparisons = compareToBaseline(
      [{ stage: "key", accuracy: 0.7 }],
      baseline,
    );
    expect(comparisons[0]!.regression).toBe(true);
    expect(comparisons[0]!.significant).toBe(true);
  });

  test("new stage not in baseline → no regression", () => {
    const baseline = freezeBaseline("v2", [], 500);
    const comparisons = compareToBaseline(
      [{ stage: "new-stage", accuracy: 0.5 }],
      baseline,
    );
    expect(comparisons[0]!.regression).toBe(false);
    expect(comparisons[0]!.baselineAccuracy).toBe(0);
  });
});
