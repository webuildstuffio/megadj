import { describe, expect, test } from "bun:test";
import { minutesFrom } from "./minutes";

describe("minutesFrom (shared megaset minutes converter)", () => {
  test("empty/whitespace input is the 60-minute default", () => {
    expect(minutesFrom("")).toBe(60);
    expect(minutesFrom("   ")).toBe(60);
  });

  test("finite values round to the nearest minute", () => {
    expect(minutesFrom("45")).toBe(45);
    expect(minutesFrom("45.4")).toBe(45);
    expect(minutesFrom("45.5")).toBe(46);
  });

  test("values clamp to the MEGASET_MINUTES window (10–240)", () => {
    expect(minutesFrom("0")).toBe(10);
    expect(minutesFrom("-20")).toBe(10);
    expect(minutesFrom("999")).toBe(240);
  });

  test("non-numeric input falls back to the default, never NaN", () => {
    expect(minutesFrom("abc")).toBe(60);
    expect(minutesFrom("NaN")).toBe(60);
  });
});
