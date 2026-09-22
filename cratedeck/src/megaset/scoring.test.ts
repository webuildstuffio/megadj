// megaset/scoring.test.ts — #171: the embeddings similarity prior in
// transitionScore. Contract: pure bonus over the weighted core, capped at
// MEGASET_SIMILARITY_WEIGHT (0.1); missing embeddings = identical scores
// to the pre-prior engine (honest gap, never a penalty); the tempo/key/
// anchor gates keep precedence (a clash never gets rescued by timbre).
// Sep 21 improvement pass (#107): B6 diversity guard, B8 half/double-time
// pairing, S13 landmark pins — engine-level behavior tests moved here from
// engine.test.ts to stay under the file-length hook (900-line limit).
import { describe, expect, test } from "bun:test";
import {
  buildMegaset,
  bpmScore,
  SET_PRESETS,
  type SetCandidate,
} from "./engine";
import { similarityScore, transitionScore } from "./scoring";
import {
  MEGASET_SIMILARITY_WEIGHT,
  MEGASET_TRANSITION_WEIGHTS,
  MEGASET_ANCHOR_WEIGHT,
  MEGASET_PRESET_DEFS,
  isMegasetHalfTimePair,
} from "../../shared/types";

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

const cand = base;

const preset = MEGASET_PRESET_DEFS.find((p) => p.id === "warmup");
if (!preset) throw new Error("warmup preset missing");

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

// ---- Sep 21 improvement pass (#107): B6 diversity / B8 half-time /
// S13 landmark pins — engine-level behavior through buildMegaset.

