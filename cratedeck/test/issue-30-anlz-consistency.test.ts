import { describe, expect, test } from "bun:test";
import { parseVerifyReport } from "../src/jobs";

describe("issue #30: verify names ANLZ consistency honestly", () => {
  test("parses the non-authoritative ANLZ consistency field and wording", () => {
    const output = [
      "  tracks: 1",
      "  ANLZ consistency failures (generated): 1",
      'VERIFY_JSON: {"drives":{"DJX":{"tracks":1,"anlz_consistency":["/x"]}}}',
      "FINAL: FAILED",
    ].join("\n");

    const report = parseVerifyReport(output, false, "FINAL: FAILED", 1);
    const grids = report.checks.find((check) => check.id === "grids");

    expect(grids?.status).toBe("warn");
    expect(grids?.detail).toContain("ANLZ-vs-DB consistency");
    expect(grids?.offenders).toEqual(["/x"]);
  });
});
