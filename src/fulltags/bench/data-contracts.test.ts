/**
 * data-contracts.test.ts — Tests for distribution invariants (B11.2).
 */
import { describe, expect, test } from "bun:test";
import {
  checkBpmRange,
  checkKeyCoverage,
  checkGenreCoverage,
  checkEnergyBands,
} from "./data-contracts";

describe("checkBpmRange", () => {
  test("all in range → pass", () => {
    const result = checkBpmRange([120, 128, 140, 100, 80]);
    expect(result.passed).toBe(true);
  });

  test("many out of range → fail", () => {
    const result = checkBpmRange([30, 40, 50, 60, 300]);
    expect(result.passed).toBe(false);
  });

  test("empty → fail", () => {
    const result = checkBpmRange([]);
    expect(result.passed).toBe(false);
  });
});

describe("checkKeyCoverage", () => {
  test("all 24 keys → pass", () => {
    const keys = [];
    for (let n = 1; n <= 12; n++) {
      keys.push(`${n}A`, `${n}B`);
    }
    const result = checkKeyCoverage(keys);
    expect(result.passed).toBe(true);
  });

  test("only 12 keys → fail", () => {
    const keys = [];
    for (let n = 1; n <= 12; n++) {
      keys.push(`${n}A`);
    }
    const result = checkKeyCoverage(keys);
    expect(result.passed).toBe(false);
  });
});

describe("checkGenreCoverage", () => {
  test("10+ families → pass", () => {
    const families = [
      "house",
      "techno",
      "trance",
      "dubstep",
      "drum and bass",
      "hip hop",
      "pop",
      "disco",
      "ambient",
      "breakbeat",
    ];
    const result = checkGenreCoverage(families);
    expect(result.passed).toBe(true);
  });

  test("few families → fail", () => {
    const result = checkGenreCoverage(["house", "techno"]);
    expect(result.passed).toBe(false);
  });
});

describe("checkEnergyBands", () => {
  test("all 10 bands → pass", () => {
    const result = checkEnergyBands([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.passed).toBe(true);
  });

  test("missing bands → fail", () => {
    const result = checkEnergyBands([1, 2, 3, 4, 5]);
    expect(result.passed).toBe(false);
  });
});
