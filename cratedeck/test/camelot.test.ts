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
  test("census: all 24 canonical keys map to their exact wheel position", () => {
    // The full Mixed In Key wheel, transcribed from the canonical tables.
    // A hand-copied drift once shipped 8 wrong entries that spot-checks
    // missed — the whole table is pinned here, entry by entry.
    const WHEEL: Record<string, [number, "A" | "B"]> = {
      Abm: [1, "A"],
      B: [1, "B"], //
      Ebm: [2, "A"],
      "F#": [2, "B"],
      Gb: [2, "B"], //
      Bbm: [3, "A"],
      Db: [3, "B"],
      "C#": [3, "B"],
      "A#m": [3, "A"], //
      Fm: [4, "A"],
      Ab: [4, "B"], //
      Cm: [5, "A"],
      Eb: [5, "B"], //
      Gm: [6, "A"],
      Bb: [6, "B"], //
      Dm: [7, "A"],
      F: [7, "B"], //
      Am: [8, "A"],
      C: [8, "B"], //
      Em: [9, "A"],
      G: [9, "B"], //
      Bm: [10, "A"],
      D: [10, "B"], //
      "F#m": [11, "A"],
      A: [11, "B"], //
      "C#m": [12, "A"],
      E: [12, "B"],
      Dbm: [12, "A"],
    };
    for (const [key, [n, letter]] of Object.entries(WHEEL)) {
      expect(camelotOf(key)).toEqual({ n, letter });
    }
  });
  test("table carries no entry outside the canonical wheel", () => {
    // Guards against BOTH failure modes: a wrong value AND an alias key
    // removed from OPEN_KEY_TO_CAMELOT (e.g. someone deletes Gb thinking
    // F# covers it — different TKEY spellings exist in the wild).
    for (const k of [
      "A#m",
      "Ab",
      "Abm",
      "B",
      "Bb",
      "Bbm",
      "C",
      "C#",
      "C#m",
      "Cm",
      "Db",
      "Dbm",
      "D",
      "Dm",
      "Eb",
      "Ebm",
      "E",
      "Em",
      "F",
      "F#",
      "F#m",
      "Fm",
      "G",
      "G#m",
      "Gb",
      "Gbm",
      "Gm",
      "A",
      "Am",
    ]) {
      expect(camelotOf(k)).not.toBeNull();
    }
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
  test("Open Key notation (Nm/Nd) shifts by 5 — 6m is 1A, 1d is 8B", () => {
    // canonical pairs from the published wheel tables; the naive
    // "N minor = NA" reading would mis-key every Nm/Nd track
    expect(camelotOf("6m")).toEqual({ n: 1, letter: "A" });
    expect(camelotOf("1d")).toEqual({ n: 8, letter: "B" });
    expect(camelotOf("7m")).toEqual({ n: 2, letter: "A" });
    expect(camelotOf("8d")).toEqual({ n: 3, letter: "B" });
    expect(camelotOf("12m")).toEqual({ n: 7, letter: "A" });
    expect(camelotOf("1m")).toEqual({ n: 8, letter: "A" });
    expect(camelotOf("8d")).toEqual(camelotOf("Db")); // same key, two notations
  });
  test("Western + mode suffix (Gmaj, Amin, Eb minor) matches its open-key row", () => {
    // spellings observed in the live library — must land on the same
    // wheel position as the open-key spelling of the same key
    expect(camelotOf("Gmaj")).toEqual(camelotOf("G"));
    expect(camelotOf("Amin")).toEqual(camelotOf("Am"));
    expect(camelotOf("Eb minor")).toEqual(camelotOf("Ebm"));
    expect(camelotOf("F# major")).toEqual(camelotOf("F#"));
    expect(camelotOf("Bbmoll")).toEqual(camelotOf("Bbm"));
    expect(camelotOf("C#dur")).toEqual(camelotOf("C#"));
    expect(camelotOf("C m")).toEqual(camelotOf("Cm")); // space-separated bare mode
    expect(camelotOf("A m")).toEqual(camelotOf("Am"));
    expect(camelotOf("Hmaj")).toBeNull(); // H is not a valid root here
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
  test("wheel wraps: 12↔1 is ±1, not an 11-step clash", () => {
    expect(keyCompatScore({ n: 12, letter: "A" }, { n: 1, letter: "A" })).toBe(
      1,
    );
    expect(keyCompatScore({ n: 12, letter: "B" }, { n: 1, letter: "B" })).toBe(
      1,
    );
    expect(keyCompatScore({ n: 1, letter: "A" }, { n: 12, letter: "A" })).toBe(
      1,
    );
    expect(keyCompatScore({ n: 12, letter: "A" }, { n: 1, letter: "B" })).toBe(
      0.9,
    );
    expect(keyRelation("1A", { n: 12, letter: "A" })).toBe("compat");
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
