import { describe, expect, test } from "bun:test";
import { sqliteRowId } from "./sqlite-id";

describe("sqliteRowId", () => {
  test("accepts positive safe row ids", () => {
    expect(sqliteRowId(42n)).toBe(42);
  });

  test("rejects row ids that Number would round", () => {
    expect(() => sqliteRowId(9_007_199_254_740_993n)).toThrow(
      "outside JavaScript's safe integer range",
    );
  });
});
