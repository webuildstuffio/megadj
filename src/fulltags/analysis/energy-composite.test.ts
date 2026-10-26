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
  type BlocName,
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

/** Build N rows with ALL signals varying linearly so no signal is dead. */
function diverseRows(n: number): EnergyFeatureRow[] {
  return Array.from({ length: n }, (_, i) =>
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
}

// --------------- structure ---------------

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

  test("signal count matches SIGNAL_NAMES length", () => {
    const mapped = SIGNAL_NAMES.filter((s) => SIGNAL_BLOCS[s] !== undefined);
    expect(mapped.length).toBe(SIGNAL_NAMES.length);
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

  test("preset names are unique", () => {
    const names = WEIGHT_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("at least 3 presets available", () => {
    expect(WEIGHT_PRESETS.length).toBeGreaterThanOrEqual(3);
  });
});

// --------------- freezeSignals ---------------

describe("freezeSignals", () => {
  test("returns sorted values for each live signal", () => {
    const rows = diverseRows(50);
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
      makeRow({ videoId: `t${i}`, bpm: 128, onsetsPerBeat: 2.5 + i * 0.001, aggressive: 0.98 }),
    );
    const frozen = freezeSignals(rows);
    expect(frozen.deadSignals).toContain("aggressive");
  });

  test("all-constant signals → all dead", () => {
    const rows = Array.from({ length: 30 }, (_, i) => makeRow({ videoId: `t${i}` }));
    const frozen = freezeSignals(rows);
    expect(frozen.deadSignals.length).toBe(SIGNAL_NAMES.length);
    expect(Object.keys(frozen.values).length).toBe(0);
  });

  test("empty rows → all dead", () => {
    const frozen = freezeSignals([]);
    expect(frozen.deadSignals.length).toBe(SIGNAL_NAMES.length);
  });

  test("rows with null values excluded from sort", () => {
    const rows = [
      makeRow({ videoId: "a", bpm: 100, aggressive: null }),
      makeRow({ videoId: "b", bpm: 200, aggressive: null }),
      ...diverseRows(30),
    ];
    const frozen = freezeSignals(rows);
    const bpmRef = frozen.values.bpm;
    expect(bpmRef).toBeDefined();
    expect(bpmRef!.length).toBeGreaterThan(0);
  });

  test("NaN values filtered out", () => {
    const rows = [makeRow({ videoId: "a", bpm: NaN }), ...diverseRows(30)];
    const frozen = freezeSignals(rows);
    const bpmRef = frozen.values.bpm;
    if (bpmRef !== undefined) {
      for (const v of bpmRef) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

// --------------- toPercentile ---------------

describe("toPercentile", () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  test("lowest value → lowest non-zero percentile", () => {
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

  test("empty sorted ref → 0.5 default", () => {
    expect(toPercentile(5, [], false)).toBe(0.5);
    expect(toPercentile(5, [], true)).toBe(0.5);
  });

  test("single element ref", () => {
    expect(toPercentile(5, [5], false)).toBe(1.0);
    expect(toPercentile(3, [5], false)).toBe(0);
  });

  test("below-all value → percentile 0", () => {
    expect(toPercentile(-999, sorted, false)).toBe(0);
  });

  test("above-all value → percentile 1.0", () => {
    expect(toPercentile(999, sorted, false)).toBe(1.0);
  });

  test("value between elements → interpolated percentile", () => {
    const pct = toPercentile(5.5, sorted, false);
    expect(pct).toBeGreaterThan(0.4);
    expect(pct).toBeLessThan(0.7);
  });
});

// --------------- signalPercentiles + blocPercentiles ---------------

describe("signalPercentiles", () => {
  test("null signal → 0.5 default", () => {
    const rows = diverseRows(30);
    const frozen = freezeSignals(rows);
    const row = makeRow({ aggressive: null });
    const pcts = signalPercentiles(row, frozen);
    if ("aggressive" in pcts) {
      expect(pcts.aggressive).toBe(0.5);
    }
  });

  test("NaN signal → 0.5 default", () => {
    const rows = diverseRows(30);
    const frozen = freezeSignals(rows);
    const row = makeRow({ bpm: NaN });
    const pcts = signalPercentiles(row, frozen);
    if ("bpm" in pcts) {
      expect(pcts.bpm).toBe(0.5);
    }
  });
});

describe("blocPercentiles", () => {
  test("median track in a uniform distribution → ~0.5 blocs", () => {
    const rows = diverseRows(100);
    const frozen = freezeSignals(rows);
    const mid = rows[50]!;
    const sigPcts = signalPercentiles(mid, frozen);
    const blocs = blocPercentiles(sigPcts);
    for (const bloc of BLOC_NAMES) {
      expect(blocs[bloc]).toBeGreaterThanOrEqual(0.3);
      expect(blocs[bloc]).toBeLessThanOrEqual(0.7);
    }
  });

  test("empty signal percentiles → all blocs default to 0.5", () => {
    const blocs = blocPercentiles({});
    for (const bloc of BLOC_NAMES) {
      expect(blocs[bloc]).toBe(0.5);
    }
  });

  test("partial signals → affected blocs still computed", () => {
    const blocs = blocPercentiles({ bpm: 0.8, onsetsPerBeat: 0.9 });
    expect(blocs.rhythm).toBeCloseTo(0.85, 2);
    expect(blocs.brightness).toBe(0.5);
  });
});

// --------------- compositeScore ---------------

describe("compositeScore", () => {
  test("all blocs at 0.5 → composite ~0.5", () => {
    const blocs = Object.fromEntries(BLOC_NAMES.map((b) => [b, 0.5])) as Record<BlocName, number>;
    const score = compositeScore(blocs, WEIGHT_PRESETS[1]!);
    expect(score).toBeCloseTo(0.5, 1);
  });

  test("all blocs at 1.0 → composite ~1.0", () => {
    const blocs = Object.fromEntries(BLOC_NAMES.map((b) => [b, 1.0])) as Record<BlocName, number>;
    const score = compositeScore(blocs, WEIGHT_PRESETS[1]!);
    expect(score).toBeCloseTo(1.0, 1);
  });

  test("all blocs at 0 → composite 0", () => {
    const blocs = Object.fromEntries(BLOC_NAMES.map((b) => [b, 0])) as Record<BlocName, number>;
    const score = compositeScore(blocs, WEIGHT_PRESETS[1]!);
    expect(score).toBe(0);
  });

  test("non-equal weights produce different scores", () => {
    const perceptualHigh = Object.fromEntries(
      BLOC_NAMES.map((b) => [b, b === "perceptual" ? 1.0 : 0.0]),
    ) as Record<BlocName, number>;
    const equal = WEIGHT_PRESETS.find((p) => p.name === "equal")!;
    const percPreset = WEIGHT_PRESETS.find((p) => p.name === "perceptual-heavy")!;
    const scoreEqual = compositeScore(perceptualHigh, equal);
    const scorePerc = compositeScore(perceptualHigh, percPreset);
    expect(scorePerc).toBeGreaterThan(scoreEqual);
  });
});

// --------------- energyConfidence ---------------

describe("energyConfidence", () => {
  test("agreement → high", () => {
    const blocs = Object.fromEntries(BLOC_NAMES.map((b) => [b, 0.5])) as Record<BlocName, number>;
    expect(energyConfidence(blocs)).toBe("high");
  });

  test("large tier disagreement → low", () => {
    expect(
      energyConfidence({ rhythm: 0.9, brightness: 0.9, body: 0.9, activity: 0.9, perceptual: 0.2 }),
    ).toBe("low");
  });

  test("borderline (exactly 0.3 gap) → high", () => {
    expect(
      energyConfidence({ rhythm: 0.6, brightness: 0.6, body: 0.6, activity: 0.6, perceptual: 0.3 }),
    ).toBe("high");
  });

  test("just over threshold → low", () => {
    expect(
      energyConfidence({
        rhythm: 0.65,
        brightness: 0.65,
        body: 0.65,
        activity: 0.65,
        perceptual: 0.3,
      }),
    ).toBe("low");
  });
});

// --------------- scoreAll ---------------

describe("scoreAll", () => {
  test("produces valid bands for all tracks (E1–E9)", () => {
    const rows = diverseRows(100);
    const frozen = freezeSignals(rows);
    const scored = scoreAll(rows, frozen, WEIGHT_PRESETS[1]!);
    expect(scored).toHaveLength(100);
    for (const t of scored) {
      expect(t.band).toBeGreaterThanOrEqual(1);
      expect(t.band).toBeLessThanOrEqual(9);
      expect(t.confidence === "high" || t.confidence === "low").toBe(true);
    }
  });

  test("higher-energy track gets higher band than lower-energy track", () => {
    const rows = diverseRows(100);
    const frozen = freezeSignals(rows);
    const scored = scoreAll(rows, frozen, WEIGHT_PRESETS[1]!);
    const low = scored.find((t) => t.videoId === "t10");
    const high = scored.find((t) => t.videoId === "t90");
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    expect(high!.band).toBeGreaterThan(low!.band);
  });

  test("every scored track has all bloc fields", () => {
    const rows = diverseRows(20);
    const frozen = freezeSignals(rows);
    const scored = scoreAll(rows, frozen, WEIGHT_PRESETS[0]!);
    for (const t of scored) {
      for (const bloc of BLOC_NAMES) {
        expect(typeof t.blocs[bloc]).toBe("number");
        expect(t.blocs[bloc]).toBeGreaterThanOrEqual(0);
        expect(t.blocs[bloc]).toBeLessThanOrEqual(1);
      }
    }
  });

  test("composite is between 0 and 1", () => {
    const rows = diverseRows(50);
    const frozen = freezeSignals(rows);
    const scored = scoreAll(rows, frozen, WEIGHT_PRESETS[1]!);
    for (const t of scored) {
      expect(t.composite).toBeGreaterThanOrEqual(0);
      expect(t.composite).toBeLessThanOrEqual(1);
    }
  });
});

// --------------- bandDistribution ---------------

describe("bandDistribution", () => {
  test("all 9 bands present (E1–E9)", () => {
    const rows = diverseRows(100);
    const frozen = freezeSignals(rows);
    const scored = scoreAll(rows, frozen, WEIGHT_PRESETS[1]!);
    const dist = bandDistribution(scored);
    for (let i = 1; i <= 9; i++) {
      expect(dist[i]).toBeDefined();
      expect(dist[i]).toBeGreaterThanOrEqual(0);
    }
    expect(dist[10]).toBeUndefined();
  });

  test("shares sum to ~1.0", () => {
    const rows = diverseRows(100);
    const frozen = freezeSignals(rows);
    const scored = scoreAll(rows, frozen, WEIGHT_PRESETS[1]!);
    const dist = bandDistribution(scored);
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 1);
  });

  test("empty tracks → all zeros (E1–E9)", () => {
    const dist = bandDistribution([]);
    for (let i = 1; i <= 9; i++) {
      expect(dist[i]).toBe(0);
    }
  });
});
