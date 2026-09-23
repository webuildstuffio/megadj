import { describe, expect, test } from "bun:test";
import { sqliteRowId } from "./sweeps";

// The rounding contract restored after the #221 merge (sqlite-id.ts →
// sweeps.ts): a 64-bit SQLite row id that `Number` would silently round
// must throw, never round-trip into a wrong ledger key.
describe("sqliteRowId", () => {
  test("accepts positive safe row ids", () => {
    expect(sqliteRowId(42n)).toBe(42);
  });

  test("accepts plain numbers unchanged", () => {
    expect(sqliteRowId(7)).toBe(7);
  });

  test("rejects row ids that Number would round", () => {
    expect(() => sqliteRowId(9_007_199_254_740_993n)).toThrow(
      "outside JavaScript's safe integer range",
    );
  });

  test("rejects zero and negatives", () => {
    expect(() => sqliteRowId(0)).toThrow();
    expect(() => sqliteRowId(-1n)).toThrow();
  });
});
