/**
 * edmformer.test.ts — Tests for EDMFormer baseline evaluation (B8.3).
 */
import { describe, expect, test } from "bun:test";
import { compareSections } from "./edmformer";

describe("compareSections", () => {
  test("empty inputs → zeros", () => {
    const result = compareSections([], []);
    expect(result.boundaryF1).toBe(0);
    expect(result.overSegRate).toBe(0);
  });

  test("predicted but no truth → over-segmentation", () => {
    const result = compareSections(
      [{ startBar: 0, endBar: 16, label: "intro" }],
      [],
    );
    expect(result.overSegRate).toBe(1);
  });

  test("truth but no predicted → under-segmentation", () => {
    const result = compareSections(
      [],
      [{ startBar: 0, endBar: 16, label: "intro" }],
    );
    expect(result.underSegRate).toBe(1);
  });

  test("perfect match → F1=1", () => {
    const sections = [
      { startBar: 0, endBar: 16, label: "intro" },
      { startBar: 16, endBar: 48, label: "drop" },
      { startBar: 48, endBar: 64, label: "outro" },
    ];
    const result = compareSections(sections, sections);
    expect(result.boundaryF1).toBe(1);
    expect(result.labelAccuracy).toBe(1);
  });

  test("off-by-one boundaries still match within tolerance", () => {
    const predicted = [
      { startBar: 1, endBar: 17, label: "intro" },
      { startBar: 17, endBar: 49, label: "drop" },
    ];
    const truth = [
      { startBar: 0, endBar: 16, label: "intro" },
      { startBar: 16, endBar: 48, label: "drop" },
    ];
    const result = compareSections(predicted, truth, 1);
    expect(result.boundaryF1).toBe(1);
  });

  test("label aliases normalize correctly", () => {
    const predicted = [{ startBar: 0, endBar: 16, label: "chorus" }];
    const truth = [{ startBar: 0, endBar: 16, label: "drop" }];
    const result = compareSections(predicted, truth);
    expect(result.labelAccuracy).toBe(1);
  });
});
