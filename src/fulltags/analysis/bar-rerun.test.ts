/**
 * bar-rerun.test.ts — Tests for library bar-rerun queue (B2.3).
 */
import { describe, expect, test } from "bun:test";
import { computeProgress, buildRerunQueue } from "./bar-rerun";

describe("computeProgress", () => {
  test("empty → zeros", () => {
    const result = computeProgress([]);
    expect(result.total).toBe(0);
    expect(result.percentComplete).toBe(0);
  });

  test("counts statuses correctly", () => {
    const entries = [
      { trackId: "t1", status: "analyzed" as const, barCount: 64, analyzedAt: null, reason: null },
      { trackId: "t2", status: "pending" as const, barCount: null, analyzedAt: null, reason: null },
      {
        trackId: "t3",
        status: "failed" as const,
        barCount: null,
        analyzedAt: null,
        reason: "decode error",
      },
      {
        trackId: "t4",
        status: "skipped" as const,
        barCount: null,
        analyzedAt: null,
        reason: "no beats",
      },
    ];
    const result = computeProgress(entries);
    expect(result.total).toBe(4);
    expect(result.analyzed).toBe(1);
    expect(result.pending).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.percentComplete).toBe(25);
  });
});

describe("buildRerunQueue", () => {
  test("skips tracks without beats", () => {
    const queue = buildRerunQueue([
      { trackId: "t1", hasBeats: false, hasBarAnalysis: false, durationSeconds: 200 },
    ]);
    expect(queue[0]!.status).toBe("skipped");
    expect(queue[0]!.reason).toBe("no beats");
  });

  test("skips long tracks", () => {
    const queue = buildRerunQueue([
      { trackId: "t1", hasBeats: true, hasBarAnalysis: false, durationSeconds: 1200 },
    ]);
    expect(queue[0]!.status).toBe("skipped");
    expect(queue[0]!.reason).toContain("duration cap");
  });

  test("marks already-analyzed as analyzed", () => {
    const queue = buildRerunQueue([
      { trackId: "t1", hasBeats: true, hasBarAnalysis: true, durationSeconds: 200 },
    ]);
    expect(queue[0]!.status).toBe("analyzed");
  });

  test("force flag re-queues analyzed tracks", () => {
    const queue = buildRerunQueue(
      [{ trackId: "t1", hasBeats: true, hasBarAnalysis: true, durationSeconds: 200 }],
      { force: true },
    );
    expect(queue[0]!.status).toBe("pending");
  });

  test("eligible track is pending", () => {
    const queue = buildRerunQueue([
      { trackId: "t1", hasBeats: true, hasBarAnalysis: false, durationSeconds: 200 },
    ]);
    expect(queue[0]!.status).toBe("pending");
  });
});
