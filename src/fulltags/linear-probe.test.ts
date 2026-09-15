import { describe, expect, test } from "bun:test";
import {
  fitProbe,
  probeLeaveOneOut,
  probePredict,
  type ProbeRow,
} from "./linear-probe";

/** Two well-separated 2-d families — the probe must learn the split. */
const pop = (): ProbeRow[] => [
  ...Array.from({ length: 8 }, (_, i) => ({
    videoId: `h${i}`,
    label: "house",
    vec: l2([1 + i * 0.01, 0]),
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    videoId: `t${i}`,
    label: "techno",
    vec: l2([0, 1 + i * 0.01]),
  })),
];

const l2 = (v: number[]): number[] => {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return v.map((x) => x / n);
};

describe("linear probe (genre readout on frozen vectors)", () => {
  test("learns separated families and predicts them exactly", () => {
    const rows = pop();
    const { fit, loss } = fitProbe(rows, { epochs: 300 });
    expect(fit.classes).toEqual(["house", "techno"]);
    expect(loss).toBeLessThan(0.1);
    for (const row of rows) expect(probePredict(fit, row.vec)).toBe(row.label);
  });

  test("deterministic: same input → same weights → same predictions", () => {
    const rows = pop();
    const a = fitProbe(rows);
    const b = fitProbe(rows);
    expect(a.fit.weights).toEqual(b.fit.weights);
    expect(a.fit.bias).toEqual(b.fit.bias);
  });

  test("LOO harness recovers a clean library at 100%", () => {
    const r = probeLeaveOneOut(pop(), 0);
    expect(r.protocol).toBe("loo");
    expect(r.evaluated).toBe(16);
    expect(r.accuracy).toBe(1);
  });

  test("5-fold CV estimates the same held-out accuracy on clean data", () => {
    const r = probeLeaveOneOut(pop());
    expect(r.protocol).toBe("5-fold-cv");
    expect(r.evaluated).toBe(16);
    expect(r.accuracy).toBe(1);
  });

  test("an ambiguous row is honestly mispredicted, not skipped", () => {
    const rows = [
      ...pop(),
      { videoId: "x", label: "house", vec: l2([0.5, 0.5]) }, // halfway
    ];
    const r = probeLeaveOneOut(rows, 0);
    expect(r.evaluated).toBe(17);
    expect(r.predictions.at(-1)).toEqual({
      videoId: "x",
      truth: "house",
      predicted: expect.any(String),
    });
  });

  test("every fold evaluates each row exactly once (stratified CV)", () => {
    const rows = pop();
    const r = probeLeaveOneOut(rows);
    expect(r.predictions.length).toBe(16);
    const ids = r.predictions.map((p) => p.videoId).toSorted();
    expect(new Set(ids).size).toBe(16);
  });

  test("empty population degrades to zero, never throws", () => {
    const { fit } = fitProbe([]);
    expect(fit.classes).toEqual([]);
    const r = probeLeaveOneOut([]);
    expect(r.accuracy).toBe(0);
  });
});
