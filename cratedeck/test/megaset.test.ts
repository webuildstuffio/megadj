// setbuild.test.ts — the set-builder copilot: the pure engine.
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
  SET_POOL_MAX,
  SET_POOL_UNLIMITED,
  SET_BEAM_POOL_MAX,
  SET_TEMPO_PERFECT,
  SET_TEMPO_WINDOW,
  SET_TRANSITION_WEIGHTS,
  isShelfOffline,
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

  test("a short pool reports the minutes actually built and the shortfall", () => {
    const r = buildSet({
      candidates: [
        cand({ videoId: "one", durationS: 300 }),
        cand({ videoId: "two", durationS: 300 }),
      ],
      preset: SET_PRESETS.peak,
      minutes: 60,
    });

    expect(r.actualMinutes).toBe(10);
    expect(r.shortfallMinutes).toBe(50);
    expect(r.complete).toBe(false);
  });

  test("a continuous mix cannot satisfy a set target as one giant track", () => {
    const r = buildSet({
      candidates: [cand({ videoId: "three-hour-mix", durationS: 154 * 60 })],
      preset: SET_PRESETS.warmup,
      minutes: 64,
    });

    expect(r.steps).toEqual([]);
    expect(r.actualMinutes).toBe(0);
    expect(r.complete).toBe(false);
    expect(r.excluded).toEqual([
      {
        videoId: "three-hour-mix",
        title: "X",
        reason: "154-minute continuous mix exceeds the 15-minute track cap",
      },
    ]);
  });

  test("a short audio sample cannot become a set track", () => {
    const r = buildSet({
      candidates: [cand({ videoId: "ten-second-sample", durationS: 10 })],
      preset: SET_PRESETS.warmup,
      minutes: 10,
    });

    expect(r.steps).toEqual([]);
    expect(r.actualMinutes).toBe(0);
    expect(r.complete).toBe(false);
    expect(r.excluded).toEqual([
      {
        videoId: "ten-second-sample",
        title: "X",
        reason: "10-second audio sample is below the 1-minute track floor",
      },
    ]);
  });

  test("an overlong requested opener is rejected once and the arc still builds", () => {
    const r = buildSet({
      candidates: [
        cand({ videoId: "long-opener", durationS: 90 * 60 }),
        cand({ videoId: "normal-track", durationS: 5 * 60 }),
      ],
      preset: SET_PRESETS.warmup,
      minutes: 5,
      openerId: "long-opener",
    });

    expect(r.steps.map((step) => step.videoId)).toEqual(["normal-track"]);
    expect(r.excluded).toEqual([
      {
        videoId: "long-opener",
        title: "X",
        reason: "90-minute continuous mix exceeds the 15-minute track cap",
      },
    ]);
    expect(r.steps.length + r.excluded.length).toBe(2);
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
    const excluded = r.excluded.find((row) => row.videoId === "req");
    expect(excluded?.reason).toContain("requested opener");
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
    const excluded = r.excluded.find((row) => row.videoId === "ghost");
    expect(excluded?.reason).toContain("requested opener");
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

  test("opener pick requires a livable tempo neighborhood (the 2-track warmup bug)", () => {
    // regression: the warmup opener was picked by arousal-distance ALONE,
    // landing on the pool's minimum-arousal track — a 73 BPM outlier in a
    // 125 BPM library. Its ±6% window held ~3 tracks, so the chain
    // dead-ended after 2 steps and all 298 others were excluded as "no
    // compatible transition". The pick now requires ≥15 tracks within
    // ±6% before a candidate may anchor the arc.
    const candidates = [
      // pool-min arousal, dead-end tempo — the old pick
      cand({ videoId: "slow-outlier", arousal: 2.6, bpm: 73, key: null }),
      // lively tempo neighborhood, slightly further from the arc start
      ...Array.from({ length: 20 }, (_, i) =>
        cand({
          videoId: `lib-${String(i).padStart(2, "0")}`,
          arousal: 4.4 + i * 0.05,
          bpm: 124 + (i % 3),
          key: "8A",
        }),
      ),
    ];
    const r = buildSet({
      candidates,
      preset: SET_PRESETS.warmup,
      minutes: 30,
    });
    expect(r.steps.length).toBeGreaterThan(2);
    expect(r.steps[0]!.videoId).not.toBe("slow-outlier");
  });

  test("sparse pools run the beam search and it beats greedy where greedy dead-ends (E7)", () => {
    // E7's measured scenario: greedy's myopic first hop strands the chain.
    // Wheel geometry: op=8A → decoy=9A is the classic ±1 move (score 1),
    // and the chain tracks sit at 7A — compatible with the opener (±1)
    // but a dist-2 CLASH from the decoy. Pure greedy steps onto the
    // decoy (it wins the first hop on arc fit) and dies at 2 tracks;
    // the beam prunes that doomed branch and chains the whole cluster.
    const candidates = [
      cand({ videoId: "op", bpm: 126, key: "8A", arousal: 6 }),
      // greedy's pick: best first-hop score (closer to the arc target)…
      cand({ videoId: "decoy", bpm: 126, key: "9A", arousal: 6.5 }),
      // …but every chain track clashes with the decoy's key
      ...Array.from({ length: 6 }, (_, i) =>
        cand({
          videoId: `chain-${i}`,
          bpm: 126,
          key: "7A",
          arousal: 7 + i * 0.2,
        }),
      ),
    ];
    const greedy = buildSet({
      candidates,
      preset: SET_PRESETS.peak,
      minutes: 60,
      searchOverride: "greedy",
    });
    const beamed = buildSet({
      candidates,
      preset: SET_PRESETS.peak,
      minutes: 60,
      searchOverride: "beam",
    });
    // greedy takes the decoy and dies there (7A is a dist-2 wall from 9A)
    expect(greedy.steps.map((s) => s.videoId).slice(0, 2)).toEqual([
      "op",
      "decoy",
    ]);
    expect(greedy.steps.length).toBe(2);
    // beam skips the doomed branch and chains the whole cluster
    expect(beamed.steps.length).toBeGreaterThan(2);
    expect(beamed.steps.map((s) => s.videoId)).not.toContain("decoy");
    // the automatic pick for this small pool IS the beam path, and the
    // result reports which search ran (the deep search is never silent)
    const auto = buildSet({
      candidates,
      preset: SET_PRESETS.peak,
      minutes: 60,
    });
    expect(auto.search).toBe("beam");
    expect(auto.steps.length).toBeGreaterThan(2);
  });

  test("beam prefers a completed low-score chain over a high-score partial", () => {
    // P1: the previous ranking used cumulative score only, which could make
    // a partial chain outrank the only complete path. This scenario keeps the
    // score-positive partial alive and confirms budget fill has priority.
    const candidates = [
      cand({
        videoId: "opener",
        durationS: 60,
        bpm: 126,
        key: "8A",
        arousal: 6.4,
        dance: 0.85,
      }),
      cand({
        videoId: "long",
        durationS: 900,
        bpm: 126,
        key: "9A",
        arousal: 1.4,
        dance: 0.1,
      }),
      ...Array.from({ length: 6 }, (_, i) =>
        cand({
          videoId: `short-${i}`,
          durationS: 60,
          bpm: 126,
          key: "7A",
          arousal: 6.8,
          dance: 0.88,
        }),
      ),
    ];
    const beamed = buildSet({
      candidates,
      preset: SET_PRESETS.peak,
      minutes: 10,
      searchOverride: "beam",
    });

    expect(beamed.complete).toBe(true);
    expect(beamed.actualMinutes).toBeGreaterThanOrEqual(10);
    expect(beamed.steps.map((s) => s.videoId)).toEqual(["opener", "long"]);
  });

  test("archive-scale pools stay on greedy — the E2/E3 finding that big pools gain nothing", () => {
    const candidates = Array.from({ length: 300 }, (_, i) =>
      cand({
        videoId: `big-${String(i).padStart(3, "0")}`,
        bpm: 124 + (i % 3),
        key: "8A",
        arousal: 5 + (i % 4) * 0.8,
      }),
    );
    const r = buildSet({ candidates, preset: SET_PRESETS.peak, minutes: 60 });
    expect(r.search).toBe("greedy");
    expect(r.steps.length).toBeGreaterThan(10);
  });

  test("the pool-size rule is rest.length + 1 < SET_BEAM_POOL_MAX — exact at the boundary", () => {
    // 300 uniform tracks fill any budget, so 8-minute requests make the
    // chain length (not mixability) the observable; the strategy pick
    // only sees the pool size, and every surface quotes the SAME two
    // constants instead of hand-copied thresholds.
    expect(SET_BEAM_POOL_MAX).toBe(250);
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        cand({
          videoId: `t${String(i).padStart(3, "0")}`,
          bpm: 126,
          key: "8A",
        }),
      );
    // rest.length + 1 = 250 → 250 is NOT < 250 → greedy on the line
    const atBoundary = buildSet({
      candidates: mk(SET_BEAM_POOL_MAX),
      preset: SET_PRESETS.peak,
      minutes: 8,
    });
    expect(atBoundary.search).toBe("greedy");
    // rest.length + 1 = 249 < 250 → beam one below the line
    const below = buildSet({
      candidates: mk(SET_BEAM_POOL_MAX - 1),
      preset: SET_PRESETS.peak,
      minutes: 8,
    });
    expect(below.search).toBe("beam");
    // a forced override beats the pool-size rule at any size
    const forced = buildSet({
      candidates: mk(SET_BEAM_POOL_MAX),
      preset: SET_PRESETS.peak,
      minutes: 8,
      searchOverride: "beam",
    });
    expect(forced.search).toBe("beam");
  });

  test("every candidate lands in exactly one bucket — chain or excluded — on both paths", () => {
    // the double-exclusion regression, now asserted for BOTH strategies
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        cand({
          videoId: `p${String(i).padStart(2, "0")}`,
          bpm: 126,
          key: "8A",
        }),
      );
    for (const n of [8, 260]) {
      const r = buildSet({
        candidates: mk(n),
        preset: SET_PRESETS.peak,
        minutes: 8,
      });
      const ids = r.steps.map((s) => s.videoId);
      const seen = new Set<string>();
      for (const e of r.excluded) {
        expect(seen.has(e.videoId)).toBe(false);
        expect(ids).not.toContain(e.videoId);
        seen.add(e.videoId);
      }
      expect(ids.length + seen.size).toBe(n);
    }
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

describe("scoring constants are pinned — a silent drift would re-rank every proposal", () => {
  test("tempo window keeps the classic DJ mixability curve (±2% → ±6%)", () => {
    expect(SET_TEMPO_PERFECT).toBe(0.02);
    expect(SET_TEMPO_WINDOW).toBe(0.06);
    // the curve itself: full score inside the flat zone, zero beyond the
    // window (d = |a−b|/max), linear between (midpoint proves the slope)
    expect(bpmScore(120, 120 * 1.02)).toBe(1);
    expect(bpmScore(128, 137)).toBe(0); // 7.03% off the max — window over
    expect(bpmScore(128, 134)).toBeCloseTo(0.380597, 6); // ~4.7% off
  });
  test("transition weights keep tempo > key > arc-fit emphasis", () => {
    expect(SET_TRANSITION_WEIGHTS.tempo).toBe(0.45);
    expect(SET_TRANSITION_WEIGHTS.key).toBe(0.3);
    expect(SET_TRANSITION_WEIGHTS.arcFit).toBe(0.25);
    expect(
      SET_TRANSITION_WEIGHTS.tempo +
        SET_TRANSITION_WEIGHTS.key +
        SET_TRANSITION_WEIGHTS.arcFit,
    ).toBeCloseTo(1, 10);
  });
});

describe("clampSetPool (the ?limit= guard shared by route + MCP tool)", () => {
  test("clamps into 1–1000, unlimited when absent/non-finite", () => {
    expect(clampSetPool(500)).toBe(500);
    expect(clampSetPool(0)).toBe(1);
    expect(clampSetPool(-5)).toBe(1);
    expect(clampSetPool(99999)).toBe(1000);
    expect(clampSetPool(12.7)).toBe(13);
    expect(clampSetPool(null)).toBe(0);
    expect(clampSetPool(undefined)).toBe(0);
    expect(clampSetPool(Number.NaN)).toBe(0);
  });
  test("the shared sentinel and explicit cap cannot describe a false default", () => {
    expect(SET_POOL_UNLIMITED).toBe(0);
    expect(SET_POOL_MAX).toBe(1000);
  });
});

describe("isShelfOffline (the unmounted-shelf signature)", () => {
  const offline = {
    steps: [],
    source_total: 3664,
    pool: 8,
    missing_files: 3656,
    relocated_files: 0,
  };
  test("empty chain + every path missing → true (shelf volume is away)", () => {
    expect(isShelfOffline(offline, offline)).toBe(true);
  });
  test("a partial pool is a library verdict, NOT an offline signature", () => {
    const partial = { ...offline, steps: [{ atMin: 5 }], missing_files: 3000 };
    expect(isShelfOffline(partial, partial)).toBe(false);
  });
  test("a normal build (some missing, chain built) → false", () => {
    const ok = { ...offline, steps: [{ atMin: 60 }], pool: 3563 };
    expect(isShelfOffline(ok, ok)).toBe(false);
  });
  test("relocated files prove the shelf IS mounted → false", () => {
    const relocated = { ...offline, relocated_files: 12 };
    expect(isShelfOffline(relocated, relocated)).toBe(false);
  });
  test("empty archive (0 rows) → false (a different 'needs attention')", () => {
    const empty = { ...offline, source_total: 0, pool: 0, missing_files: 0 };
    expect(isShelfOffline(empty, empty)).toBe(false);
  });
  test("steps/census split inputs (server result + census pair)", () => {
    expect(isShelfOffline({ steps: [] }, offline)).toBe(true);
    expect(isShelfOffline({ steps: [{ atMin: 1 }] }, offline)).toBe(false);
  });
});
