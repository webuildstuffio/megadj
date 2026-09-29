/**
 * estimator.test.ts — Tests for the genre estimator integration (B5.5).
 */
import { describe, expect, test } from "bun:test";
import {
  estimateGenres,
  estimatorEnabled,
  type EstimatorInput,
} from "./estimator";

describe("estimatorEnabled", () => {
  test("returns false when env not set", () => {
    const prev = process.env["MEGADJ_GENRE_ESTIMATOR"];
    delete process.env["MEGADJ_GENRE_ESTIMATOR"];
    expect(estimatorEnabled()).toBe(false);
    if (prev !== undefined) process.env["MEGADJ_GENRE_ESTIMATOR"] = prev;
  });

  test("returns true when env is '1'", () => {
    const prev = process.env["MEGADJ_GENRE_ESTIMATOR"];
    process.env["MEGADJ_GENRE_ESTIMATOR"] = "1";
    expect(estimatorEnabled()).toBe(true);
    if (prev !== undefined) {
      process.env["MEGADJ_GENRE_ESTIMATOR"] = prev;
    } else {
      delete process.env["MEGADJ_GENRE_ESTIMATOR"];
    }
  });
});

describe("estimateGenres", () => {
  test("empty input → empty output", () => {
    const result = estimateGenres([]);
    expect(result.outputs.size).toBe(0);
    expect(result.gatedCount).toBe(0);
    expect(result.ungatedCount).toBe(0);
  });

  test("strong consensus → gated output", () => {
    const inputs: EstimatorInput[] = [
      {
        trackId: "t1",
        annotations: [
          { trackId: "t1", annotatorId: "bp:exact", label: "house" },
          { trackId: "t1", annotatorId: "sc:exact", label: "house" },
          { trackId: "t1", annotatorId: "it:exact", label: "house" },
        ],
        l3Evidence: [{ rawGenre: "deep house", family: "house", weight: 3 }],
      },
    ];
    const result = estimateGenres(inputs);
    const out = result.outputs.get("t1");
    expect(out).toBeDefined();
    expect(out!.family).toBe("house");
    expect(out!.probability).toBeGreaterThan(0.5);
    expect(out!.l3.length).toBeGreaterThan(0);
  });

  test("conflicting evidence → may not gate", () => {
    const inputs: EstimatorInput[] = [
      {
        trackId: "t1",
        annotations: [
          { trackId: "t1", annotatorId: "bp:exact", label: "house" },
          { trackId: "t1", annotatorId: "sc:exact", label: "techno" },
          { trackId: "t1", annotatorId: "it:exact", label: "trance" },
        ],
        l3Evidence: [],
      },
    ];
    const result = estimateGenres(inputs);
    const out = result.outputs.get("t1");
    expect(out).toBeDefined();
    // With even split, posterior probability should be lower
    expect(out!.probability).toBeLessThan(0.9);
  });

  test("batch processes multiple tracks", () => {
    const inputs: EstimatorInput[] = [
      {
        trackId: "t1",
        annotations: [
          { trackId: "t1", annotatorId: "bp:exact", label: "house" },
          { trackId: "t1", annotatorId: "sc:exact", label: "house" },
        ],
        l3Evidence: [],
      },
      {
        trackId: "t2",
        annotations: [
          { trackId: "t2", annotatorId: "bp:exact", label: "techno" },
          { trackId: "t2", annotatorId: "sc:exact", label: "techno" },
        ],
        l3Evidence: [],
      },
    ];
    const result = estimateGenres(inputs);
    expect(result.outputs.size).toBe(2);
    expect(result.gatedCount + result.ungatedCount).toBe(2);
  });
});
