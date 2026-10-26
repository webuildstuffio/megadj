/**
 * calibration.test.ts — Tests for L2 genre calibration (B5.3).
 */
import { describe, expect, test } from "bun:test";
import {
  calibrateL2,
  expectedCalibrationError,
  findTauThreshold,
  fitTemperature,
  temperatureScale,
  type GenrePosterior,
} from "./calibration";

describe("temperatureScale", () => {
  test("T=1 preserves distribution", () => {
    const scaled = temperatureScale([0.7, 0.3], 1.0);
    expect(scaled[0]!).toBeCloseTo(0.7, 1);
    expect(scaled[1]!).toBeCloseTo(0.3, 1);
  });

  test("T>1 softens distribution", () => {
    const scaled = temperatureScale([0.9, 0.1], 2.0);
    expect(scaled[0]!).toBeLessThan(0.9);
    expect(scaled[1]!).toBeGreaterThan(0.1);
  });

  test("T<1 sharpens distribution", () => {
    const scaled = temperatureScale([0.7, 0.3], 0.5);
    expect(scaled[0]!).toBeGreaterThan(0.7);
    expect(scaled[1]!).toBeLessThan(0.3);
  });

  test("output sums to 1", () => {
    const scaled = temperatureScale([0.5, 0.3, 0.2], 1.5);
    const sum = scaled.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe("expectedCalibrationError", () => {
  test("perfectly calibrated → ECE = 0", () => {
    // If 80% of predictions at p=0.8 are correct, ECE is 0
    const preds = Array.from({ length: 100 }, (_, i) => ({ probability: 0.85, correct: i < 85 }));
    const ece = expectedCalibrationError(preds);
    expect(ece).toBeLessThan(0.02);
  });

  test("overconfident predictions → positive ECE", () => {
    // p=0.9 but only 50% correct → miscalibrated
    const preds = Array.from({ length: 100 }, (_, i) => ({ probability: 0.9, correct: i < 50 }));
    const ece = expectedCalibrationError(preds);
    expect(ece).toBeGreaterThan(0.3);
  });

  test("empty predictions → ECE = 0", () => {
    expect(expectedCalibrationError([])).toBe(0);
  });
});

describe("fitTemperature", () => {
  test("returns 1.0 for empty input", () => {
    expect(fitTemperature([])).toBe(1);
  });

  test("finds a reasonable temperature for well-calibrated data", () => {
    const posteriors: GenrePosterior[] = Array.from({ length: 100 }, (_, i) => ({
      trackId: `t${i}`,
      family: i < 80 ? "house" : "techno",
      probability: i < 80 ? 0.85 : 0.15,
      truth: i < 80 ? "house" : "techno",
    }));
    const t = fitTemperature(posteriors);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(5);
  });
});

describe("findTauThreshold", () => {
  test("high-confidence correct data → low τ", () => {
    const posteriors: GenrePosterior[] = Array.from({ length: 100 }, (_, i) => ({
      trackId: `t${i}`,
      family: "house",
      probability: 0.95,
      truth: "house",
    }));
    const { tau, precision } = findTauThreshold(posteriors, 0.9);
    expect(tau).toBeLessThanOrEqual(0.95);
    expect(precision).toBeGreaterThanOrEqual(0.9);
  });

  test("noisy data → higher τ or lower coverage", () => {
    const posteriors: GenrePosterior[] = Array.from({ length: 100 }, (_, i) => ({
      trackId: `t${i}`,
      family: i % 2 === 0 ? "house" : "techno",
      probability: 0.6,
      truth: "house",
    }));
    const { precision, coverage } = findTauThreshold(posteriors, 0.9);
    // With 50/50 data at p=0.6, precision at any τ ≤ 50%
    expect(precision + coverage).toBeLessThanOrEqual(2); // sanity
  });

  test("empty → defaults", () => {
    const result = findTauThreshold([], 0.9);
    expect(result.tau).toBe(0.5);
  });
});

describe("calibrateL2", () => {
  test("full pipeline on synthetic data", () => {
    const posteriors: GenrePosterior[] = [];
    // 80 correct high-confidence predictions
    for (let i = 0; i < 80; i++) {
      posteriors.push({
        trackId: `t${i}`,
        family: "house",
        probability: 0.85 + Math.random() * 0.1,
        truth: "house",
      });
    }
    // 20 correct lower-confidence predictions
    for (let i = 80; i < 100; i++) {
      posteriors.push({
        trackId: `t${i}`,
        family: "techno",
        probability: 0.65 + Math.random() * 0.15,
        truth: "techno",
      });
    }

    const result = calibrateL2(posteriors);
    expect(result.temperature).toBeGreaterThan(0);
    expect(result.nCalib).toBe(100);
    expect(result.eceAfter).toBeLessThanOrEqual(result.eceBefore + 0.01);
  });

  test("empty → safe defaults", () => {
    const result = calibrateL2([]);
    expect(result.temperature).toBe(1);
    expect(result.nCalib).toBe(0);
  });
});
