/**
 * pca-version.test.ts — Tests for PCA basis versioning (B2.4).
 */
import { describe, expect, test } from "bun:test";
import {
  pcaVersionString,
  parsePcaVersion,
  pcaVersionMatches,
  reprojectionNeeded,
  type PcaBasis,
} from "./pca-version";

const CURRENT_BASIS: PcaBasis = {
  version: "pca-v1-discogs-256",
  sourceModel: "discogs",
  inputDim: 768,
  outputDim: 256,
  explainedVariance: 0.95,
  trainingSamples: 5000,
  computedAt: "2026-09-29",
};

describe("pcaVersionString", () => {
  test("builds correct version string", () => {
    expect(pcaVersionString(1, "discogs", 256)).toBe("pca-v1-discogs-256");
  });
});

describe("parsePcaVersion", () => {
  test("parses valid version string", () => {
    const parsed = parsePcaVersion("pca-v1-discogs-256");
    expect(parsed).toEqual({ version: 1, model: "discogs", dim: 256 });
  });

  test("returns null for invalid format", () => {
    expect(parsePcaVersion("invalid")).toBeNull();
    expect(parsePcaVersion("pca-v-model-")).toBeNull();
  });
});

describe("pcaVersionMatches", () => {
  test("matches current version", () => {
    expect(pcaVersionMatches("pca-v1-discogs-256", CURRENT_BASIS)).toBe(true);
  });

  test("rejects different version", () => {
    expect(pcaVersionMatches("pca-v0-discogs-128", CURRENT_BASIS)).toBe(false);
  });

  test("rejects null", () => {
    expect(pcaVersionMatches(null, CURRENT_BASIS)).toBe(false);
  });
});

describe("reprojectionNeeded", () => {
  test("all current → 0 stale", () => {
    const result = reprojectionNeeded(["pca-v1-discogs-256", "pca-v1-discogs-256"], CURRENT_BASIS);
    expect(result.stale).toBe(0);
    expect(result.current).toBe(2);
    expect(result.ratio).toBe(0);
  });

  test("mixed versions → correct ratio", () => {
    const result = reprojectionNeeded(
      ["pca-v1-discogs-256", "pca-v0-discogs-128", null],
      CURRENT_BASIS,
    );
    expect(result.stale).toBe(2);
    expect(result.current).toBe(1);
    expect(result.ratio).toBeCloseTo(0.667, 2);
  });

  test("empty → 0 ratio", () => {
    const result = reprojectionNeeded([], CURRENT_BASIS);
    expect(result.ratio).toBe(0);
  });
});
