// archive-metrics.test.tsx — behavior pin for the ArchiveTab work-queue
// metrics (#199): deriveVerdict was split into archiveMetrics (payload
// extraction) + metricIssues (pill assembly); these pins keep the metric
// math byte-stable across further splits.
import { describe, expect, test } from "bun:test";
import { archiveMetrics } from "../products/drives/ArchiveTabVerdict";
import type {
  ArchiveGridCrossCheck,
  ArchiveIngestStatus,
  ArchiveLowqQueue,
  ArchiveMoodProfile,
} from "../../shared/types";

const ingest = (counts: Record<string, number>): ArchiveIngestStatus =>
  ({ available: true, counts }) as ArchiveIngestStatus;

const moodAt = (available: boolean, analyzed: number): ArchiveMoodProfile =>
  ({ available, analyzed }) as unknown as ArchiveMoodProfile;

describe("archiveMetrics", () => {
  test("empty payloads degrade to zeros", () => {
    const m = archiveMetrics(
      { available: false, counts: {} } as ArchiveIngestStatus,
      null,
      null,
      null,
    );
    expect(m).toEqual({
      syncRisk: 0,
      qualityDebt: 0,
      retryBacklog: 0,
      unanalyzed: 0,
      analyzed: 0,
      inArchive: 0,
    });
  });

  test("syncRisk sums off+octave+drift when grid is available", () => {
    const grid = {
      available: true,
      off: ["a", "b"],
      octave: ["c"],
      drift: [],
    } as unknown as ArchiveGridCrossCheck;
    expect(archiveMetrics(ingest({}), null, null, grid).syncRisk).toBe(3);
  });

  test("retryBacklog = failed + gone; inArchive = downloaded", () => {
    const m = archiveMetrics(
      ingest({ failed: 2, gone: 3, downloaded: 10 }),
      null,
      null,
      null,
    );
    expect(m.retryBacklog).toBe(5);
    expect(m.inArchive).toBe(10);
  });

  test("unanalyzed = inArchive − analyzed, floored at 0, only when mood ran", () => {
    expect(
      archiveMetrics(ingest({ downloaded: 10 }), moodAt(true, 4), null, null)
        .unanalyzed,
    ).toBe(6);
    // mood never ran → no backlog claim
    expect(
      archiveMetrics(ingest({ downloaded: 10 }), moodAt(false, 0), null, null)
        .unanalyzed,
    ).toBe(0);
  });

  test("qualityDebt tracks the LOWQ track list length", () => {
    const lowq = {
      available: true,
      tracks: [{}, {}, {}],
    } as unknown as ArchiveLowqQueue;
    expect(archiveMetrics(ingest({}), null, lowq, null).qualityDebt).toBe(3);
  });
});
