/**
 * key-challengers.test.ts — Tests for key bake-off framework (B9.4).
 */
import { describe, expect, test } from "bun:test";
import { toCamelot, mirexScore, keyBakeoff } from "./key-challengers";

describe("toCamelot", () => {
  test("passes through Camelot notation", () => {
    expect(toCamelot("8A")).toBe("8A");
    expect(toCamelot("11b")).toBe("11B");
  });

  test("converts traditional keys", () => {
    expect(toCamelot("A minor")).toBe("8A");
    expect(toCamelot("C major")).toBe("8B");
    expect(toCamelot("F# minor")).toBe("11A");
  });

  test("unknown key → null", () => {
    expect(toCamelot("X#")).toBeNull();
  });
});

describe("mirexScore", () => {
  test("exact match → 1.0", () => {
    expect(mirexScore("8A", "8A")).toBe(1.0);
  });

  test("perfect fifth → 0.5", () => {
    expect(mirexScore("9A", "8A")).toBe(0.5);
    expect(mirexScore("7A", "8A")).toBe(0.5);
  });

  test("relative major/minor → 0.3", () => {
    expect(mirexScore("8A", "8B")).toBe(0.3);
  });

  test("parallel major/minor → 0.2", () => {
    // A minor (8A) parallel is A major (11B)
    expect(mirexScore("8A", "11B")).toBe(0.2);
  });

  test("unrelated keys → 0.0", () => {
    expect(mirexScore("1A", "6A")).toBe(0);
  });

  test("invalid key → 0.0", () => {
    expect(mirexScore("X", "8A")).toBe(0);
  });
});

describe("keyBakeoff", () => {
  test("perfect analyzer → 1.0 mean MIREX", () => {
    const results = [
      { trackId: "t1", detectedKey: "8A", confidence: 0.9 },
      { trackId: "t2", detectedKey: "11B", confidence: 0.85 },
    ];
    const answerKeys = new Map([
      ["t1", "8A"],
      ["t2", "11B"],
    ]);
    const result = keyBakeoff("perfect", results, answerKeys);
    expect(result.meanMirex).toBe(1);
    expect(result.exactAccuracy).toBe(1);
    expect(result.total).toBe(2);
  });

  test("no matching answer keys → zeros", () => {
    const results = [{ trackId: "t1", detectedKey: "8A", confidence: 0.9 }];
    const result = keyBakeoff("test", results, new Map());
    expect(result.total).toBe(0);
    expect(result.meanMirex).toBe(0);
  });
});
