/**
 * set-arc.test.ts — Tests for set arc descriptors (B7.4).
 */
import { describe, expect, test } from "bun:test";
import { computeSetArc } from "./set-arc";

describe("computeSetArc", () => {
  test("insufficient bars → null", () => {
    expect(computeSetArc([1, 2, 3])).toBeNull();
  });

  test("buildup: energy increases over time", () => {
    const lufs = Array.from({ length: 40 }, (_, i) => -20 + i * 0.5);
    const arc = computeSetArc(lufs);
    expect(arc).not.toBeNull();
    expect(arc!.shape).toBe("buildup");
    expect(arc!.dynamicRange).toBeGreaterThan(0);
  });

  test("drop: energy decreases over time", () => {
    const lufs = Array.from({ length: 40 }, (_, i) => 0 - i * 0.5);
    const arc = computeSetArc(lufs);
    expect(arc).not.toBeNull();
    expect(arc!.shape).toBe("drop");
  });

  test("plateau: flat energy", () => {
    const lufs = Array.from({ length: 40 }, () => -14);
    const arc = computeSetArc(lufs);
    expect(arc).not.toBeNull();
    expect(arc!.shape).toBe("plateau");
    expect(arc!.dynamicRange).toBeCloseTo(0, 1);
  });

  test("curve is normalized 0–1", () => {
    const lufs = Array.from({ length: 40 }, (_, i) => (i < 20 ? -20 : -10));
    const arc = computeSetArc(lufs);
    expect(arc).not.toBeNull();
    for (const v of arc!.curve) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
