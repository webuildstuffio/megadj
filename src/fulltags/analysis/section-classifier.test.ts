/**
 * section-classifier.test.ts — Tests for PSSI section classifier (B8.2).
 */
import { describe, expect, test } from "bun:test";
import {
  classifySections,
  pssiTypeName,
  sectionFeatures,
  PSSI_TYPES,
} from "./section-classifier";

describe("pssiTypeName", () => {
  test("maps known codes", () => {
    expect(pssiTypeName(PSSI_TYPES.INTRO)).toBe("intro");
    expect(pssiTypeName(PSSI_TYPES.CHORUS)).toBe("drop");
    expect(pssiTypeName(PSSI_TYPES.OUTRO)).toBe("outro");
  });

  test("unknown code → 'unknown-N'", () => {
    expect(pssiTypeName(99)).toBe("unknown-99");
  });
});

describe("classifySections", () => {
  test("empty input → empty result", () => {
    const result = classifySections([]);
    expect(result.sections).toHaveLength(0);
    expect(result.totalBars).toBe(0);
  });

  test("uniform bars → one section", () => {
    const codes = Array.from({ length: 16 }, () => PSSI_TYPES.CHORUS);
    const result = classifySections(codes);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.name).toBe("drop");
    expect(result.sections[0]!.lengthBars).toBe(16);
  });

  test("intro-drop-outro → canonical arc", () => {
    const codes = [
      ...Array.from({ length: 8 }, () => PSSI_TYPES.INTRO),
      ...Array.from({ length: 16 }, () => PSSI_TYPES.CHORUS),
      ...Array.from({ length: 8 }, () => PSSI_TYPES.OUTRO),
    ];
    const result = classifySections(codes);
    expect(result.hasCanonicalArc).toBe(true);
    expect(result.sections).toHaveLength(3);
    expect(result.distribution.get("intro")).toBe(1);
    expect(result.distribution.get("drop")).toBe(1);
    expect(result.distribution.get("outro")).toBe(1);
  });

  test("no outro → not canonical", () => {
    const codes = [
      ...Array.from({ length: 8 }, () => PSSI_TYPES.INTRO),
      ...Array.from({ length: 16 }, () => PSSI_TYPES.CHORUS),
    ];
    const result = classifySections(codes);
    expect(result.hasCanonicalArc).toBe(false);
  });

  test("alternating sections counted correctly", () => {
    const codes = [
      ...Array.from({ length: 4 }, () => PSSI_TYPES.VERSE),
      ...Array.from({ length: 4 }, () => PSSI_TYPES.CHORUS),
      ...Array.from({ length: 4 }, () => PSSI_TYPES.VERSE),
      ...Array.from({ length: 4 }, () => PSSI_TYPES.CHORUS),
    ];
    const result = classifySections(codes);
    expect(result.sections).toHaveLength(4);
    expect(result.distribution.get("verse")).toBe(2);
    expect(result.distribution.get("drop")).toBe(2);
  });
});

describe("sectionFeatures", () => {
  test("computes mean LUFS per section", () => {
    const sections = classifySections([
      ...Array.from({ length: 4 }, () => PSSI_TYPES.INTRO),
      ...Array.from({ length: 4 }, () => PSSI_TYPES.CHORUS),
    ]).sections;
    const lufs = [
      ...Array.from({ length: 4 }, () => -20),
      ...Array.from({ length: 4 }, () => -8),
    ];
    const features = sectionFeatures(sections, lufs);
    expect(features).toHaveLength(2);
    expect(features[0]!.meanLufs).toBe(-20);
    expect(features[1]!.meanLufs).toBe(-8);
  });
});
