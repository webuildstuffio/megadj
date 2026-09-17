// megaset-similarity.test.ts — #171: the embeddings similarity prior in
// transitionScore. Contract: pure bonus over the weighted core, capped at
// MEGASET_SIMILARITY_WEIGHT (0.1); missing embeddings = identical scores
// to the pre-prior engine (honest gap, never a penalty); the tempo/key/
// anchor gates keep precedence (a clash never gets rescued by timbre).
import { describe, expect, test } from "bun:test";
import { similarityScore, transitionScore } from "../src/megaset-scoring";
import { SET_PRESETS, type SetCandidate } from "../src/megaset";
import {
  MEGASET_SIMILARITY_WEIGHT,
  MEGASET_TRANSITION_WEIGHTS,
  MEGASET_ANCHOR_WEIGHT,
} from "../shared/types";

const W = MEGASET_TRANSITION_WEIGHTS;

const base = (over: Partial<SetCandidate>): SetCandidate => ({
  videoId: "x",
  title: "X",
  artist: null,
  durationS: 300,
  bpm: 128,
  key: "8A",
  valence: 5,
  arousal: 5,
  dance: 0.7,
  cues: [],
  embedding: null,
  ...over,
});

const preset = SET_PRESETS.warmup;

describe("similarityScore (#171)", () => {
  test("missing embedding on either side → 0 (no bonus, never a penalty)", () => {
    const a = base({ embedding: [1, 0, 0, 0] });
    const b = base({ embedding: null });
    expect(similarityScore(a, b)).toBe(0);
    expect(similarityScore(b, a)).toBe(0);
    expect(similarityScore(b, base({}))).toBe(0);
  });

  test("identical vectors → 1, orthogonal → 0.5, opposite → 0", () => {
    const pos = base({ embedding: [1, 0] });
    const posTwin = base({ videoId: "y", embedding: [2, 0] });
    const orth = base({ videoId: "y", embedding: [0, 1] });
    const neg = base({ videoId: "y", embedding: [-1, 0] });
    expect(similarityScore(pos, posTwin)).toBe(1);
    expect(similarityScore(pos, orth)).toBeCloseTo(0.5, 10);
    expect(similarityScore(pos, neg)).toBeCloseTo(0, 10);
  });

  test("dimension mismatch → 0 (different towers/spaces never mix)", () => {
    const a = base({ embedding: [1, 0, 0] });
    const b = base({ videoId: "y", embedding: [1, 0] });
    expect(similarityScore(a, b)).toBe(0);
  });
});

describe("transitionScore with the prior", () => {
  const anchor = 128;
  const prev = base({ bpm: 128, key: "8A", embedding: [1, 0, 0, 0] });
  const twin = base({
    videoId: "twin",
    bpm: 129,
    key: "8A",
    embedding: [1, 0, 0, 0],
  });
  const stranger = base({
    videoId: "stranger",
    bpm: 129,
    key: "8A",
    embedding: [0, 0, 0, 1],
  });

  test("compatible candidates: identical key/tempo, timbre breaks the tie", () => {
    const sTwin = transitionScore(prev, twin, preset, 0.5, anchor, 5);
    const sStranger = transitionScore(prev, stranger, preset, 0.5, anchor, 5);
    expect(sTwin).toBeGreaterThan(sStranger);
    // the gap is exactly the capped prior
    expect(sTwin - sStranger).toBeCloseTo(
      MEGASET_SIMILARITY_WEIGHT * (1 - 0.5),
      10,
    );
  });

  test("no embeddings on both sides → the pre-prior score exactly", () => {
    const prevNoEmb = base({ embedding: null });
    const cNoEmb = base({ videoId: "y", embedding: null });
    const withPrior = transitionScore(
      prevNoEmb,
      cNoEmb,
      preset,
      0.5,
      anchor,
      5,
    );
    const withEmb = transitionScore(
      base({ embedding: [1, 0, 0, 0] }),
      base({ videoId: "y", embedding: [1, 0, 0, 0] }),
      preset,
      0.5,
      anchor,
      5,
    );
    // identical pair WITH vectors scores exactly one capped prior higher:
    // the prior contributes exactly 0 when embeddings are null
    expect(withEmb - withPrior).toBeCloseTo(MEGASET_SIMILARITY_WEIGHT, 10);
  });

  test("precedence: the prior cannot rescue a key clash or tempo wall", () => {
    const clasher = base({
      videoId: "clash",
      bpm: 129,
      key: "1A", // key clash vs 8A
      embedding: [1, 0, 0, 0],
    });
    const unmixable = base({
      videoId: "slow",
      bpm: 100, // outside ±6% of the 128 anchor world
      key: "8A",
      embedding: [1, 0, 0, 0],
    });
    expect(transitionScore(prev, clasher, preset, 0.5, anchor, 5)).toBeLessThan(
      0,
    );
    expect(
      transitionScore(prev, unmixable, preset, 0.5, anchor, 5),
    ).toBeLessThan(0);
  });

  test("weight pins: the prior rides BESIDE the frozen weights (E6)", () => {
    expect(MEGASET_SIMILARITY_WEIGHT).toBe(0.1);
    // the three mixability weights stay untouched
    expect(W).toEqual({ tempo: 0.45, key: 0.3, arcFit: 0.25 });
    expect(MEGASET_ANCHOR_WEIGHT).toBe(0.15);
  });
});
