// engine-plan.test.ts — M3 (#327) golden pins for the buildPlan() extraction.
//
// These tests are written against PRE-refactor output (the extraction must
// keep them green). Two pin layers:
//
//   1. GOLDEN CHAIN: buildMegaset's full wire output, JSON-stable-sorted,
//      for a scenario matrix (3 presets × greedy/beam × landmark repair ×
//      requested opener) — the chain may not move a single byte.
//   2. PLAN SEAM: the extract-only helper the refactor introduces
//      (`buildPlan`) — same inputs → identical plan, JSON round-trip
//      byte-identical, and the engine's strategy/pins ride the Plan.
//
// Determinism law (v3 §9): same inputs → byte-identical chain, now also
// byte-identical Plan. (The fill stays engine-owned in M3 — planToWire's
// slot-consumption split arrives with M4/M5; this file pins the seam
// the later moves consume.)
import { describe, expect, test } from "bun:test";
import { SET_PRESETS, buildMegaset, type SetCandidate } from "./engine";
import { buildPlan, planPoolProbe } from "./plan";

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
  cues: [],
  embedding: null,
  ...over,
});

/** Deterministic synthetic pool: 60 analyzed tracks spanning the arc —
 *  BPM ladder around the anchor, keys rotating through the compatible
 *  neighborhood, arousal climbing. Some unanalyzed (bpm null), some
 *  duration-floor rejects, a same-artist run, and embeddings on a third
 *  of the pool so the similarity term participates. */
function syntheticPool(): SetCandidate[] {
  const pool: SetCandidate[] = [];
  const keys = ["8A", "7A", "9A", "8B", "9B", "10A"] as const;
  for (let i = 0; i < 60; i++) {
    pool.push(
      cand({
        videoId: `t${String(i).padStart(2, "0")}`,
        title: `Track ${i}`,
        artist: i % 7 === 3 ? "Same Artist" : `Artist ${i % 11}`,
        durationS: i % 13 === 0 ? 40 : i % 17 === 0 ? 900 : 240 + i * 4,
        bpm: i % 9 === 8 ? null : 120 + (i % 18) * 2,
        key: keys[i % keys.length]!,
        arousal: 2 + (i % 60) / 10,
        dance: 0.4 + ((i * 7) % 50) / 100,
        cues:
          i % 5 === 0
            ? [
                { bar: 1, position: 0 },
                { bar: 17, position: 30.5 },
              ]
            : [],
        embedding: i % 3 === 0 ? [0.1 * (i % 5), 0.2, 0.3] : null,
      }),
    );
  }
  return pool;
}

