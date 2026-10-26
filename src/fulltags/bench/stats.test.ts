import { describe, expect, test } from "bun:test";
import {
  accuracy,
  bootstrapAccuracyCI,
  bootstrapCI,
  confusionMatrix,
  ece,
  macroF1,
  mcnemar,
  MIN_N,
  mulberry32,
  riskCoverageCurve,
} from "./stats";
import type { BenchRow } from "./types";

const row = (
  trackId: string,
  truth: string,
  pred: string,
  conf: number | null = null,
): BenchRow => ({ runId: "test", trackId, truth, pred, conf, correct: truth === pred ? 1 : 0 });

describe("mulberry32 PRNG", () => {
  test("deterministic — same seed produces same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  test("values in [0, 1)", () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("bootstrapAccuracyCI", () => {
  test("empty input", () => {
    const ci = bootstrapAccuracyCI([]);
    expect(ci.estimate).toBe(0);
    expect(ci.nResamples).toBe(0);
  });

  test("perfect accuracy", () => {
    const correct: (0 | 1)[] = Array.from({ length: 100 }, () => 1);
    const ci = bootstrapAccuracyCI(correct);
    expect(ci.estimate).toBe(1);
    expect(ci.lo).toBe(1);
    expect(ci.hi).toBe(1);
  });

  test("50% accuracy — CI brackets the true value", () => {
    const correct: (0 | 1)[] = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 1 : 0));
    const ci = bootstrapAccuracyCI(correct, 2000, 42);
    expect(ci.estimate).toBe(0.5);
    expect(ci.lo).toBeLessThan(0.5);
    expect(ci.hi).toBeGreaterThan(0.5);
    expect(ci.lo).toBeGreaterThan(0.35);
    expect(ci.hi).toBeLessThan(0.65);
  });

  test("known 80% accuracy — CI width narrows with n", () => {
    const small: (0 | 1)[] = Array.from({ length: 50 }, (_, i) => (i < 40 ? 1 : 0));
    const large: (0 | 1)[] = Array.from({ length: 500 }, (_, i) => (i < 400 ? 1 : 0));
    const ciSmall = bootstrapAccuracyCI(small, 1000, 7);
    const ciLarge = bootstrapAccuracyCI(large, 1000, 7);
    expect(ciSmall.hi - ciSmall.lo).toBeGreaterThan(ciLarge.hi - ciLarge.lo);
    expect(ciSmall.estimate).toBe(0.8);
    expect(ciLarge.estimate).toBe(0.8);
  });

  test("deterministic with same seed", () => {
    const data: (0 | 1)[] = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0];
    const a = bootstrapAccuracyCI(data, 500, 99);
    const b = bootstrapAccuracyCI(data, 500, 99);
    expect(a).toEqual(b);
  });
});

describe("bootstrapCI (generic)", () => {
  test("accuracy metric on bench rows", () => {
    const rows = [
      row("t1", "house", "house"),
      row("t2", "techno", "techno"),
      row("t3", "house", "techno"),
      row("t4", "techno", "techno"),
      row("t5", "house", "house"),
    ];
    const ci = bootstrapCI(rows, (s) => accuracy(s), { metric: "accuracy" });
    expect(ci.estimate).toBe(0.8);
    expect(ci.lo).toBeLessThanOrEqual(ci.estimate);
    expect(ci.hi).toBeGreaterThanOrEqual(ci.estimate);
  });
});

describe("mcnemar", () => {
  test("identical runs — no significant difference", () => {
    const rows = [row("t1", "a", "a"), row("t2", "b", "b"), row("t3", "a", "b")];
    const result = mcnemar(rows, rows);
    expect(result.b).toBe(0);
    expect(result.c).toBe(0);
    expect(result.chi2).toBe(0);
    expect(result.p).toBe(1);
    expect(result.significant).toBe(false);
  });

  test("one-sided improvement — A perfect, B all wrong", () => {
    const rowsA: BenchRow[] = Array.from({ length: 50 }, (_, i) => row(`t${i}`, "a", "a"));
    const rowsB: BenchRow[] = Array.from({ length: 50 }, (_, i) => row(`t${i}`, "a", "b"));
    const result = mcnemar(rowsA, rowsB);
    expect(result.b).toBe(50);
    expect(result.c).toBe(0);
    expect(result.chi2).toBeGreaterThan(0);
    expect(result.p).toBeLessThan(0.05);
    expect(result.significant).toBe(true);
  });

  test("known values: b=10, c=3 — standard textbook case", () => {
    const rowsA: BenchRow[] = [];
    const rowsB: BenchRow[] = [];
    for (let i = 0; i < 10; i++) {
      rowsA.push(row(`b${i}`, "a", "a"));
      rowsB.push(row(`b${i}`, "a", "b"));
    }
    for (let i = 0; i < 3; i++) {
      rowsA.push(row(`c${i}`, "a", "b"));
      rowsB.push(row(`c${i}`, "a", "a"));
    }
    for (let i = 0; i < 20; i++) {
      rowsA.push(row(`d${i}`, "a", "a"));
      rowsB.push(row(`d${i}`, "a", "a"));
    }
    const result = mcnemar(rowsA, rowsB);
    expect(result.b).toBe(10);
    expect(result.c).toBe(3);
    // (|10-3|-1)^2 / (10+3) = 36/13 ≈ 2.769
    expect(result.chi2).toBeCloseTo(2.769, 2);
  });

  test("unmatched tracks are skipped", () => {
    const rowsA = [row("t1", "a", "a"), row("t2", "a", "b")];
    const rowsB = [row("t1", "a", "b"), row("t3", "a", "a")];
    const result = mcnemar(rowsA, rowsB);
    expect(result.b).toBe(1);
    expect(result.c).toBe(0);
  });
});

