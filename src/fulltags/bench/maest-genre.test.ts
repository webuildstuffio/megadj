/**
 * maest-genre.test.ts — Tests for MAEST genre challenger (B9.2).
 */
import { describe, expect, test } from "bun:test";
import {
  mapMaestPredictions,
  evaluateMaest,
  type MaestPrediction,
  type MaestL3Result,
} from "./maest-genre";
import type { GenreFamily } from "../genre/taxonomy-v3";

describe("mapMaestPredictions", () => {
  test("empty predictions → null family", () => {
    const result = mapMaestPredictions("t1", []);
    expect(result.bestFamily).toBeNull();
    expect(result.confidence).toBe(0);
  });

  test("maps known genre to family", () => {
    const preds: MaestPrediction[] = [
      { label: "Deep House", probability: 0.85 },
      { label: "Ambient", probability: 0.1 },
    ];
    const result = mapMaestPredictions("t1", preds);
    expect(result.bestFamily).toBe("house");
    expect(result.confidence).toBe(0.85);
    expect(result.bestSubgenre).toBe("deep house");
  });

  test("sorts by probability", () => {
    const preds: MaestPrediction[] = [
      { label: "Ambient", probability: 0.3 },
      { label: "Techno", probability: 0.9 },
    ];
    const result = mapMaestPredictions("t1", preds);
    expect(result.topPredictions[0]!.label).toBe("Techno");
  });

  test("respects topK limit", () => {
    const preds: MaestPrediction[] = Array.from({ length: 10 }, (_, i) => ({
      label: `genre-${i}`,
      probability: (10 - i) / 10,
    }));
    const result = mapMaestPredictions("t1", preds, 3);
    expect(result.topPredictions).toHaveLength(3);
  });
});

describe("evaluateMaest", () => {
  test("empty → zeros", () => {
    const result = evaluateMaest([], new Map());
    expect(result.totalTracks).toBe(0);
  });

  test("perfect predictions → 100% accuracy", () => {
    const results: MaestL3Result[] = [
      {
        trackId: "t1",
        topPredictions: [{ label: "House", probability: 0.9 }],
        bestFamily: "house",
        bestSubgenre: "house",
        confidence: 0.9,
      },
    ];
    const gt = new Map<string, GenreFamily>([["t1", "house"]]);
    const evalResult = evaluateMaest(results, gt);
    expect(evalResult.familyAccuracy).toBe(1);
  });

  test("unmapped predictions counted", () => {
    const results: MaestL3Result[] = [
      {
        trackId: "t1",
        topPredictions: [{ label: "Unknown", probability: 0.5 }],
        bestFamily: null,
        bestSubgenre: null,
        confidence: 0.5,
      },
    ];
    const gt = new Map<string, GenreFamily>([["t1", "house"]]);
    const evalResult = evaluateMaest(results, gt);
    expect(evalResult.unmappedRate).toBe(1);
  });
});
