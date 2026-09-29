/**
 * fast-gate.test.ts — Tests for fast bench gate (B11.1).
 */
import { describe, expect, test } from "bun:test";
import { runFastBench, checkRegressions, type BenchFixture } from "./fast-gate";

describe("runFastBench", () => {
  test("empty fixtures → empty results", () => {
    expect(runFastBench([])).toHaveLength(0);
  });

  test("computes accuracy per stage", () => {
    const fixtures: BenchFixture[] = [
      { videoId: "t1", stage: "key", predicted: "8A", expected: "8A" },
      { videoId: "t2", stage: "key", predicted: "8A", expected: "9B" },
      { videoId: "t3", stage: "bpm", predicted: 128, expected: 128 },
    ];
    const results = runFastBench(fixtures);
    const keyResult = results.find((r) => r.stage === "key");
    const bpmResult = results.find((r) => r.stage === "bpm");
    expect(keyResult!.accuracy).toBe(0.5);
    expect(keyResult!.total).toBe(2);
    expect(bpmResult!.accuracy).toBe(1);
  });

  test("results sorted by stage name", () => {
    const fixtures: BenchFixture[] = [
      { videoId: "t1", stage: "key", predicted: "8A", expected: "8A" },
      { videoId: "t2", stage: "bpm", predicted: 128, expected: 128 },
    ];
    const results = runFastBench(fixtures);
    expect(results[0]!.stage).toBe("bpm");
    expect(results[1]!.stage).toBe("key");
  });
});

describe("checkRegressions", () => {
  test("no baselines → no regressions", () => {
    const results = [{ stage: "key", accuracy: 0.5, total: 10, correct: 5 }];
    expect(checkRegressions(results, new Map())).toHaveLength(0);
  });

  test("above baseline → pass", () => {
    const results = [{ stage: "key", accuracy: 0.8, total: 10, correct: 8 }];
    const baselines = new Map([["key", 0.7]]);
    expect(checkRegressions(results, baselines)).toHaveLength(0);
  });

  test("below baseline → regression reported", () => {
    const results = [{ stage: "key", accuracy: 0.5, total: 10, correct: 5 }];
    const baselines = new Map([["key", 0.7]]);
    const regressions = checkRegressions(results, baselines);
    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toContain("key");
  });
});
