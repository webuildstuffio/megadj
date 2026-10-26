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
  const defaultBlocs = Object.fromEntries(BLOC_NAMES.map((b) => [b, composite])) as Record<
    (typeof BLOC_NAMES)[number],
    number
  >;
  return { videoId, composite, band, confidence: "high", blocs: { ...defaultBlocs, ...blocs } };
}

// --------------- spearmanRho ---------------

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
    expect(spearmanRho([1, 2], [3, 4])).toBe(0);
  });

  test("empty arrays → 0", () => {
    expect(spearmanRho([], [])).toBe(0);
  });

  test("mismatched lengths → uses shorter", () => {
    const rho = spearmanRho([1, 2, 3, 4, 5], [2, 4, 6]);
    expect(typeof rho).toBe("number");
    expect(Number.isFinite(rho)).toBe(true);
  });

  test("identical values → 0 (no variance)", () => {
    expect(spearmanRho([5, 5, 5, 5], [1, 2, 3, 4])).toBe(0);
  });

  test("tied values produce valid result", () => {
    const rho = spearmanRho([1, 1, 2, 3, 3], [1, 2, 2, 3, 3]);
    expect(Number.isFinite(rho)).toBe(true);
  });
});

// --------------- cohenD ---------------

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

  test("empty groups → 0", () => {
    expect(cohenD([], [1, 2, 3])).toBe(0);
    expect(cohenD([1, 2], [])).toBe(0);
  });

  test("reversed groups → negative d", () => {
    const g1 = [1, 2, 3, 4, 5];
    const g2 = [10, 11, 12, 13, 14];
    expect(cohenD(g1, g2)).toBeLessThan(-2);
  });
});

// --------------- gateBlocDominance ---------------

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
    expect(gate.name).toBe("bloc-dominance");
  });

  test("too few tracks → fail", () => {
    const tracks = [makeScoredTrack("t1", 0.5, 5)];
    const gate = gateBlocDominance(tracks);
    expect(gate.pass).toBe(false);
    expect(gate.detail).toBe("too few tracks");
  });

  test("one dominant bloc → fail", () => {
    const tracks = Array.from({ length: 50 }, (_, i) =>
      makeScoredTrack(`t${i}`, i / 50, Math.ceil((i / 50) * 9), {
        rhythm: (i / 50) * 10,
        brightness: 0.5,
        body: 0.5,
        activity: 0.5,
        perceptual: 0.5,
      }),
    );
    const gate = gateBlocDominance(tracks);
    expect(gate.pass).toBe(false);
    expect(gate.detail).toContain("rhythm");
  });

  test("exactly 10 tracks → passes minimum", () => {
    const tracks = Array.from({ length: 10 }, (_, i) =>
      makeScoredTrack(`t${i}`, i / 10, Math.ceil((i / 10) * 9), {
        rhythm: i / 10,
        brightness: i / 10 + 0.01,
        body: i / 10 + 0.02,
        activity: i / 10 + 0.03,
        perceptual: i / 10 + 0.04,
      }),
    );
    const gate = gateBlocDominance(tracks);
    expect(gate.name).toBe("bloc-dominance");
  });
});

// --------------- gateNotBpm ---------------

describe("gateNotBpm", () => {
  test("uncorrelated → pass", () => {
    const tracks = Array.from({ length: 20 }, (_, i) =>
      makeScoredTrack(`t${i}`, ((i * 7 + 3) % 20) / 20, Math.ceil((((i * 7 + 3) % 20) / 20) * 9)),
    );
    const bpms = Array.from({ length: 20 }, (_, i) => 100 + ((i * 13) % 80));
    const gate = gateNotBpm(tracks, bpms);
    expect(gate.name).toBe("not-bpm");
    expect(gate.pass).toBe(true);
  });

  test("perfectly correlated → fail", () => {
    const tracks = Array.from({ length: 20 }, (_, i) =>
      makeScoredTrack(`t${i}`, i / 20, Math.ceil((i / 20) * 9)),
    );
    const bpms = Array.from({ length: 20 }, (_, i) => 100 + i * 5);
    const gate = gateNotBpm(tracks, bpms);
    expect(gate.pass).toBe(false);
  });
});

// --------------- gateTierAgreement ---------------

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
    expect(gate.name).toBe("tier-agreement");
  });

  test("tiers disagree → fail", () => {
    const tracks = Array.from({ length: 30 }, (_, i) => {
      const v = i / 30;
      return makeScoredTrack(`t${i}`, v, Math.ceil(v * 9), {
        rhythm: v,
        brightness: v,
        body: v,
        activity: v,
        perceptual: 1 - v,
      });
    });
    const gate = gateTierAgreement(tracks);
    expect(gate.pass).toBe(false);
  });
});

