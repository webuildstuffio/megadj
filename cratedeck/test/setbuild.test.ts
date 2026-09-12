// setbuild.test.ts — M66 set-builder copilot: the pure engine.
// camelotOf / keyScore / bpmScore / buildSet / parseSetbuildQuery —
// propose-only, no I/O.
import { describe, expect, test } from "bun:test";
import {
  SET_PRESETS,
  buildSet,
  bpmScore,
  camelotOf,
  keyScore,
  parseSetbuildQuery,
  type SetCandidate,
} from "../src/setbuild";
import {
  SET_PRESET_DEFS,
  SET_PRESET_IDS,
  SET_POOL_DEFAULT,
  SET_POOL_MAX,
  clampSetPool,
} from "../shared/types";

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

  test("no track is excluded twice — the nothing-mixable exit clears the pool", () => {
    // regression: the nothing-mixable branch pushed every remaining
    // candidate into `excluded` but left them in `pool`, so the post-loop
    // budget pass re-excluded the SAME tracks under "set budget filled" —
    // live probe showed excluded_total 596 for a 300-track pool.
    const r = buildSet({
      candidates: [
        cand({ videoId: "a1", bpm: 128, key: "8A" }),
        cand({ videoId: "a2", bpm: 128, key: "8A" }),
        cand({ videoId: "clash", bpm: 71, key: "2B" }), // tempo 0 → unmixable
      ],
      preset: SET_PRESETS.peak,
      minutes: 60,
    });
    const seen = new Set<string>();
    for (const e of r.excluded) {
      expect(seen.has(e.videoId)).toBe(false);
      seen.add(e.videoId);
    }
    // and the count matches reality: chain + unique exclusions = pool
    expect(r.steps.length + r.excluded.length).toBe(3);
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

  test("ties break by videoId — the chain does not depend on pool row order", () => {
    // two byte-identical candidates except the id: whichever wins must be
    // decided by the id, not by which row the SQL happened to return first
    const mk = (order: [string, string][]) =>
      buildSet({
        candidates: order.map(([videoId, key]) =>
          cand({ videoId, key, bpm: 128 }),
        ),
        preset: SET_PRESETS.peak,
        minutes: 11, // fits exactly two 5-min tracks
      }).steps.map((s) => s.videoId);
    // pool order reversed between the two calls — result must not flip
    expect(
      mk([
        ["zz-tie", "8A"],
        ["aa-tie", "8A"],
      ]),
    ).toEqual(
      mk([
        ["aa-tie", "8A"],
        ["zz-tie", "8A"],
      ]),
    );
    // lexicographically-smaller id wins the tie ("aa-tie" opener, "zz-tie" follows)
    expect(
      mk([
        ["zz-tie", "8A"],
        ["aa-tie", "8A"],
      ]),
    ).toEqual(["aa-tie", "zz-tie"]);
  });

  test("opener pick is deterministic under equal arc distance too", () => {
    const pair = [
      cand({ videoId: "b-eq", arousal: 6 }),
      cand({ videoId: "a-eq", arousal: 6 }),
    ];
    const r = buildSet({
      candidates: pair,
      preset: SET_PRESETS.peak,
      minutes: 5,
    });
    expect(r.steps[0]!.videoId).toBe("a-eq"); // localeCompare tie-break
  });

  test("un-analyzed closest-fit track no longer voids the proposal", () => {
    // regression: the opener scan sorted by arousal-fit BEFORE the BPM
    // check, so one un-analyzed closest-fit candidate returned an empty
    // chain even when the rest of the pool was fully analyzed
    const r = buildSet({
      candidates: [
        cand({ videoId: "noBpm-fit", arousal: 6, bpm: null }),
        cand({ videoId: "hasBpm", arousal: 7, bpm: 128, key: "8A" }),
        cand({ videoId: "hasBpm2", arousal: 6.5, bpm: 128, key: "8A" }),
      ],
      preset: SET_PRESETS.peak,
      minutes: 11,
    });
    expect(r.steps.length).toBeGreaterThanOrEqual(2);
    expect(r.steps[0]!.videoId).not.toBe("noBpm-fit");
    expect(
      r.excluded.some(
        (e) => e.videoId === "noBpm-fit" && e.reason.includes("BPM"),
      ),
    ).toBe(true);
  });

  test("requested opener without BPM is excluded honestly, arc still builds", () => {
    const r = buildSet({
      candidates: [
        cand({ videoId: "req", bpm: null }),
        cand({ videoId: "a1", arousal: 6, bpm: 128, key: "8A" }),
        cand({ videoId: "a2", arousal: 6.5, bpm: 128, key: "8A" }),
      ],
      openerId: "req",
      preset: SET_PRESETS.peak,
      minutes: 11,
    });
    expect(r.steps.length).toBeGreaterThanOrEqual(2);
    expect(r.excluded).toContainEqual(
      expect.objectContaining({
        videoId: "req",
        reason: expect.stringContaining("requested opener"),
      }),
    );
  });

  test("requested opener missing from the pool is excluded loudly, never silently dropped", () => {
    // regression: an openerId that matches no candidate (typo, or the
    // track isn't playable) was silently ignored — the chain built without
    // it and the caller had no way to tell why their track never appeared
    const r = buildSet({
      candidates: [
        cand({ videoId: "a1", arousal: 6, bpm: 128, key: "8A" }),
        cand({ videoId: "a2", arousal: 6.5, bpm: 128, key: "8A" }),
      ],
      openerId: "ghost",
      preset: SET_PRESETS.peak,
      minutes: 11,
    });
    expect(r.steps.length).toBeGreaterThanOrEqual(1);
    expect(r.steps[0]!.videoId).not.toBe("ghost");
    expect(r.excluded).toContainEqual(
      expect.objectContaining({
        videoId: "ghost",
        reason: expect.stringContaining("requested opener"),
      }),
    );
  });

  test("placeholder BPM (0 / NaN) never anchors the chain", () => {
    // regression: the gates only checked bpm !== null, so an aborted
    // analysis run's 0-BPM row won the opener scan (arousal closest to the
    // arc start) and dead-ended the chain after one step
    const r = buildSet({
      candidates: [
        cand({ videoId: "zero", arousal: 6, bpm: 0, key: "8A" }),
        cand({ videoId: "nan", arousal: 6.2, bpm: NaN, key: "8A" }),
        cand({ videoId: "good1", arousal: 6.4, bpm: 128, key: "8A" }),
        cand({ videoId: "good2", arousal: 6.6, bpm: 128, key: "8A" }),
      ],
      preset: SET_PRESETS.peak,
      minutes: 11,
    });
    expect(r.steps.map((s) => s.videoId)).not.toContain("zero");
    expect(r.steps.map((s) => s.videoId)).not.toContain("nan");
    expect(r.steps.length).toBeGreaterThanOrEqual(2);
    expect(r.steps[0]!.videoId).toBe("good1");
    const exIds = r.excluded.map((e) => e.videoId);
    expect(exIds).toContain("zero");
    expect(exIds).toContain("nan");
  });
});

