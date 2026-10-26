/**
 * omar-rq.test.ts — Tests for OMAR-RQ challenger framework (B9.1).
 */
import { describe, expect, test } from "bun:test";
import { summarizeOmarBars, correlateWithEnergy, type OmarBarResult } from "./omar-rq";

describe("summarizeOmarBars", () => {
  test("empty bars → zeros", () => {
    const result = summarizeOmarBars("t1", []);
    expect(result.barCount).toBe(0);
    expect(result.meanRhythmComplexity).toBe(0);
  });

  test("single bar → bar values", () => {
    const bars: OmarBarResult[] = [
      { barIndex: 0, rhythmComplexity: 0.8, grooveConsistency: 0.9, syncopation: 0.3 },
    ];
    const result = summarizeOmarBars("t1", bars);
    expect(result.barCount).toBe(1);
    expect(result.meanRhythmComplexity).toBe(0.8);
    expect(result.meanGrooveConsistency).toBe(0.9);
  });

  test("averages multiple bars", () => {
    const bars: OmarBarResult[] = [
      { barIndex: 0, rhythmComplexity: 0.6, grooveConsistency: 0.8, syncopation: 0.2 },
      { barIndex: 1, rhythmComplexity: 0.8, grooveConsistency: 0.6, syncopation: 0.4 },
    ];
    const result = summarizeOmarBars("t1", bars);
    expect(result.meanRhythmComplexity).toBe(0.7);
    expect(result.meanGrooveConsistency).toBe(0.7);
    expect(result.meanSyncopation).toBe(0.3);
  });
});

describe("correlateWithEnergy", () => {
  test("empty inputs → 0", () => {
    expect(correlateWithEnergy([], [])).toBe(0);
  });

  test("perfect positive correlation → 1", () => {
    const omar: OmarBarResult[] = [
      { barIndex: 0, rhythmComplexity: 0, grooveConsistency: 0.2, syncopation: 0 },
      { barIndex: 1, rhythmComplexity: 0, grooveConsistency: 0.4, syncopation: 0 },
      { barIndex: 2, rhythmComplexity: 0, grooveConsistency: 0.6, syncopation: 0 },
      { barIndex: 3, rhythmComplexity: 0, grooveConsistency: 0.8, syncopation: 0 },
    ];
    const energy = [
      { barIndex: 0, energy: 0.2 },
      { barIndex: 1, energy: 0.4 },
      { barIndex: 2, energy: 0.6 },
      { barIndex: 3, energy: 0.8 },
    ];
    expect(correlateWithEnergy(omar, energy)).toBe(1);
  });

  test("no matching bars → 0", () => {
    const omar: OmarBarResult[] = [
      { barIndex: 0, rhythmComplexity: 0, grooveConsistency: 0.5, syncopation: 0 },
    ];
    const energy = [{ barIndex: 99, energy: 0.5 }];
    expect(correlateWithEnergy(omar, energy)).toBe(0);
  });
});
