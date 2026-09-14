import { describe, expect, it } from "bun:test";
import { finiteJobNumber } from "../src/job_execution";

describe("job summary numeric boundary", () => {
  it("accepts finite subprocess counters", () => {
    expect(finiteJobNumber(12)).toBe(12);
    expect(finiteJobNumber("7")).toBe(7);
  });

  it("falls back to zero for missing and non-finite counters", () => {
    expect(finiteJobNumber(undefined)).toBe(0);
    expect(finiteJobNumber("not-a-number")).toBe(0);
    expect(finiteJobNumber(Number.NaN)).toBe(0);
    expect(finiteJobNumber(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
