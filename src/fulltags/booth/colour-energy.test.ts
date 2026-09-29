/**
 * colour-energy.test.ts — Tests for RB colour/energy mapping (B10.2).
 */
import { describe, expect, test } from "bun:test";
import { energyToColour, colourName, buildMyTag } from "./colour-energy";

describe("energyToColour", () => {
  test("band 1 → blue (7)", () => expect(energyToColour(1)).toBe(7));
  test("band 2 → blue (7)", () => expect(energyToColour(2)).toBe(7));
  test("band 3 → aqua (6)", () => expect(energyToColour(3)).toBe(6));
  test("band 4 → aqua (6)", () => expect(energyToColour(4)).toBe(6));
  test("band 5 → green (5)", () => expect(energyToColour(5)).toBe(5));
  test("band 6 → green (5)", () => expect(energyToColour(6)).toBe(5));
  test("band 7 → orange (3)", () => expect(energyToColour(7)).toBe(3));
  test("band 8 → orange (3)", () => expect(energyToColour(8)).toBe(3));
  test("band 9 → red (2)", () => expect(energyToColour(9)).toBe(2));
  test("band 10 → red (2)", () => expect(energyToColour(10)).toBe(2));
});

describe("colourName", () => {
  test("known IDs map to names", () => {
    expect(colourName(0)).toBe("none");
    expect(colourName(2)).toBe("red");
    expect(colourName(7)).toBe("blue");
  });

  test("unknown ID → 'unknown'", () => {
    expect(colourName(99)).toBe("unknown");
  });
});

describe("buildMyTag", () => {
  test("family + L3 subgenre", () => {
    expect(buildMyTag("house", "deep house")).toBe("house / deep house");
  });

  test("family only (no L3)", () => {
    expect(buildMyTag("techno", null)).toBe("techno");
  });

  test("L3 same as family → just family", () => {
    expect(buildMyTag("house", "house")).toBe("house");
  });

  test("null family → empty string", () => {
    expect(buildMyTag(null, null)).toBe("");
  });
});
