/**
 * preview-verify.test.ts — Tests for preview-audio verification (B3.4).
 */
import { describe, expect, test } from "bun:test";
import {
  scoreVerification,
  crossCorrelateFingerprints,
  calibrateThreshold,
  PREVIEW_THRESHOLDS,
} from "./preview-verify";

describe("scoreVerification", () => {
  test("high correlation → exact + trusted", () => {
    const result = scoreVerification(0.92);
    expect(result.verdict).toBe("exact");
    expect(result.trusted).toBe(true);
  });

  test("medium correlation → similar + trusted", () => {
    const result = scoreVerification(0.65);
    expect(result.verdict).toBe("similar");
    expect(result.trusted).toBe(true);
  });

  test("low correlation → different + untrusted", () => {
    const result = scoreVerification(0.2);
    expect(result.verdict).toBe("different");
    expect(result.trusted).toBe(false);
  });

  test("threshold boundary: exact", () => {
    const result = scoreVerification(PREVIEW_THRESHOLDS.EXACT);
    expect(result.verdict).toBe("exact");
  });

  test("threshold boundary: similar", () => {
    const result = scoreVerification(PREVIEW_THRESHOLDS.SIMILAR);
    expect(result.verdict).toBe("similar");
  });
});

describe("crossCorrelateFingerprints", () => {
  test("identical fingerprints → 1.0", () => {
    const fp = [0x12345678, 0xabcdef01, 0xdeadbeef];
    expect(crossCorrelateFingerprints(fp, fp)).toBe(1);
  });

  test("opposite fingerprints → 0.0", () => {
    const fpA = [0xffffffff, 0xffffffff];
    const fpB = [0x00000000, 0x00000000];
    expect(crossCorrelateFingerprints(fpA, fpB)).toBe(0);
  });

  test("empty fingerprint → 0.0", () => {
    expect(crossCorrelateFingerprints([], [1, 2, 3])).toBe(0);
  });

  test("partial match → between 0 and 1", () => {
    const fpA = [0xffffffff, 0x00000000];
    const fpB = [0xffffffff, 0xffffffff];
    const score = crossCorrelateFingerprints(fpA, fpB);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("calibrateThreshold", () => {
  test("empty data → default threshold", () => {
    const result = calibrateThreshold([]);
    expect(result.threshold).toBe(PREVIEW_THRESHOLDS.EXACT);
  });

  test("separable data → good F1", () => {
    const data = [
      { correlation: 0.95, isMatch: true },
      { correlation: 0.9, isMatch: true },
      { correlation: 0.88, isMatch: true },
      { correlation: 0.2, isMatch: false },
      { correlation: 0.15, isMatch: false },
      { correlation: 0.1, isMatch: false },
    ];
    const result = calibrateThreshold(data);
    expect(result.f1).toBeGreaterThan(0.8);
    expect(result.threshold).toBeGreaterThan(0.15);
    expect(result.threshold).toBeLessThan(0.9);
  });
});