/** JSON with object keys in sorted order — the byte-identity contract
 *  doesn't care about key ORDER, only value identity; sorting makes the
 *  snapshot stable against property insertion-order drift. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).toSorted(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    }
    return v;
  });
}

describe("#327 M3 golden chain (pre-extraction pin)", () => {
  const pool = syntheticPool();

  // scenario matrix: preset × strategy × landmark × opener
  const scenarios = [
    { name: "warmup/auto", preset: SET_PRESETS.warmup, minutes: 45 },
    { name: "peak/auto", preset: SET_PRESETS.peak, minutes: 90 },
    { name: "afterhours/auto", preset: SET_PRESETS.afterhours, minutes: 60 },
    {
      name: "peak/beam-forced",
      preset: SET_PRESETS.peak,
      minutes: 45,
      searchOverride: "beam" as const,
    },
    {
      name: "peak/greedy-forced",
      preset: SET_PRESETS.peak,
      minutes: 45,
      searchOverride: "greedy" as const,
    },
    {
      name: "warmup+landmarks",
      preset: SET_PRESETS.warmup,
      minutes: 45,
      landmarkIds: ["t33", "t09", "t51", "zzz-unknown"],
      openerId: "t05",
    },
    {
      name: "afterhours+opener",
      preset: SET_PRESETS.afterhours,
      minutes: 30,
      openerId: "t02",
    },
  ];

  for (const s of scenarios) {
    test(`golden: ${s.name} — chain stable, re-run identical`, () => {
      const input = {
        candidates: [...pool],
        preset: s.preset,
        minutes: s.minutes,
        ...(s.searchOverride !== undefined
          ? { searchOverride: s.searchOverride }
          : {}),
        ...(s.landmarkIds !== undefined ? { landmarkIds: s.landmarkIds } : {}),
        ...(s.openerId !== undefined ? { openerId: s.openerId } : {}),
      };
      const first = buildMegaset(input);
      const second = buildMegaset(structuredClone(input));
      // determinism: same inputs → same output (v0 law, re-proven here)
      expect(stableJson(second)).toBe(stableJson(first));
      // the chain shape the refactor must preserve
      expect(first.steps.length).toBeGreaterThan(3);
      expect(first.search).toMatch(/^(beam|greedy)$/u);
      // golden snapshot of the FULL wire shape (steps+excluded+stats)
      expect(stableJson(first)).toMatchSnapshot();
    });
  }

  test("golden: landmark repair pass pins land and unplaceable pins report", () => {
    const r = buildMegaset({
      candidates: [...pool],
      preset: SET_PRESETS.warmup,
      minutes: 45,
      // probed placeable pins on this pool (t05/t22/t30 pass the arc gates
      // with the corrected anchor scoring; others score −1 at every legal
      // slot and MUST stay missing)
      landmarkIds: ["t05", "t22", "t30", "zzz-unknown"],
    });
    const placedIds = new Set(
      r.steps.filter((s) => s.landmark).map((s) => s.videoId),
    );
    for (const id of ["t05", "t22", "t30"]) {
      expect(placedIds.has(id)).toBe(true);
    }
    // the unknown pin lands in landmarks_missing with honest accounting —
    // first-request order of the UNPLACED pins
    expect(r.landmarks_missing).toEqual(["zzz-unknown"]);
    // pinned opener counts once (already slot 1) and still reports placed
    const r2 = buildMegaset({
      candidates: [...pool],
      preset: SET_PRESETS.warmup,
      minutes: 45,
      landmarkIds: ["t05", "t22", "zzz-unknown"],
      openerId: "t05",
    });
    const placed2 = r2.steps.filter((s) => s.landmark).map((s) => s.videoId);
    expect(placed2).toEqual(["t05", "t22"]);
    expect(r2.landmarks_missing).toEqual(["zzz-unknown"]);
  });
});

describe("#327 M3 plan seam (post-extraction contract)", () => {
  const pool = syntheticPool();

  test("plan is deterministic: same inputs → identical plan", () => {
    const input = {
      preset: SET_PRESETS.warmup,
      minutes: 45,
      landmarkIds: ["t33", "t09"],
      openerId: "t05",
      poolSize: planPoolProbe(pool).size,
    };
    const a = buildPlan(input);
    const b = buildPlan({ ...input });
    expect(stableJson(b)).toBe(stableJson(a));
  });

  test("plan reflects its inputs: override/pins/size change the plan", () => {
    const base = {
      preset: SET_PRESETS.warmup,
      minutes: 45,
      poolSize: planPoolProbe(pool).size,
    };
    const beam = buildPlan({ ...base, searchOverride: "beam" });
    const greedy = buildPlan({ ...base, searchOverride: "greedy" });
    expect(beam.strategy).toBe("beam");
    expect(greedy.strategy).toBe("greedy");
    expect(beam.strategyForced).toBe(true);
    const auto = buildPlan(base);
    expect(auto.strategyForced).toBe(false);
    // pool size rule: at MAX (250) → greedy ON the line; below → beam
    expect(buildPlan({ ...base, poolSize: 249 }).strategy).toBe("beam");
    expect(buildPlan({ ...base, poolSize: 250 }).strategy).toBe("greedy");
    // pins dedupe, first-request order
    const pinned = buildPlan({ ...base, landmarkIds: ["b", "a", "b", "a"] });
    expect(pinned.landmarkIds).toEqual(["b", "a"]);
  });

  test("plan JSON round-trips byte-identical (AC #2)", () => {
    const plan = buildPlan({
      preset: SET_PRESETS.peak,
      minutes: 60,
      landmarkIds: ["t33"],
      poolSize: planPoolProbe(pool).size,
    });
    const round = structuredClone(plan);
    expect(JSON.stringify(round)).toBe(JSON.stringify(plan));
    expect(stableJson(round)).toBe(stableJson(plan));
    // the REAL AC: a JSON wire trip (serialize → parse) is byte-identical
    const wireText = JSON.stringify(plan);
    const wire = JSON.parse(wireText) as typeof plan;
    expect(JSON.stringify(wire)).toBe(wireText);
  });

  test("plan shape: arc thirds + opener policy + drift + budget", () => {
    const plan = buildPlan({
      preset: SET_PRESETS.warmup,
      minutes: 45,
      poolSize: 42,
    });
    expect(plan.version).toBe(1);
    expect(plan.presetId).toBe("warmup");
    expect(plan.budgetS).toBe(45 * 60);
    expect(plan.segments.map((s) => s.role)).toEqual(["open", "build", "land"]);
    // windows tile [0,1] exactly
    expect(plan.segments[0]!.window).toEqual([0, 1 / 3]);
    expect(plan.segments[2]!.window).toEqual([2 / 3, 1]);
    // warmup climbs: energy ranges ascend across segments
    expect(plan.segments[2]!.energyRange[1]!).toBeGreaterThan(
      plan.segments[0]!.energyRange[0]!,
    );
    // keyRegion null until a track anchors (M3: opener key lands at fill)
    expect(plan.segments.every((s) => s.keyRegion === null)).toBe(true);
    expect(plan.opener.minNeighbors).toBe(15);
    expect(plan.opener.tieBreak).toBe("arousal-then-id");
    expect(plan.driftBudget).toBe(0.12);
    expect(plan.branchLanes).toEqual([2, 0.5]);
    // S8 neighbor floor rides the plan (the fill enforces it)
    expect(plan.opener.startArousal).toBeCloseTo(
      SET_PRESETS.warmup.arousal[0] / 9,
      12,
    );
  });
});
