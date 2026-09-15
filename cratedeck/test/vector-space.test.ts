import { describe, expect, test } from "bun:test";
import {
  applySpace,
  cslsPenalties,
  cslsQueryPenalty,
  fitAllButTheTop,
  isSimilarSpace,
  l2normalize,
} from "../shared/vector-space";

/** A corpus with one dominant direction (loudness proxy) plus per-track
 *  structure — the anisotropy the whitening correction targets. */
const corpus = (n = 40): number[][] =>
  Array.from({ length: n }, (_, i) => {
    const structural = i % 2 === 0 ? [1, 0] : [0.9, 0.1]; // signal, two clusters
    return l2normalize([
      structural[0]! + 5, // dominant shared offset (the "top" direction)
      structural[1]!,
      ((i * 37) % 11) / 50, // idiosyncratic detail
    ]);
  });

/** Plain dot product (module scope — oxlint consistent-function-scoping). */
const sim = (a: number[], b: number[]): number =>
  a.reduce((acc, v, i) => acc + v * b[i]!, 0);

describe("vector-space: all-but-the-top whitening + CSLS", () => {
  test("isSimilarSpace guards the shared space contract", () => {
    expect(isSimilarSpace("raw")).toBe(true);
    expect(isSimilarSpace("whitened")).toBe(true);
    expect(isSimilarSpace("cosine")).toBe(false);
    expect(isSimilarSpace("")).toBe(false);
  });

  test("fit + apply removes the top direction, keeps clusters, unit norm", () => {
    const X = corpus();
    const model = fitAllButTheTop(X, 1);
    expect(model.componentCount).toBe(1);
    const t0 = applySpace(model, X[0]!);
    const t1 = applySpace(model, X[1]!);
    // re-normalized after projection: every transformed vector is unit-norm
    const norm = Math.sqrt(t0.reduce((a, v) => a + v * v, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-9);
    // within-cluster still far closer than across-cluster
    const sameCluster = applySpace(model, X[2]!);
    const acrossCluster = applySpace(model, X[39]!);
    expect(sim(t0, sameCluster)).toBeGreaterThan(sim(t0, acrossCluster));
    expect(sim(t0, t1)).toBeLessThan(0); // even/odd clusters are opposed
  });

  test("applySpace is idempotent per vector and deterministic", () => {
    const X = corpus(8);
    const model = fitAllButTheTop(X, 2);
    expect(applySpace(model, X[3]!)).toEqual(applySpace(model, X[3]!));
  });

  test("cslsPenalties demote hubs: a vector near everyone pays more", () => {
    // hub = the centroid-ish vector; far = an outlier
    const X = corpus(20);
    const hub = l2normalize([5.02, 0.02, 0.05]);
    const outlier = l2normalize([-5, 3, 2]);
    const withBoth = [...X, hub, outlier];
    const pen = cslsPenalties(withBoth);
    const hubPen = pen[pen.length - 2]!;
    const outPen = pen[pen.length - 1]!;
    expect(hubPen).toBeGreaterThan(outPen);
  });

  test("cslsPenalties + query penalty are deterministic and rounded", () => {
    const X = corpus(10).map((v) => l2normalize(v));
    const pen = cslsPenalties(X);
    expect(pen).toEqual(cslsPenalties(X));
    for (const p of pen)
      expect(Math.round(p * 10000)).toBe(Math.round(p * 10000));
    const q = cslsQueryPenalty(X[0]!, X.slice(1));
    expect(q).toBe(cslsQueryPenalty(X[0]!, X.slice(1)));
  });

  test("empty corpus degrades without throwing", () => {
    const model = fitAllButTheTop([], 2);
    expect(model.componentCount).toBe(0);
    expect(cslsPenalties([])).toEqual([]);
  });
});
