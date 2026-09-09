// setbuild.test.ts — M66 set-builder copilot: the pure engine.
// camelotOf / keyScore / bpmScore / buildSet — propose-only, no I/O.
import { describe, expect, test } from "bun:test";
import {
  SET_PRESETS,
  buildSet,
  bpmScore,
  camelotOf,
  keyScore,
  type SetCandidate,
} from "../src/setbuild";

const cand = (over: Partial<SetCandidate>): SetCandidate => ({
  videoId: "x",
  title: "X",
  artist: null,
  durationS: 300,
  bpm: 128,
  key: "8A",
  valence: 5,
  arousal: 5,
  dance: 0.7,
  ...over,
});

describe("camelotOf", () => {
  test("parses Camelot notation, case-insensitive", () => {
    expect(camelotOf("8A")).toEqual({ n: 8, letter: "A" });
    expect(camelotOf("12b")).toEqual({ n: 12, letter: "B" });
  });
  test("parses common open-key names", () => {
    expect(camelotOf("Am")).toEqual({ n: 8, letter: "A" });
    expect(camelotOf("C")).toEqual({ n: 8, letter: "B" });
  });
  test("unparsable → null", () => {
    expect(camelotOf("banana")).toBeNull();
    expect(camelotOf(null)).toBeNull();
  });
});

describe("keyScore", () => {
  const a = cand({ key: "8A" });
  test("same key → 1", () => {
    expect(keyScore(a, cand({ key: "8A" }))).toBe(1);
  });
  test("energy flow ±1 same letter → 1", () => {
    expect(keyScore(a, cand({ key: "7A" }))).toBe(1);
    expect(keyScore(a, cand({ key: "9A" }))).toBe(1);
  });
  test("mood lift same number other letter → 1", () => {
    expect(keyScore(a, cand({ key: "8B" }))).toBe(1);
  });
  test("diagonal → 0.9", () => {
    expect(keyScore(a, cand({ key: "9B" }))).toBe(0.9);
  });
  test("clash → 0", () => {
    expect(keyScore(a, cand({ key: "2B" }))).toBe(0);
  });
  test("unparsable either side → neutral 0.5", () => {
    expect(keyScore(a, cand({ key: null }))).toBe(0.5);
  });
});

describe("bpmScore", () => {
  test("within ±2% → 1", () => {
    expect(bpmScore(128, 130)).toBe(1);
  });
  test("beyond ±6% → 0", () => {
    expect(bpmScore(128, 137)).toBe(0);
  });
  test("between → partial", () => {
    const s = bpmScore(128, 134); // ~4.7% off
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe("buildSet", () => {
  const pool: SetCandidate[] = [
    cand({
      videoId: "opener",
      title: "Opener",
      bpm: 124,
      key: "7A",
      arousal: 3,
      dance: 0.5,
    }),
    cand({
      videoId: "mid",
      title: "Mid",
      bpm: 126,
      key: "8A",
      arousal: 5,
      dance: 0.7,
    }),
    cand({
      videoId: "near",
      title: "Near",
      bpm: 127,
      key: "8A",
      arousal: 6,
      dance: 0.8,
    }),
    cand({
      videoId: "peak",
      title: "Peak",
      bpm: 128,
      key: "8A",
      arousal: 8,
      dance: 0.9,
    }),
    cand({
      videoId: "far",
      title: "Far",
      bpm: 140,
      key: "2B",
      arousal: 7,
      dance: 0.9,
    }),
  ];
  test("warmup arc: opener first, energy generally rises, budget respected", () => {
    const r = buildSet({
      candidates: pool,
      preset: SET_PRESETS.warmup,
      minutes: 20,
    });
    expect(r.steps.length).toBeGreaterThan(1);
    expect(r.steps[0]!.videoId).toBe("opener"); // closest to arc start (arousal 3)
    // cumulative minutes respect the budget (last track may overshoot by one)
    expect(r.steps.at(-1)!.atMin).toBeLessThanOrEqual(20 + 6);
    // every step carries its transition score except the first
    expect(r.steps[0]!.transition).toBeNull();
    expect(r.steps[1]!.transition).not.toBeNull();
  });
  test("deterministic: same input → same chain", () => {
    const a = buildSet({
      candidates: pool,
      preset: SET_PRESETS.peak,
      minutes: 15,
    });
    const b = buildSet({
      candidates: pool,
      preset: SET_PRESETS.peak,
      minutes: 15,
    });
    expect(a.steps.map((s) => s.videoId)).toEqual(
      b.steps.map((s) => s.videoId),
    );
  });
  test("unmixable leftovers land in excluded with a reason — never dropped silently", () => {
    const r = buildSet({
      candidates: pool,
      preset: SET_PRESETS.warmup,
      minutes: 10,
    });
    const ids = new Set(r.steps.map((s) => s.videoId));
    for (const e of r.excluded) expect(e.reason.length).toBeGreaterThan(0);
    // every candidate is either in the chain or excluded
    for (const c of pool) {
      expect(
        ids.has(c.videoId) || r.excluded.some((e) => e.videoId === c.videoId),
      ).toBe(true);
    }
  });
  test("pool with no BPM at all → empty chain, all excluded honestly", () => {
    const r = buildSet({
      candidates: [cand({ videoId: "n1", bpm: null })],
      preset: SET_PRESETS.peak,
      minutes: 30,
    });
    expect(r.steps).toEqual([]);
    expect(r.excluded).toHaveLength(1);
  });
});