describe("parseSetbuildQuery", () => {
  test("defaults: absent preset/minutes → peak / 60", () => {
    expect(parseSetbuildQuery({})).toEqual({ preset: "peak", minutes: 60 });
    expect(parseSetbuildQuery({ preset: null, minutes: null })).toEqual({
      preset: "peak",
      minutes: 60,
    });
  });
  test("minutes clamp into 10–240, default when non-numeric", () => {
    expect(parseSetbuildQuery({ minutes: "999" })).toEqual({
      preset: "peak",
      minutes: 240,
    });
    expect(parseSetbuildQuery({ minutes: "1" })).toEqual({
      preset: "peak",
      minutes: 10,
    });
    expect(parseSetbuildQuery({ minutes: "banana" })).toEqual({
      preset: "peak",
      minutes: 60,
    });
    expect(parseSetbuildQuery({ minutes: "90" })).toEqual({
      preset: "peak",
      minutes: 90,
    });
  });
  test("valid preset accepted", () => {
    expect(parseSetbuildQuery({ preset: "afterhours" })).toEqual({
      preset: "afterhours",
      minutes: 60,
    });
  });
  test("unknown preset → error, never a silent peak fallback", () => {
    const r = parseSetbuildQuery({ preset: "wedding" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toContain("warmup, peak, afterhours");
  });
});

describe("SET_PRESETS registry census (derive, never hand-copy)", () => {
  test("engine registry matches the shared SET_PRESET_DEFS table exactly", () => {
    expect(Object.keys(SET_PRESETS).toSorted()).toEqual(
      SET_PRESET_IDS.slice().toSorted(),
    );
    for (const def of SET_PRESET_DEFS) {
      const derived = SET_PRESETS[def.id];
      expect(derived).toBe(def); // same object — a true derivation
    }
  });
});

describe("clampSetPool (the ?limit= guard shared by route + MCP tool)", () => {
  test("clamps into 1–1000, default when absent/non-finite", () => {
    expect(clampSetPool(500)).toBe(500);
    expect(clampSetPool(0)).toBe(1);
    expect(clampSetPool(-5)).toBe(1);
    expect(clampSetPool(99999)).toBe(1000);
    expect(clampSetPool(12.7)).toBe(13);
    expect(clampSetPool(null)).toBe(300);
    expect(clampSetPool(undefined)).toBe(300);
    expect(clampSetPool(Number.NaN)).toBe(300);
  });
  test("route + MCP surface agree on the documented caps", () => {
    // the MCP schema text is derived from the same constants the route
    // clamps with — they cannot drift apart again
    expect(SET_POOL_DEFAULT).toBe(300);
    expect(SET_POOL_MAX).toBe(1000);
  });
});
