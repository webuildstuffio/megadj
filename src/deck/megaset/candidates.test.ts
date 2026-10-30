// candidates.test.ts — S14 (#288): N-candidates compare mode.
import { describe, expect, test } from "bun:test";
import { buildMegasetCandidates, MAX_CANDIDATES, MIN_CANDIDATES } from "./candidates";
import { MEGASET_PRESET_DEFS } from "../shared/types";
import { fakeTrackList } from "../../test-support/megaset-fixtures";

const keys = ["8A", "8B", "7A", "9A", "3A", "5B", "10A", "12B"];
/** Build a pool large enough for meaningful variants (the varied ladder). */
const pool = (size: number) =>
  fakeTrackList(size, (i) => ({
    videoId: `v${i}`,
    title: `Track ${i}`,
    artist: `Artist ${i % 5}`,
    bpm: 124 + (i % 8),
    key: keys[i % keys.length]!,
    arousal: 3 + (i % 5),
    durationS: 240 + (i % 3) * 30,
  }));

const preset = MEGASET_PRESET_DEFS[0]!;

describe("buildMegasetCandidates", () => {
  test("returns N variants sorted by quality (best first)", () => {
    const variants = buildMegasetCandidates({ candidates: pool(60), preset, minutes: 30 }, 3);
    expect(variants).toHaveLength(3);
    for (let i = 1; i < variants.length; i++) {
      expect(variants[i]!.quality.total).toBeLessThanOrEqual(variants[i - 1]!.quality.total);
    }
  });

  test("each variant has a unique seed and label", () => {
    const variants = buildMegasetCandidates({ candidates: pool(60), preset, minutes: 30 }, 4);
    const seeds = variants.map((v) => v.seed);
    const labels = variants.map((v) => v.label);
    expect(new Set(seeds).size).toBe(4);
    expect(new Set(labels).size).toBe(4);
    expect(labels).toContain("A");
    expect(labels).toContain("B");
    expect(labels).toContain("C");
    expect(labels).toContain("D");
  });

  test("seed 0 reproduces the default build", () => {
    const candidates = pool(60);
    const [defaultBuild] = buildMegasetCandidates({ candidates, preset, minutes: 30 }, 1);
    expect(defaultBuild!.seed).toBe(0);
    expect(defaultBuild!.result.seed).toBe(0);
  });

  test("same seed reproduces the same chain (determinism)", () => {
    const candidates = pool(60);
    const run1 = buildMegasetCandidates({ candidates, preset, minutes: 30 }, 3);
    const run2 = buildMegasetCandidates({ candidates, preset, minutes: 30 }, 3);
    for (let i = 0; i < 3; i++) {
      const steps1 = run1[i]!.result.steps.map((s) => s.videoId);
      const steps2 = run2[i]!.result.steps.map((s) => s.videoId);
      expect(steps1).toEqual(steps2);
    }
  });

  test("different seeds produce different chains", () => {
    const candidates = pool(60);
    const variants = buildMegasetCandidates({ candidates, preset, minutes: 30 }, 4);
    const chains = variants.map((v) => v.result.steps.map((s) => s.videoId).join(","));
    const unique = new Set(chains);
    expect(unique.size).toBeGreaterThan(1);
  });

  test("clamps to MIN_CANDIDATES / MAX_CANDIDATES", () => {
    const candidates = pool(30);
    expect(buildMegasetCandidates({ candidates, preset, minutes: 30 }, 0)).toHaveLength(
      MIN_CANDIDATES,
    );
    expect(buildMegasetCandidates({ candidates, preset, minutes: 30 }, 100)).toHaveLength(
      MAX_CANDIDATES,
    );
  });

  test("pinned opener skips seed rotation", () => {
    const candidates = pool(60);
    const variants = buildMegasetCandidates({ candidates, preset, minutes: 30, openerId: "v0" }, 3);
    for (const v of variants) {
      expect(v.result.steps[0]?.videoId).toBe("v0");
    }
  });

  test("variant results carry the seed field", () => {
    const variants = buildMegasetCandidates({ candidates: pool(40), preset, minutes: 30 }, 3);
    for (const v of variants) {
      expect(v.result.seed).toBe(v.seed);
    }
  });

  test("odd seeds alternate strategy when no searchOverride", () => {
    const candidates = pool(60);
    const variants = buildMegasetCandidates({ candidates, preset, minutes: 30 }, 4);
    const seed0 = variants.find((v) => v.seed === 0)!;
    const seed1 = variants.find((v) => v.seed === 1)!;
    expect(seed0.result.search).not.toBe(seed1.result.search);
  });
});
