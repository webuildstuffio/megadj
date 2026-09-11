import { describe, expect, test } from "bun:test";
import {
  classifyAcousticSub,
  inBucket,
  ACOUSTIC_SUB_LABELS,
  BUCKET_MEMBERSHIP,
} from "./subcategory";

describe("acoustic subcategory classifier", () => {
  test("<0.5% size delta = metadata-diff", () => {
    // 10KB of 4MB is 0.24%
    const r = classifyAcousticSub(4_000_000, 4_010_000);
    expect(r.subcategory).toBe("metadata-diff");
    expect(r.sizeDeltaRatio).toBeLessThan(0.005);
  });

  test("0.5–3% size delta = re-encode", () => {
    const r = classifyAcousticSub(4_000_000, 4_100_000); // 2.5%
    expect(r.subcategory).toBe("re-encode");
  });

  test(">3% size delta = quality-diff", () => {
    const r = classifyAcousticSub(4_000_000, 5_000_000); // 20%
    expect(r.subcategory).toBe("quality-diff");
  });

  test("same size, different bytes = oddball (ear-check)", () => {
    const r = classifyAcousticSub(4_000_000, 4_000_000);
    expect(r.subcategory).toBe("oddball");
    expect(r.sizeDeltaRatio).toBe(0);
  });

  test("zero bytes guard: both zero = oddball, no NaN", () => {
    const r = classifyAcousticSub(0, 0);
    expect(r.subcategory).toBe("oddball");
    expect(Number.isFinite(r.sizeDeltaRatio)).toBe(true);
  });

  test("boundary: exactly 0.5% is re-encode (not metadata)", () => {
    // 1000/200000 = 0.5% exactly
    const r = classifyAcousticSub(199_000, 200_000);
    expect(r.sizeDeltaRatio).toBeCloseTo(0.005, 10);
    expect(r.subcategory).toBe("re-encode");
  });

  test("boundary: exactly 3% is quality-diff (not re-encode)", () => {
    // 6000/200000 = 3% exactly
    const r = classifyAcousticSub(194_000, 200_000);
    expect(r.sizeDeltaRatio).toBeCloseTo(0.03, 10);
    expect(r.subcategory).toBe("quality-diff");
  });

  test("every subcategory has a user-facing label", () => {
    for (const sub of [
      "metadata-diff",
      "re-encode",
      "quality-diff",
      "oddball",
    ] as const) {
      expect(ACOUSTIC_SUB_LABELS[sub].length).toBeGreaterThan(0);
    }
  });

  test("bucket membership: safe-batch = metadata+re-encode, ear-check = quality+oddball", () => {
    expect(BUCKET_MEMBERSHIP["safe-batch"]).toEqual([
      "metadata-diff",
      "re-encode",
    ]);
    expect(BUCKET_MEMBERSHIP["ear-check"]).toEqual(["quality-diff", "oddball"]);
    expect(inBucket("metadata-diff", "safe-batch")).toBe(true);
    expect(inBucket("re-encode", "safe-batch")).toBe(true);
    expect(inBucket("quality-diff", "safe-batch")).toBe(false);
    expect(inBucket("oddball", "ear-check")).toBe(true);
    expect(inBucket("metadata-diff", "ear-check")).toBe(false);
  });
});