describe("buildMegaset improvement pass (#107)", () => {
  test("B6: same-artist back-to-back loses to a differently-named peer", () => {
    // the penalized "same" must lose slot 2 to the identically-scoring
    // "fresh" wherever the (videoId-tie-broken) opener lands
    const chainPool = [
      cand({ videoId: "op", artist: "Alpha", arousal: 5 }),
      cand({ videoId: "same", artist: "Alpha", arousal: 5.2 }),
      cand({ videoId: "fresh", artist: "Beta", arousal: 5.2 }),
    ];
    const r = buildMegaset({
      candidates: chainPool,
      preset: SET_PRESETS.peak,
      minutes: 15,
      searchOverride: "greedy",
    });
    // a fresh name precedes any same-artist hop in the chain
    expect(r.steps.map((s) => s.videoId)).toContain("fresh");
    const freshIdx = r.steps.findIndex((s) => s.videoId === "fresh");
    const sameIdx = r.steps.findIndex((s) => s.videoId === "same");
    expect(freshIdx).toBeLessThan(sameIdx);
    // and the wire reports the diversity census — the chain ends on the
    // penalized same-artist hop ONLY because nothing else remained
    expect(r.same_artist_pairs).toBe(r.steps.length - 2);
  });

  test("B6: an artist CAN close the set when nothing else fits — no hard wall", () => {
    // only same-artist tracks remain: the penalty must not exclude them
    // (dead end) — the guard is a ranking penalty, never a gate
    const chainPool = [
      cand({ videoId: "op", artist: "Alpha", arousal: 5 }),
      cand({ videoId: "a2", artist: "Alpha", arousal: 5.4 }),
      cand({ videoId: "a3", artist: "Alpha", arousal: 5.8 }),
    ];
    const r = buildMegaset({
      candidates: chainPool,
      preset: SET_PRESETS.peak,
      minutes: 20,
      searchOverride: "greedy",
    });
    expect(r.steps.length).toBe(3);
    // honesty: the census counts what happened
    expect(r.same_artist_pairs).toBe(2);
  });

  test("B6: unknown artists are never penalized — absence of a name is not a name", () => {
    const chainPool = [
      cand({ videoId: "b-op", artist: null, arousal: 5 }),
      cand({ videoId: "a-n1", artist: null, arousal: 5.2 }),
    ];
    const r = buildMegaset({
      candidates: chainPool,
      preset: SET_PRESETS.peak,
      minutes: 15,
      searchOverride: "greedy",
    });
    // both land in the chain — the guard never fired on null artists
    expect(r.steps.map((s) => s.videoId).toSorted()).toEqual(["a-n1", "b-op"]);
  });

  test("B8: a half-time pairing (87 ↔ 174) now scores instead of dying at 0", () => {
    // the anchor budget's branch lane admits the 174 track; before B8 its
    // tempo component was 0 (outside ±6%) so it never won a slot
    const anchor = cand({ videoId: "anchor", bpm: 87, key: "8A", arousal: 5 });
    const halftime = cand({
      videoId: "dnb",
      bpm: 174,
      key: "8A",
      arousal: 6,
    });
    // directly out of window → the ONLY lane is half-time
    expect(bpmScore(87, 174)).toBe(0);
    // the pairing is recognized and scores the flat half-time value
    expect(isMegasetHalfTimePair(87, 174)).toBe(true);
    expect(isMegasetHalfTimePair(174, 87)).toBe(true);
    // and transitionScore composes it (tempo weight × 0.75 × 0.9 + key +
    // fit floor) — strictly positive where it used to be −1
    const s = transitionScore(
      anchor,
      halftime,
      SET_PRESETS.peak,
      0.5,
      87,
      anchor.arousal,
    );
    expect(s).toBeGreaterThan(0);
    // a NON-multiple far-BPM track stays at −1
    expect(
      transitionScore(
        anchor,
        cand({ videoId: "far", bpm: 120, key: "8A" }),
        SET_PRESETS.peak,
        0.5,
        87,
        anchor.arousal,
      ),
    ).toBe(-1);
  });

  test("S13: a landmark pin is slotted into the chain even when the search never picked it", () => {
    // the decoy wins the first greedy hop; the pinned track is NOT the
    // search's pick — the repair pass must insert it anyway

    const chainPool = [
      cand({ videoId: "op", arousal: 5, bpm: 126, key: "8A" }),
      cand({ videoId: "decoy", arousal: 5.3, bpm: 126, key: "9A" }),
      cand({ videoId: "chain-1", arousal: 5.6, bpm: 126, key: "7A" }),
      cand({ videoId: "chain-2", arousal: 5.9, bpm: 126, key: "7A" }),
      cand({ videoId: "pin", arousal: 6.2, bpm: 126, key: "7A" }),
      cand({ videoId: "chain-3", arousal: 6.5, bpm: 126, key: "7A" }),
    ];
    const r = buildMegaset({
      candidates: chainPool,
      preset: SET_PRESETS.peak,
      minutes: 40,
      searchOverride: "greedy",
      landmarkIds: ["pin"],
    });
    expect(r.steps.map((s) => s.videoId)).toContain("pin");
    const pin = r.steps.find((s) => s.videoId === "pin")!;
    // the pin is VISIBLE as a landmark on the wire
    expect(pin.landmark).toBe(true);
    expect(r.landmarks_missing).toEqual([]);
  });

  test("S13: an unplaceable pin is excluded honestly and listed in landmarks_missing", () => {
    const chainPool = [
      cand({ videoId: "op", arousal: 5, bpm: 126, key: "8A" }),
      cand({ videoId: "good", arousal: 5.4, bpm: 126, key: "8A" }),
    ];
    const r = buildMegaset({
      candidates: chainPool,
      preset: SET_PRESETS.peak,
      minutes: 15,
      searchOverride: "greedy",
      landmarkIds: ["ghost", "clasher"],
    });
    expect(r.landmarks_missing).toEqual(["ghost", "clasher"]);
    // each missing pin explains itself in excluded[]
    for (const id of r.landmarks_missing)
      expect(
        r.excluded.some(
          (e) => e.videoId === id && e.reason.startsWith("landmark"),
        ),
      ).toBe(true);
    // and the chain still built around the failure
    expect(r.steps.length).toBeGreaterThanOrEqual(2);
  });

  test("S13: every candidate still lands in exactly one bucket with pins active", () => {
    const chainPool = [
      cand({ videoId: "op", arousal: 5, bpm: 126, key: "8A" }),
      cand({ videoId: "mid", arousal: 5.4, bpm: 126, key: "8A" }),
      cand({ videoId: "pin", arousal: 6, bpm: 126, key: "8A" }),
      cand({ videoId: "clash", bpm: 71, key: "2B", arousal: 6 }),
    ];
    const r = buildMegaset({
      candidates: chainPool,
      preset: SET_PRESETS.peak,
      minutes: 12,
      searchOverride: "greedy",
      landmarkIds: ["pin"],
    });
    const ids = r.steps.map((s) => s.videoId);
    const seen = new Set<string>();
    for (const e of r.excluded) {
      expect(seen.has(e.videoId)).toBe(false);
      expect(ids).not.toContain(e.videoId);
      seen.add(e.videoId);
    }
    expect(ids.length + seen.size).toBe(chainPool.length);
  });
});
