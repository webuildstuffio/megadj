/**
 * bpm-source-audit.test.ts — Tests for BPM source audit (B1.5).
 */
import { describe, expect, test } from "bun:test";
import { auditBpmSources, type BpmProvenance } from "./bpm-source-audit";

describe("auditBpmSources", () => {
  test("empty input → empty result", () => {
    const result = auditBpmSources([], new Map());
    expect(result.totalTracks).toBe(0);
    expect(result.sourceBreakdown).toHaveLength(0);
  });

  test("groups by source", () => {
    const provenances: BpmProvenance[] = [
      { trackId: "t1", bpm: 128, source: "beat_this", analyzedAt: null },
      { trackId: "t2", bpm: 128, source: "beat_this", analyzedAt: null },
      { trackId: "t3", bpm: 128, source: "rekordbox", analyzedAt: null },
    ];
    const result = auditBpmSources(provenances, new Map());
    expect(result.sourceBreakdown).toHaveLength(2);
    const btSummary = result.sourceBreakdown.find(
      (s) => s.source === "beat_this",
    );
    expect(btSummary!.count).toBe(2);
  });

  test("computes accuracy against answer keys", () => {
    const provenances: BpmProvenance[] = [
      { trackId: "t1", bpm: 128, source: "beat_this", analyzedAt: null },
      { trackId: "t2", bpm: 130, source: "beat_this", analyzedAt: null },
    ];
    const answerKeys = new Map([
      ["t1", 128],
      ["t2", 128],
    ]);
    const result = auditBpmSources(provenances, answerKeys);
    const btSummary = result.sourceBreakdown.find(
      (s) => s.source === "beat_this",
    );
    expect(btSummary!.accuracy).toBe(0.5); // t1 exact, t2 off by ~1.6%
  });

  test("counts missing source", () => {
    const provenances: BpmProvenance[] = [
      { trackId: "t1", bpm: 128, source: "unknown", analyzedAt: null },
    ];
    const result = auditBpmSources(provenances, new Map());
    expect(result.missingSource).toBe(1);
  });
});