describe("riskCoverageCurve", () => {
  test("empty rows", () => {
    expect(riskCoverageCurve([])).toEqual([]);
  });

  test("all high-confidence correct", () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(`t${i}`, "a", "a", 0.95));
    const curve = riskCoverageCurve(rows);
    expect(curve.length).toBe(21);
    const point90 = curve.find((p) => p.threshold === 0.9);
    expect(point90).toBeDefined();
    expect(point90!.coverage).toBe(1);
    expect(point90!.accuracy).toBe(1);
  });

  test("coverage decreases with threshold", () => {
    const rows = [
      row("t1", "a", "a", 0.9),
      row("t2", "a", "a", 0.7),
      row("t3", "a", "b", 0.5),
      row("t4", "a", "a", 0.3),
      row("t5", "a", "b", 0.1),
    ];
    const curve = riskCoverageCurve(rows);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.coverage).toBeLessThanOrEqual(curve[i - 1]!.coverage);
    }
  });
});

describe("accuracy", () => {
  test("empty", () => expect(accuracy([])).toBe(0));
  test("all correct", () => {
    expect(accuracy([row("t1", "a", "a"), row("t2", "b", "b")])).toBe(1);
  });
  test("50%", () => {
    expect(accuracy([row("t1", "a", "a"), row("t2", "a", "b")])).toBe(0.5);
  });
});

describe("macroF1", () => {
  test("perfect", () => {
    const rows = [
      row("t1", "a", "a"),
      row("t2", "b", "b"),
      row("t3", "a", "a"),
      row("t4", "b", "b"),
    ];
    expect(macroF1(rows)).toBe(1);
  });

  test("all wrong", () => {
    const rows = [row("t1", "a", "b"), row("t2", "b", "a")];
    expect(macroF1(rows)).toBe(0);
  });

  test("imbalanced — macro penalizes minority class errors", () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => row(`a${i}`, "a", "a")),
      row("b0", "b", "a"),
    ];
    const f1 = macroF1(rows);
    expect(f1).toBeLessThan(1);
    expect(f1).toBeGreaterThan(0.4);
  });
});

describe("confusionMatrix", () => {
  test("2x2", () => {
    const rows = [
      row("t1", "house", "house"),
      row("t2", "techno", "house"),
      row("t3", "house", "techno"),
      row("t4", "techno", "techno"),
    ];
    const mat = confusionMatrix(rows);
    expect(mat.get("house")!.get("house")).toBe(1);
    expect(mat.get("house")!.get("techno")).toBe(1);
    expect(mat.get("techno")!.get("house")).toBe(1);
    expect(mat.get("techno")!.get("techno")).toBe(1);
  });
});

describe("ece", () => {
  test("perfectly calibrated — ECE ≈ 0", () => {
    const rows: BenchRow[] = [];
    for (let i = 0; i < 100; i++) {
      const conf = 0.8;
      const correct = i < 80 ? 1 : 0;
      rows.push({ ...row(`t${i}`, "a", correct ? "a" : "b", conf), correct: correct as 0 | 1 });
    }
    const e = ece(rows);
    expect(e).toBeLessThan(0.05);
  });

  test("overconfident — ECE > 0", () => {
    const rows: BenchRow[] = [];
    for (let i = 0; i < 100; i++) {
      const conf = 0.95;
      const correct = i < 50 ? 1 : 0;
      rows.push({ ...row(`t${i}`, "a", correct ? "a" : "b", conf), correct: correct as 0 | 1 });
    }
    const e = ece(rows);
    expect(e).toBeGreaterThan(0.3);
  });
});

describe("MIN_N constant", () => {
  test("is 30", () => expect(MIN_N).toBe(30));
});
