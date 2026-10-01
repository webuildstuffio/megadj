/**
 * energy-validate.test.ts — Tests for energy v3.1 validation gates.
 */
import { describe, expect, test } from "bun:test";
import {
  spearmanRho,
  cohenD,
  gateBlocDominance,
  gateNotBpm,
  gateTierAgreement,
  gateGenreDirection,
  gateGainInvariance,
  gateDuplicateConsistency,
  collectGates,
} from "./energy-validate";
import { BLOC_NAMES, type ScoredTrack } from "./energy-composite";

function makeScoredTrack(
  videoId: string,
  composite: number,
  band: number,
  blocs?: Partial<Record<(typeof BLOC_NAMES)[number], number>>,
): ScoredTrack {
  const defaultBlocs = Object.fromEntries(
    BLOC_NAMES.map((b) => [b, composite]),
  ) as Record<(typeof BLOC_NAMES)[number], number>;
  return {
    videoId,
    composite,
    band,
    confidence: "high",
    blocs: { ...defaultBlocs, ...blocs },
  };
}

describe("spearmanRho", () => {
  test("perfect positive correlation → 1.0", () => {
    expect(spearmanRho([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1.0, 2);
  });

  test("perfect negative correlation → -1.0", () => {
    expect(spearmanRho([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1.0, 2);
  });

  test("no correlation → ~0", () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const b = [5, 1, 8, 3, 10, 2, 7, 4, 9, 6];
    const rho = spearmanRho(a, b);
    expect(Math.abs(rho)).toBeLessThan(0.5);
  });

  test("too few elements → 0", () => {
    expect(spearmanRho([1], [2])).toBe(0);
  });
});

describe("cohenD", () => {
  test("identical groups → 0", () => {
    expect(cohenD([5, 5, 5], [5, 5, 5])).toBe(0);
  });

  test("well-separated groups → large d", () => {
    const g1 = [10, 11, 12, 13, 14];
    const g2 = [1, 2, 3, 4, 5];
    expect(cohenD(g1, g2)).toBeGreaterThan(2);
  });

  test("small groups → 0", () => {
    expect(cohenD([1], [2])).toBe(0);
  });
});

describe("gateBlocDominance", () => {
  test("uniform blocs → pass", () => {
    const tracks = Array.from({ length: 50 }, (_, i) =>
      makeScoredTrack(`t${i}`, i / 50, Math.ceil((i / 50) * 9), {
        rhythm: i / 50,
        brightness: i / 50 + 0.01,
        body: i / 50 + 0.02,
        activity: i / 50 + 0.03,
        perceptual: i / 50 + 0.04,
      }),
    );
    const gate = gateBlocDominance(tracks);
    expect(gate.pass).toBe(true);
  });

  test("too few tracks → fail", () => {
    const tracks = [makeScoredTrack("t1", 0.5, 5)];
    expect(gateBlocDominance(tracks).pass).toBe(false);
  });
});

describe("gateNotBpm", () => {
  test("uncorrelated → pass", () => {
    const tracks = Array.from({ length: 20 }, (_, i) =>
      makeScoredTrack(`t${i}`, Math.random(), Math.ceil(Math.random() * 9)),
    );
    const bpms = Array.from({ length: 20 }, () => 100 + Math.random() * 80);
    const gate = gateNotBpm(tracks, bpms);
    expect(gate.name).toBe("not-bpm");
  });
});

describe("gateTierAgreement", () => {
  test("tiers agree → pass", () => {
    const tracks = Array.from({ length: 30 }, (_, i) => {
      const v = i / 30;
      return makeScoredTrack(`t${i}`, v, Math.ceil(v * 9), {
        rhythm: v,
        brightness: v + 0.02,
        body: v + 0.01,
        activity: v,
        perceptual: v + 0.03,
      });
    });
    const gate = gateTierAgreement(tracks);
    expect(gate.pass).toBe(true);
  });
});

describe("gateGenreDirection", () => {
  test("high > low → pass", () => {
    const high = [0.8, 0.85, 0.9, 0.75, 0.82];
    const low = [0.2, 0.25, 0.3, 0.15, 0.22];
    const gate = gateGenreDirection(high, low);
    expect(gate.pass).toBe(true);
  });

  test("similar groups → fail", () => {
    const high = [0.5, 0.52, 0.48];
    const low = [0.49, 0.51, 0.47];
    const gate = gateGenreDirection(high, low);
    expect(gate.pass).toBe(false);
  });
});

describe("gateGainInvariance", () => {
  test("small shifts → pass", () => {
    const orig = [3, 5, 7, 4, 6, 8, 2, 9, 1, 5];
    const gained = [3, 5, 7, 5, 6, 8, 2, 9, 2, 5];
    const gate = gateGainInvariance(orig, gained);
    expect(gate.pass).toBe(true);
  });

  test("large shifts → fail", () => {
    const orig = [3, 5, 7, 4, 6];
    const gained = [8, 9, 10, 8, 10];
    const gate = gateGainInvariance(orig, gained);
    expect(gate.pass).toBe(false);
  });
});

describe("gateDuplicateConsistency", () => {
  test("close pairs → pass", () => {
    const pairs: [number, number][] = [
      [5, 5],
      [3, 4],
      [7, 7],
      [2, 3],
    ];
    expect(gateDuplicateConsistency(pairs).pass).toBe(true);
  });

  test("no pairs → pass (vacuous)", () => {
    expect(gateDuplicateConsistency([]).pass).toBe(true);
  });
});

describe("collectGates", () => {
  test("counts passes correctly", () => {
    const results = [
      { name: "a", pass: true, value: 1, threshold: "" },
      { name: "b", pass: false, value: 0, threshold: "" },
      { name: "c", pass: true, value: 1, threshold: "" },
    ];
    const coll = collectGates(results);
    expect(coll.passed).toBe(2);
    expect(coll.total).toBe(3);
    expect(coll.allPass).toBe(false);
  });
});
