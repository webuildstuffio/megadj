/**
 * dawid-skene.test.ts — Tests for Dawid-Skene label model (B5.2).
 */
import { describe, expect, test } from "bun:test";
import { dawidSkene, type Annotation } from "./dawid-skene";

const CLASSES = ["house", "techno", "trance"];

describe("dawidSkene", () => {
  test("empty input → empty output", () => {
    const result = dawidSkene([], CLASSES);
    expect(result.posteriors).toHaveLength(0);
    expect(result.converged).toBe(true);
    expect(result.iterations).toBe(0);
  });

  test("unanimous annotators → confident posterior", () => {
    const anns: Annotation[] = [
      { trackId: "t1", annotatorId: "a1", label: "house" },
      { trackId: "t1", annotatorId: "a2", label: "house" },
      { trackId: "t1", annotatorId: "a3", label: "house" },
    ];
    const result = dawidSkene(anns, CLASSES);
    expect(result.posteriors).toHaveLength(1);
    expect(result.posteriors[0]!.family).toBe("house");
    expect(result.posteriors[0]!.probability).toBeGreaterThan(0.8);
    expect(result.converged).toBe(true);
  });

  test("split vote → model resolves based on reliability", () => {
    // Two reliable annotators say house, one says techno
    const anns: Annotation[] = [
      // Track 1: all agree on house
      { trackId: "t1", annotatorId: "a1", label: "house" },
      { trackId: "t1", annotatorId: "a2", label: "house" },
      { trackId: "t1", annotatorId: "a3", label: "house" },
      // Track 2: a1 and a2 agree on techno, a3 disagrees
      { trackId: "t2", annotatorId: "a1", label: "techno" },
      { trackId: "t2", annotatorId: "a2", label: "techno" },
      { trackId: "t2", annotatorId: "a3", label: "house" },
      // Track 3: the disputed one — a1+a2 say house, a3 says techno
      { trackId: "t3", annotatorId: "a1", label: "house" },
      { trackId: "t3", annotatorId: "a2", label: "house" },
      { trackId: "t3", annotatorId: "a3", label: "techno" },
    ];
    const result = dawidSkene(anns, CLASSES);
    expect(result.posteriors).toHaveLength(3);
    // t3: majority says house
    const t3 = result.posteriors.find((p) => p.trackId === "t3");
    expect(t3).toBeDefined();
    expect(t3!.family).toBe("house");
  });

  test("learns annotator reliability", () => {
    // reliable = always correct, noisy = 50% correct (random)
    const anns: Annotation[] = [];
    for (let i = 0; i < 30; i++) {
      const trueLabel = i < 15 ? "house" : "techno";
      anns.push({
        trackId: `t${i}`,
        annotatorId: "reliable",
        label: trueLabel,
      });
      // Noisy: 50% accuracy — every other one flipped
      const noisyLabel =
        i % 2 === 0 ? trueLabel : trueLabel === "house" ? "techno" : "house";
      anns.push({ trackId: `t${i}`, annotatorId: "noisy", label: noisyLabel });
    }
    const result = dawidSkene(anns, CLASSES);
    const reliable = result.annotators.find(
      (a) => a.annotatorId === "reliable",
    );
    const noisy = result.annotators.find((a) => a.annotatorId === "noisy");
    expect(reliable).toBeDefined();
    expect(noisy).toBeDefined();
    // Reliable annotator should have higher accuracy
    expect(reliable!.accuracy).toBeGreaterThanOrEqual(noisy!.accuracy);
  });

  test("converges within max iterations", () => {
    const anns: Annotation[] = [];
    for (let i = 0; i < 50; i++) {
      const label = CLASSES[i % 3]!;
      anns.push({ trackId: `t${i}`, annotatorId: "a1", label });
      anns.push({ trackId: `t${i}`, annotatorId: "a2", label });
    }
    const result = dawidSkene(anns, CLASSES, { maxIterations: 100 });
    expect(result.converged).toBe(true);
    expect(result.iterations).toBeLessThanOrEqual(100);
  });

  test("priors reflect label distribution", () => {
    const anns: Annotation[] = [];
    // 15 house, 5 techno
    for (let i = 0; i < 20; i++) {
      const label = i < 15 ? "house" : "techno";
      anns.push({ trackId: `t${i}`, annotatorId: "a1", label });
    }
    const result = dawidSkene(anns, CLASSES);
    const housePrior = result.priors.get("house") ?? 0;
    const technoPrior = result.priors.get("techno") ?? 0;
    expect(housePrior).toBeGreaterThan(technoPrior);
  });

  test("posterior distribution sums to ~1", () => {
    const anns: Annotation[] = [
      { trackId: "t1", annotatorId: "a1", label: "house" },
      { trackId: "t1", annotatorId: "a2", label: "techno" },
    ];
    const result = dawidSkene(anns, CLASSES);
    const dist = result.posteriors[0]!.distribution;
    let sum = 0;
    for (const [, p] of dist) sum += p;
    expect(sum).toBeCloseTo(1, 5);
  });

  test("family2 is the second-best class", () => {
    const anns: Annotation[] = [
      { trackId: "t1", annotatorId: "a1", label: "house" },
      { trackId: "t1", annotatorId: "a2", label: "house" },
      { trackId: "t1", annotatorId: "a3", label: "techno" },
    ];
    const result = dawidSkene(anns, CLASSES);
    const t1 = result.posteriors[0]!;
    expect(t1.family).toBe("house");
    expect(t1.family2).toBe("techno");
    expect(t1.probability2).not.toBeNull();
    expect(t1.probability).toBeGreaterThan(t1.probability2!);
  });

  test("single annotator per track still works", () => {
    const anns: Annotation[] = [
      { trackId: "t1", annotatorId: "a1", label: "trance" },
      { trackId: "t2", annotatorId: "a1", label: "house" },
    ];
    const result = dawidSkene(anns, CLASSES);
    expect(result.posteriors).toHaveLength(2);
    expect(result.posteriors[0]!.family).toBe("trance");
    expect(result.posteriors[1]!.family).toBe("house");
  });
});
