/**
 * review-queue.test.ts — Tests for genre review queue (B5.7).
 */
import { describe, expect, test } from "bun:test";
import { buildReviewQueue, type EvidenceSummary } from "./review-queue";

describe("buildReviewQueue", () => {
  test("empty input → empty queue", () => {
    expect(buildReviewQueue([])).toHaveLength(0);
  });

  test("ranks most suspicious first", () => {
    const summaries: EvidenceSummary[] = [
      {
        trackId: "confident",
        title: "Confident",
        artist: "A",
        dbGenre: "house",
        posteriorFamily: "house",
        posteriorConfidence: 0.95,
        evidenceFamilies: ["house", "house", "house"],
      },
      {
        trackId: "suspicious",
        title: "Suspicious",
        artist: "B",
        dbGenre: "techno",
        posteriorFamily: "house",
        posteriorConfidence: 0.4,
        evidenceFamilies: ["house", "techno", "trance"],
      },
    ];
    const queue = buildReviewQueue(summaries);
    expect(queue[0]!.trackId).toBe("suspicious");
    expect(queue[0]!.suspicion).toBeGreaterThan(queue[1]!.suspicion);
  });

  test("drift increases suspicion", () => {
    const base: Omit<EvidenceSummary, "dbGenre"> = {
      trackId: "t1",
      title: "Track",
      artist: "A",
      posteriorFamily: "house",
      posteriorConfidence: 0.7,
      evidenceFamilies: ["house"],
    };
    const noDrift = buildReviewQueue([{ ...base, dbGenre: "house" }]);
    const withDrift = buildReviewQueue([{ ...base, dbGenre: "techno" }]);
    expect(withDrift[0]!.isDrift).toBe(true);
    expect(withDrift[0]!.suspicion).toBeGreaterThan(noDrift[0]!.suspicion);
  });

  test("low agreement increases suspicion", () => {
    const highAgreement: EvidenceSummary = {
      trackId: "t1",
      title: "High",
      artist: "A",
      dbGenre: "house",
      posteriorFamily: "house",
      posteriorConfidence: 0.8,
      evidenceFamilies: ["house", "house", "house"],
    };
    const lowAgreement: EvidenceSummary = {
      trackId: "t2",
      title: "Low",
      artist: "B",
      dbGenre: "house",
      posteriorFamily: "house",
      posteriorConfidence: 0.8,
      evidenceFamilies: ["house", "techno", "trance"],
    };
    const queue = buildReviewQueue([highAgreement, lowAgreement]);
    const high = queue.find((q) => q.trackId === "t1")!;
    const low = queue.find((q) => q.trackId === "t2")!;
    expect(low.suspicion).toBeGreaterThan(high.suspicion);
  });

  test("maxItems limits output", () => {
    const summaries: EvidenceSummary[] = Array.from(
      { length: 200 },
      (_, i) => ({
        trackId: `t${i}`,
        title: `Track ${i}`,
        artist: "A",
        dbGenre: "house",
        posteriorFamily: "house",
        posteriorConfidence: 0.5,
        evidenceFamilies: ["house"],
      }),
    );
    const queue = buildReviewQueue(summaries, 50);
    expect(queue).toHaveLength(50);
  });

  test("suspicion is bounded 0–1", () => {
    const summaries: EvidenceSummary[] = [
      {
        trackId: "t1",
        title: "Worst",
        artist: "A",
        dbGenre: "techno",
        posteriorFamily: "house",
        posteriorConfidence: 0.0,
        evidenceFamilies: ["techno", "trance"],
      },
    ];
    const queue = buildReviewQueue(summaries);
    expect(queue[0]!.suspicion).toBeLessThanOrEqual(1);
    expect(queue[0]!.suspicion).toBeGreaterThanOrEqual(0);
  });
});
