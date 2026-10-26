/**
 * drop-energy.test.ts — Tests for drop-section energy features (B7.1).
 */
import { describe, expect, test } from "bun:test";
import { computeDropEnergy } from "./drop-energy";
import type { BarFeature } from "./bar-features";

function makeBar(
  barIndex: number,
  lufs: number | null = -14,
  onsetDensity: number | null = 4,
  lowBandShare: number | null = 0.3,
  spectralFlux: number | null = 0.5,
): BarFeature {
  return {
    barIndex,
    startTime: barIndex * 2.0,
    endTime: (barIndex + 1) * 2.0,
    embedding: null,
    lufs,
    onsetDensity,
    lowBandShare,
    spectralFlux,
  };
}

describe("computeDropEnergy", () => {
  test("returns null for insufficient bars", () => {
    const bars = Array.from({ length: 10 }, (_, i) => makeBar(i));
    expect(computeDropEnergy(bars, 16)).toBeNull();
  });

  test("finds the loudest 16-bar window", () => {
    const bars: BarFeature[] = [];
    // 40 bars: quiet intro, loud middle, quiet outro
    for (let i = 0; i < 40; i++) {
      const lufs = i >= 12 && i < 28 ? -8 : -20;
      bars.push(makeBar(i, lufs));
    }
    const result = computeDropEnergy(bars, 16);
    expect(result).not.toBeNull();
    expect(result!.dropStartBar).toBe(12);
    expect(result!.meanLufs).toBeGreaterThan(-10);
    expect(result!.peakLufs).toBe(-8);
  });

  test("computes LUFS contrast (drop vs rest)", () => {
    const bars: BarFeature[] = [];
    for (let i = 0; i < 32; i++) {
      const lufs = i >= 8 && i < 24 ? -8 : -20;
      bars.push(makeBar(i, lufs));
    }
    const result = computeDropEnergy(bars, 16);
    expect(result).not.toBeNull();
    // Drop is -8, rest is -20, contrast = 12 dB
    expect(result!.lufsContrast).toBeGreaterThan(10);
  });

  test("handles null features gracefully", () => {
    const bars: BarFeature[] = Array.from({ length: 20 }, (_, i) =>
      makeBar(i, i < 10 ? -10 : null, null, null, null),
    );
    const result = computeDropEnergy(bars, 16);
    expect(result).not.toBeNull();
    expect(result!.meanOnsetDensity).toBeNull();
    expect(result!.meanLowBand).toBeNull();
    expect(result!.meanFlux).toBeNull();
  });

  test("all equal LUFS → picks first window, zero contrast", () => {
    const bars = Array.from({ length: 20 }, (_, i) => makeBar(i, -14));
    const result = computeDropEnergy(bars, 16);
    expect(result).not.toBeNull();
    expect(result!.dropStartBar).toBe(0);
    expect(result!.lufsContrast).toBe(0);
  });

  test("custom window size", () => {
    const bars = Array.from({ length: 20 }, (_, i) => makeBar(i, i >= 10 && i < 18 ? -6 : -18));
    const result = computeDropEnergy(bars, 8);
    expect(result).not.toBeNull();
    expect(result!.windowSize).toBe(8);
    expect(result!.dropStartBar).toBe(10);
  });
});
