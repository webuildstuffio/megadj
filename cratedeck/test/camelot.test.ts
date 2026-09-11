// camelot.test.ts — the shared Camelot SSOT (shared/camelot.ts).
// One parse table serves the set-builder engine and the crate browser;
// these tests pin the notation form, the open-key table, the compat
// scores and the UI relation labels in one place.
import { describe, expect, test } from "bun:test";
import {
  camelotOf,
  keyCompatScore,
  keyRelation,
  keySortToken,
} from "../shared/camelot";

describe("camelotOf (shared SSOT)", () => {
  test("parses Camelot notation, case-insensitive", () => {
    expect(camelotOf("8A")).toEqual({ n: 8, letter: "A" });
    expect(camelotOf("12b")).toEqual({ n: 12, letter: "B" });
    expect(camelotOf(" 4 a ")).toEqual({ n: 4, letter: "A" });
  });
  test("parses common open-key names — the form the crate twin once missed", () => {
    expect(camelotOf("Am")).toEqual({ n: 8, letter: "A" });
    expect(camelotOf("C")).toEqual({ n: 8, letter: "B" });
    expect(camelotOf("F#m")).toEqual({ n: 11, letter: "A" });
    expect(camelotOf("Gm")).toEqual({ n: 6, letter: "A" });
  });
  test("boundary numbers only (1–12) — '0A' and '13A' are not keys", () => {
    expect(camelotOf("0A")).toBeNull();
    expect(camelotOf("13A")).toBeNull();
  });
  test("unparsable → null (callers degrade, never throw)", () => {
    expect(camelotOf("banana")).toBeNull();
    expect(camelotOf(null)).toBeNull();
    expect(camelotOf(undefined)).toBeNull();
    expect(camelotOf("")).toBeNull();
  });
});

describe("keyCompatScore", () => {
  test("same key / energy flow / mood lift → 1", () => {
    expect(keyCompatScore({ n: 8, letter: "A" }, { n: 8, letter: "A" })).toBe(
      1,
    );
    expect(keyCompatScore({ n: 8, letter: "A" }, { n: 9, letter: "A" })).toBe(
      1,
    );
    expect(keyCompatScore({ n: 8, letter: "A" }, { n: 8, letter: "B" })).toBe(
      1,
    );
  });
  test("diagonal → 0.9, clash → 0, unparsable either side → 0.5", () => {
    expect(keyCompatScore({ n: 8, letter: "A" }, { n: 9, letter: "B" })).toBe(
      0.9,
    );
    expect(keyCompatScore({ n: 8, letter: "A" }, { n: 2, letter: "B" })).toBe(
      0,
    );
    expect(keyCompatScore(null, { n: 8, letter: "A" })).toBe(0.5);
  });
});

describe("keyRelation (the crate glow labels)", () => {
  test("same wheel position → 'same'", () => {
    expect(keyRelation("8A", { n: 8, letter: "A" })).toBe("same");
    // open-key form reaches the same verdict — the SSOT fix
    expect(keyRelation("Am", { n: 8, letter: "A" })).toBe("same");
  });
  test("±1 same letter or same number → 'compat'", () => {
    expect(keyRelation("7A", { n: 8, letter: "A" })).toBe("compat");
    expect(keyRelation("8B", { n: 8, letter: "A" })).toBe("compat");
  });
  test("clash or unparsable → ''", () => {
    expect(keyRelation("2B", { n: 8, letter: "A" })).toBe("");
    expect(keyRelation(null, { n: 8, letter: "A" })).toBe("");
  });
});

describe("keySortToken", () => {
  test("zero-padded so 10B sorts after 8B lexicographically", () => {
    const rows = ["12B", "8A", "10B", "1A"].map((k) => ({
      k,
      t: keySortToken(k),
    }));
    const sorted = rows
      .slice()
      .toSorted((a, b) => (a.t! < b.t! ? -1 : 1))
      .map((r) => r.k);
    expect(sorted).toEqual(["1A", "8A", "10B", "12B"]);
  });
  test("unparsable → null (sorts last via the table's nulls-last contract)", () => {
    expect(keySortToken("banana")).toBeNull();
  });
});
