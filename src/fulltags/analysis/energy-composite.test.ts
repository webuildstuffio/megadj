/**
 * energy-composite.test.ts — Tests for bloc-based energy scoring (v3.1).
 */
import { describe, expect, test } from "bun:test";
import {
  BLOC_NAMES,
  SIGNAL_NAMES,
  SIGNAL_BLOCS,
  WEIGHT_PRESETS,
  freezeSignals,
  toPercentile,
  signalPercentiles,
  blocPercentiles,
  compositeScore,
  energyConfidence,
  scoreAll,
  bandDistribution,
} from "./energy-composite";
import type { EnergyFeatureRow } from "./energy-features";

function makeRow(overrides: Partial<EnergyFeatureRow> = {}): EnergyFeatureRow {
  return {
    videoId: overrides.videoId ?? "test-id",
    onsetsPerBeat: 2.5,
    bpm: 128,
    hfEnergyReLufs: -20,
    lowEnergyReLufs: -15,
    crestFactor: -5,
    spectralFlux: 0.3,
    lufsDrop: -14,
    spectralCentroid: 3000,
    aggressive: 0.6,
    engagement: 0.7,
    approachability: 0.4,
    arousalDrop: 6.5,
    dropStartS: 60,
    dropEndS: 90,
    dropContrastDb: 8,
    lowDropContrast: false,
    ...overrides,
  };
}

describe("SIGNAL_BLOCS coverage", () => {
  test("every signal is assigned to exactly one bloc", () => {
    for (const sig of SIGNAL_NAMES) {
      expect(SIGNAL_BLOCS[sig]).toBeDefined();
      expect(BLOC_NAMES as readonly string[]).toContain(SIGNAL_BLOCS[sig]);
    }
  });

  test("every bloc has at least one signal", () => {
    for (const bloc of BLOC_NAMES) {
      const sigs = SIGNAL_NAMES.filter((s) => SIGNAL_BLOCS[s] === bloc);
      expect(sigs.length).toBeGreaterThan(0);
    }
  });
});

describe("weight presets", () => {
  test("each preset sums to 1.0", () => {
    for (const preset of WEIGHT_PRESETS) {
      const total = Object.values(preset.weights).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1.0, 10);
    }
  });

  test("all blocs present in each preset", () => {
    for (const preset of WEIGHT_PRESETS) {
      for (const bloc of BLOC_NAMES) {
        expect(preset.weights[bloc]).toBeDefined();
        expect(preset.weights[bloc]).toBeGreaterThan(0);
      }
    }
  });
});

describe("freezeSignals", () => {
  test("returns sorted values for each live signal", () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      makeRow({
        videoId: `t${i}`,
        bpm: 100 + i * 2,
        onsetsPerBeat: 1 + i * 0.1,
        hfEnergyReLufs: -20 + i * 0.5,
        lowEnergyReLufs: -10 + i * 0.3,
        crestFactor: 5 + i * 0.2,
        spectralFlux: 0.1 + i * 0.02,
        lufsDrop: -14 + i * 0.2,
        spectralCentroid: 1000 + i * 50,
        aggressive: 0.1 + i * 0.015,
        engagement: 0.2 + i * 0.01,
        approachability: 0.8 - i * 0.01,
        arousalDrop: 0.3 + i * 0.012,
      }),
    );
    const frozen = freezeSignals(rows);
    expect(frozen.deadSignals.length).toBe(0);
    const bpmRef = frozen.values.bpm;
    expect(bpmRef).toBeDefined();
    expect(bpmRef!.length).toBe(50);
    for (let i = 1; i < bpmRef!.length; i++) {
      expect(bpmRef![i]).toBeGreaterThanOrEqual(bpmRef![i - 1]!);
    }
  });

  test("marks dead signals (IQR < threshold)", () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      makeRow({
        videoId: `t${i}`,
        bpm: 128,
        onsetsPerBeat: 2.5 + i * 0.001,
        aggressive: 0.98,
      }),
    );
    const frozen = freezeSignals(rows);
    expect(frozen.deadSignals).toContain("aggressive");
  });
});

describe("toPercentile", () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  test("lowest value → lowest percentile", () => {
    expect(toPercentile(1, sorted, false)).toBe(0.1);
  });

  test("highest value → percentile 1.0", () => {
    expect(toPercentile(10, sorted, false)).toBe(1.0);
  });

  test("inverted: highest value → lowest percentile", () => {
    expect(toPercentile(10, sorted, true)).toBe(0);
  });

  test("inverted: lowest value → highest percentile", () => {
    expect(toPercentile(1, sorted, true)).toBe(0.9);
  });

  test("mid value → ~0.5", () => {
    const pct = toPercentile(5, sorted, false);
    expect(pct).toBeGreaterThanOrEqual(0.4);
    expect(pct).toBeLessThanOrEqual(0.6);
  });
});

