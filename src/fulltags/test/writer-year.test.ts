// writer-year.test.ts — #230: the legacy-metadata year gate. The old
// `Number(match) || undefined` silently merged MALFORMED dates into
// ABSENT ones and admitted any 4 digits (0000/9999); `yearFromDate` is
// the explicit isFinite+range gate, census-visible (sanction removed
// from boundary-number-census).
import { describe, test, expect } from "bun:test";
import { yearFromDate } from "../write/writer";

describe("yearFromDate (#230)", () => {
  test("plain and padded years parse", () => {
    expect(yearFromDate("2024")).toBe(2024);
    expect(yearFromDate("1999-11-02")).toBe(1999);
    expect(yearFromDate("September 2019, remastered")).toBe(2019);
  });

  test("malformed dates read as ABSENT via the explicit gate, never NaN-merge", () => {
    expect(yearFromDate("garbage")).toBeUndefined();
    expect(yearFromDate("September")).toBeUndefined();
    expect(yearFromDate("")).toBeUndefined();
  });

  test("implausible 4-digit captures are refused (1000..3000 window)", () => {
    expect(yearFromDate("0000")).toBeUndefined();
    expect(yearFromDate("0100")).toBeUndefined();
    expect(yearFromDate("9999")).toBeUndefined();
    expect(yearFromDate("1000")).toBe(1000);
    expect(yearFromDate("3000")).toBe(3000);
  });

  test("first 4-digit run wins (mirrors the old regex semantics)", () => {
    expect(yearFromDate("12 2021")).toBe(2021);
    expect(yearFromDate("20211234")).toBe(2021);
  });
});
