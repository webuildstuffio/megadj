import { describe, expect, it } from "bun:test";
import {
  finiteJobNumber,
  lastFinalLine,
  parseAuditSummary,
  parseIngestSummary,
  requireSuccessfulExit,
} from "../src/job_legs";
import { INTAKE_COUNTER_KEYS } from "../shared/types";

describe("job subprocess completion", () => {
  it("uses the last FINAL line when a verifier prints retries", () => {
    expect(
      lastFinalLine("FINAL: ALL PASS\nretrying\nFINAL: FAILED — 1 issue\n"),
    ).toBe("FINAL: FAILED — 1 issue");
  });

  it("fails closed on non-zero and unknown subprocess exits", () => {
    expect(() => requireSuccessfulExit("mirror", 0, "warning")).not.toThrow();
    expect(() => requireSuccessfulExit("mirror", 2, "copy failed")).toThrow(
      "mirror exited 2: copy failed",
    );
    expect(() => requireSuccessfulExit("mirror", null, "")).toThrow(
      "mirror exited unknown",
    );
  });
});

describe("job summary numeric boundary", () => {
  it("accepts non-negative integer subprocess counters", () => {
    expect(finiteJobNumber(12)).toBe(12);
    expect(finiteJobNumber(0)).toBe(0);
  });

  it("rejects missing, coerced, non-finite, fractional, and negative counts", () => {
    for (const value of [
      undefined,
      "7",
      "not-a-number",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      -1,
      1.5,
    ]) {
      expect(() => finiteJobNumber(value), String(value)).toThrow(
        "non-negative integer",
      );
    }
  });

  it("rejects a missing or incomplete ingest summary instead of storing zeros", () => {
    expect(() => parseIngestSummary(null)).toThrow("missing JSON summary");
    expect(() => parseIngestSummary({})).toThrow("files");
  });

  it("accepts the complete ingest counter contract", () => {
    // Keys come from THE SSOT (cratedeck/shared/types.ts, #159) — was a
    // hand-copied list that let `writeFailed` fall out of the contract.
    const counters = Object.fromEntries(
      INTAKE_COUNTER_KEYS.map((key) => [key, 0]),
    );
    expect(parseIngestSummary(counters)).toMatchObject(counters);
  });

  it("validates the post-ingest audit schema", () => {
    expect(() => parseAuditSummary("{}")).toThrow("total");
    expect(() => parseAuditSummary('{"total":2,"complete":null}')).toThrow(
      "complete",
    );
    expect(() =>
      parseAuditSummary(
        '{"total":2,"complete":1,"incomplete":[{"file":7,"missing":"mood"}]}',
      ),
    ).toThrow("incomplete");
    expect(
      parseAuditSummary(
        '{"total":2,"complete":1,"incomplete":[{"file":"a.mp3","missing":"mood"}]}',
      ),
    ).toEqual({
      audit: { total: 2, complete: 1 },
      auditErrors: [{ file: "a.mp3", missing: "mood" }],
    });
  });
});