describe("signalPercentiles + blocPercentiles", () => {
  test("median track in a uniform distribution → ~0.5 blocs", () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      makeRow({
        videoId: `t${i}`,
        bpm: 100 + i,
        onsetsPerBeat: 1 + i * 0.05,
        hfEnergyReLufs: -30 + i * 0.3,
        lowEnergyReLufs: -25 + i * 0.2,
        crestFactor: -10 + i * 0.1,
        spectralFlux: 0.1 + i * 0.005,
        lufsDrop: -25 + i * 0.15,
        spectralCentroid: 1000 + i * 30,
        aggressive: i * 0.01,
        engagement: i * 0.01,
        approachability: 1 - i * 0.01,
        arousalDrop: 1 + i * 0.08,
      }),
    );
    const frozen = freezeSignals(rows);
    const mid = rows[50]!;
    const sigPcts = signalPercentiles(mid, frozen);
    const blocs = blocPercentiles(sigPcts);
    for (const bloc of BLOC_NAMES) {
      expect(blocs[bloc]).toBeGreaterThanOrEqual(0.3);
      expect(blocs[bloc]).toBeLessThanOrEqual(0.7);
    }
  });
});

describe("compositeScore", () => {
  test("all blocs at 0.5 → composite ~0.5", () => {
    const blocs = Object.fromEntries(BLOC_NAMES.map((b) => [b, 0.5])) as Record<
      (typeof BLOC_NAMES)[number],
      number
    >;
    const score = compositeScore(blocs, WEIGHT_PRESETS[1]!);
    expect(score).toBeCloseTo(0.5, 1);
  });

  test("all blocs at 1.0 → composite ~1.0", () => {
    const blocs = Object.fromEntries(BLOC_NAMES.map((b) => [b, 1.0])) as Record<
      (typeof BLOC_NAMES)[number],
      number
    >;
    const score = compositeScore(blocs, WEIGHT_PRESETS[1]!);
    expect(score).toBeCloseTo(1.0, 1);
  });
});

describe("energyConfidence", () => {
  test("agreement → high", () => {
    const blocs = Object.fromEntries(BLOC_NAMES.map((b) => [b, 0.5])) as Record<
      (typeof BLOC_NAMES)[number],
      number
    >;
    expect(energyConfidence(blocs)).toBe("high");
  });

  test("large tier disagreement → low", () => {
    const blocs = {
      rhythm: 0.9,
      brightness: 0.9,
      body: 0.9,
      activity: 0.9,
      perceptual: 0.2,
    };
    expect(energyConfidence(blocs)).toBe("low");
  });
});

describe("scoreAll", () => {
  test("produces valid bands for all tracks", () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      makeRow({
        videoId: `t${i}`,
        bpm: 100 + i,
        onsetsPerBeat: 1 + i * 0.05,
        aggressive: i * 0.01,
        arousalDrop: 1 + i * 0.08,
      }),
    );
    const frozen = freezeSignals(rows);
    const scored = scoreAll(rows, frozen, WEIGHT_PRESETS[1]!);
    expect(scored).toHaveLength(100);
    for (const t of scored) {
      expect(t.band).toBeGreaterThanOrEqual(1);
      expect(t.band).toBeLessThanOrEqual(10);
    }
  });

  test("higher-energy track gets higher band than lower-energy track", () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      makeRow({
        videoId: `t${i}`,
        bpm: 100 + i,
        onsetsPerBeat: 1 + i * 0.1,
        hfEnergyReLufs: -30 + i * 0.5,
        aggressive: i * 0.01,
        engagement: i * 0.01,
        arousalDrop: 1 + i * 0.08,
      }),
    );
    const frozen = freezeSignals(rows);
    const scored = scoreAll(rows, frozen, WEIGHT_PRESETS[1]!);
    const low = scored.find((t) => t.videoId === "t10");
    const high = scored.find((t) => t.videoId === "t90");
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    expect(high!.band).toBeGreaterThan(low!.band);
  });
});

describe("bandDistribution", () => {
  test("all bands present", () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      makeRow({ videoId: `t${i}`, bpm: 100 + i }),
    );
    const frozen = freezeSignals(rows);
    const scored = scoreAll(rows, frozen, WEIGHT_PRESETS[1]!);
    const dist = bandDistribution(scored);
    for (let i = 1; i <= 10; i++) {
      expect(dist[i]).toBeDefined();
    }
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 1);
  });
});
