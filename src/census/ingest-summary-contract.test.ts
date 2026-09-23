/**
 * ingest-summary-contract.test.ts — #159 part B: the emit-side key list of
 * `megadj ingest --json` is pinned to THE counter SSOT
 * (src/deck/shared/types.ts INTAKE_COUNTER_KEYS / IntakeCounterKey) and
 * must round-trip through cratedeck's parseIngestSummary — the exact
 * boundary the ingest job leg crosses at runtime.
 *
 * This closes the hand-copied-twin drift permanently: before this test,
 * the emit grew `writeFailed` while cratedeck's IntakeResult/parser never
 * knew it existed — a counter silently invisible to the dashboard.
 */
import { describe, expect, test } from "bun:test";
import {
  INTAKE_COUNTER_KEYS,
  type IntakeCounterKey,
} from "../deck/shared/types";
import {
  counterSummary,
  type IngestCounters,
} from "../getdat/commands/ingest-register";

/** Every counter the producer can emit, keyed by the SSOT. TypeScript
 *  enforces the shape statically (counterSummary's mapped type); this
 *  object is the runtime probe the round-trip test runs. */
function fullCounterSet(): Record<IntakeCounterKey, number> {
  const counters: IngestCounters = {
    tagged: 1,
    artAdded: 2,
    artQueued: 3,
    artSkippedWav: 4,
    shortSkipped: 5,
    unchanged: 6,
    wavConverted: 7,
    compatRejected: 8,
    compatHires: 9,
    writeFailed: 10,
  };
  // The producer's own derive step — same function ingest --json calls.
  const derived = counterSummary(counters);
  // run-derived keys (computed outside IngestCounters at emit time)
  return {
    files: 11,
    folderDupes: 12,
    archiveDupes: 13,
    upgrades: 14,
    broken: 15,
    ...derived,
  } as Record<IntakeCounterKey, number>;
}

describe("#159 ingest summary key contract (emit ↔ parse round-trip)", () => {
  test("counterSummary derives every counter-backed SSOT key", () => {
    const full = fullCounterSet();
    for (const key of INTAKE_COUNTER_KEYS) {
      expect(
        full[key],
        `producer emits counter "${key}" (IntakeCounterKey)`,
      ).toBeNumber();
    }
  });

  test("every emitted key parses through cratedeck's parseIngestSummary", async () => {
    const { parseIngestSummary } = await import("../deck/jobs/job-legs");
    const summary = {
      command: "ingest",
      dryRun: false,
      ...fullCounterSet(),
    };
    const parsed = parseIngestSummary(summary);
    // No key dropped, no key fabricated: exact SSOT equality both ways.
    expect(Object.keys(parsed).toSorted()).toEqual(
      [...INTAKE_COUNTER_KEYS].toSorted(),
    );
  });

  test("a key the producer stops emitting fails the parse (named, not silent)", async () => {
    const { parseIngestSummary } = await import("../deck/jobs/job-legs");
    const full = fullCounterSet();
    const hole = { ...full };
    delete (hole as Record<string, unknown>).tagged;
    expect(() => parseIngestSummary(hole)).toThrow(/tagged is invalid/);
  });
});
