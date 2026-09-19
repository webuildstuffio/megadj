import { describe, expect, it } from "bun:test";
import { requireCliSummary, summaryCount } from "../src/cli-job-leg";

describe("shared CLI job summary boundary", () => {
  it("requires a JSON summary after a successful subprocess", () => {
    expect(() => requireCliSummary(null, "megadj shelf-hygiene")).toThrow(
      "missing JSON summary",
    );
    expect(requireCliSummary({ detected: 2 }, "megadj shelf-hygiene")).toEqual({
      detected: 2,
    });
  });

  it("accepts only safe non-negative integer counters", () => {
    expect(summaryCount(0)).toBe(0);
    expect(summaryCount(3)).toBe(3);
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "2"]) {
      expect(() => summaryCount(value), String(value)).toThrow(
        "non-negative integer",
      );
    }
  });
});