// --------------- gateGenreDirection ---------------

describe("gateGenreDirection", () => {
  test("high > low → pass", () => {
    const high = [0.8, 0.85, 0.9, 0.75, 0.82];
    const low = [0.2, 0.25, 0.3, 0.15, 0.22];
    const gate = gateGenreDirection(high, low);
    expect(gate.pass).toBe(true);
    expect(gate.name).toBe("genre-direction");
  });

  test("similar groups → fail", () => {
    const high = [0.5, 0.52, 0.48];
    const low = [0.49, 0.51, 0.47];
    const gate = gateGenreDirection(high, low);
    expect(gate.pass).toBe(false);
  });

  test("too-small groups → fail (d=0)", () => {
    const gate = gateGenreDirection([0.8], [0.2]);
    expect(gate.pass).toBe(false);
    expect(gate.value).toBe(0);
  });

  test("detail includes group sizes", () => {
    const gate = gateGenreDirection([0.8, 0.9, 0.7], [0.2, 0.3]);
    expect(gate.detail).toContain("n=3");
    expect(gate.detail).toContain("n=2");
  });
});

// --------------- gateGainInvariance ---------------

describe("gateGainInvariance", () => {
  test("small shifts → pass", () => {
    const orig = [3, 5, 7, 4, 6, 8, 2, 9, 1, 5];
    const gained = [3, 5, 7, 5, 6, 8, 2, 9, 2, 5];
    const gate = gateGainInvariance(orig, gained);
    expect(gate.pass).toBe(true);
    expect(gate.name).toBe("gain-invariance");
  });

  test("large shifts → fail", () => {
    const orig = [3, 5, 7, 4, 6];
    const gained = [8, 9, 10, 8, 10];
    const gate = gateGainInvariance(orig, gained);
    expect(gate.pass).toBe(false);
  });

  test("empty arrays → fail", () => {
    const gate = gateGainInvariance([], []);
    expect(gate.pass).toBe(false);
    expect(gate.value).toBe("n/a");
  });

  test("mismatched lengths → uses shorter", () => {
    const orig = [3, 5, 7, 4, 6, 8, 2, 9, 1, 5];
    const gained = [3, 5, 7, 5, 6];
    const gate = gateGainInvariance(orig, gained);
    expect(typeof gate.value).toBe("number");
  });
});

// --------------- gateDuplicateConsistency ---------------

describe("gateDuplicateConsistency", () => {
  test("close pairs → pass", () => {
    const pairs: [number, number][] = [
      [5, 5],
      [3, 4],
      [7, 7],
      [2, 3],
    ];
    expect(gateDuplicateConsistency(pairs).pass).toBe(true);
    expect(gateDuplicateConsistency(pairs).name).toBe("duplicate-consistency");
  });

  test("no pairs → pass (vacuous)", () => {
    const gate = gateDuplicateConsistency([]);
    expect(gate.pass).toBe(true);
    expect(gate.detail).toBe("no pairs");
  });

  test("distant pairs → fail", () => {
    const pairs: [number, number][] = [
      [1, 9],
      [2, 8],
      [3, 7],
    ];
    expect(gateDuplicateConsistency(pairs).pass).toBe(false);
  });

  test("mixed close and far → depends on ratio", () => {
    const pairs: [number, number][] = [
      [5, 5],
      [3, 4],
      [7, 7],
      [2, 3],
      [1, 9],
    ];
    const gate = gateDuplicateConsistency(pairs);
    expect(typeof gate.value).toBe("number");
  });
});

// --------------- collectGates ---------------

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

  test("all pass → allPass true", () => {
    const results = [
      { name: "a", pass: true, value: 1, threshold: "" },
      { name: "b", pass: true, value: 1, threshold: "" },
    ];
    const coll = collectGates(results);
    expect(coll.allPass).toBe(true);
    expect(coll.passed).toBe(2);
  });

  test("empty results → 0/0 and allPass true", () => {
    const coll = collectGates([]);
    expect(coll.passed).toBe(0);
    expect(coll.total).toBe(0);
    expect(coll.allPass).toBe(true);
  });

  test("all fail → allPass false", () => {
    const results = [
      { name: "a", pass: false, value: 0, threshold: "" },
      { name: "b", pass: false, value: 0, threshold: "" },
    ];
    const coll = collectGates(results);
    expect(coll.allPass).toBe(false);
    expect(coll.passed).toBe(0);
  });

  test("results preserved in output", () => {
    const results = [{ name: "x", pass: true, value: 42, threshold: ">0" }];
    const coll = collectGates(results);
    expect(coll.results).toHaveLength(1);
    expect(coll.results[0]!.name).toBe("x");
    expect(coll.results[0]!.value).toBe(42);
  });
});
