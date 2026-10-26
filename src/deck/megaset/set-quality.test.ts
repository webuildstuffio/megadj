// set-quality.test.ts — M4 (#328): SetQuality pure function tests.
import { describe, expect, test } from "bun:test";
import { setQuality } from "./set-quality";
import type { MegasetResult, MegasetStep } from "../shared/megaset";

const step = (over: Partial<MegasetStep> = {}): MegasetStep => ({
  videoId: "x",
  title: "Track",
  artist: "DJ",
  bpm: 128,
  key: "8A",
  arousal: 5,
  atMin: 5,
  transition: 0.8,
  evidence: null,
  landmark: false,
  mixOutCue: null,
  mixInCue: null,
  ...over,
});

const result = (over: Partial<MegasetResult> = {}): MegasetResult => ({
  preset: "peak",
  minutes: 60,
  actualMinutes: 60,
  shortfallMinutes: 0,
  complete: true,
  steps: [
    step({ transition: null, atMin: 5 }),
    step({ atMin: 10 }),
    step({ atMin: 15 }),
    step({ atMin: 20 }),
  ],
  excluded: [],
  excluded_total: 0,
  excluded_groups: [],
  budget_filled: 0,
  avg_transition: 0.8,
  min_transition: 0.8,
  same_artist_pairs: 0,
  landmarks_missing: [],
  search: "greedy",
  seed: 0,
  ...over,
});

describe("setQuality (M4 #328)", () => {
  test("default peak fixture → known component scores", () => {
    expect(setQuality(result())).toEqual({
      transition: 80,
      floor: 80,
      arc: 33.6,
      diversity: 100,
      budget: 100,
      landmark: 100,
      total: 77.7,
    });
  });

  test("empty chain → all zeros", () => {
    const q = setQuality(result({ steps: [] }));
    expect(q.total).toBe(0);
    expect(q.transition).toBe(0);
  });

  test("single-step chain → transition component is 100 (no transitions)", () => {
    const q = setQuality(result({ steps: [step({ transition: null, atMin: 5 })] }));
    expect(q.transition).toBe(100);
    expect(q.floor).toBe(100);
  });

  test("perfect transitions score high", () => {
    const steps = [
      step({ transition: null, atMin: 5 }),
      step({ transition: 1.0, atMin: 10 }),
      step({ transition: 0.95, atMin: 15 }),
      step({ transition: 0.98, atMin: 20 }),
    ];
    const q = setQuality(result({ steps }));
    expect(q.transition).toBeGreaterThan(90);
    expect(q.floor).toBeGreaterThan(90);
  });

  test("weak transitions drag floor component", () => {
    const steps = [
      step({ transition: null, atMin: 5 }),
      step({ transition: 0.9, atMin: 10 }),
      step({ transition: 0.2, atMin: 15 }),
      step({ transition: 0.85, atMin: 20 }),
    ];
    const q = setQuality(result({ steps }));
    expect(q.floor).toBeLessThan(30);
    expect(q.transition).toBeGreaterThan(q.floor);
  });

  test("same-artist pairs reduce diversity", () => {
    const q0 = setQuality(result({ same_artist_pairs: 0 }));
    const q3 = setQuality(
      result({
        same_artist_pairs: 3,
        steps: [
          step({ transition: null, atMin: 5 }),
          step({ atMin: 10 }),
          step({ atMin: 15 }),
          step({ atMin: 20 }),
        ],
      }),
    );
    expect(q0.diversity).toBe(100);
    expect(q3.diversity).toBeLessThan(q0.diversity);
  });

  test("incomplete budget reduces budget component", () => {
    const q = setQuality(
      result({ complete: false, minutes: 60, actualMinutes: 30, shortfallMinutes: 30 }),
    );
    expect(q.budget).toBe(50);
  });

  test("full budget → 100", () => {
    const q = setQuality(result({ complete: true }));
    expect(q.budget).toBe(100);
  });

  test("landmark misses reduce landmark component", () => {
    const steps = [
      step({ transition: null, landmark: true, atMin: 5 }),
      step({ landmark: false, atMin: 10 }),
    ];
    const q = setQuality(result({ steps, landmarks_missing: ["track-a", "track-b"] }));
    // 1 placed / 3 requested = 33.3
    expect(q.landmark).toBeCloseTo(33.3, 0);
  });

  test("no landmarks requested → 100", () => {
    const q = setQuality(result({ landmarks_missing: [] }));
    expect(q.landmark).toBe(100);
  });

  test("total is weighted blend of components, clamped 0–100", () => {
    const q = setQuality(result());
    expect(q.total).toBeGreaterThanOrEqual(0);
    expect(q.total).toBeLessThanOrEqual(100);
    // Components exist and are valid ranges
    for (const key of ["transition", "floor", "arc", "diversity", "budget", "landmark"] as const) {
      expect(q[key]).toBeGreaterThanOrEqual(0);
      expect(q[key]).toBeLessThanOrEqual(100);
    }
  });

  test("arc adherence: perfect arc match → high score", () => {
    // peak preset: arousal [6, 8.5]
    const steps = Array.from({ length: 10 }, (_, i) => {
      const t = i / 9;
      return step({ arousal: 6 + t * 2.5, atMin: (i + 1) * 5, transition: i === 0 ? null : 0.8 });
    });
    const q = setQuality(result({ steps, preset: "peak" }));
    expect(q.arc).toBeGreaterThan(85);
  });

  test("arc adherence: inverted arc → low score", () => {
    // peak preset arousal climbs 6→8.5; we send it 8→3
    const steps = Array.from({ length: 10 }, (_, i) => {
      const t = i / 9;
      return step({ arousal: 8 - t * 5, atMin: (i + 1) * 5, transition: i === 0 ? null : 0.8 });
    });
    const q = setQuality(result({ steps, preset: "peak" }));
    expect(q.arc).toBeLessThan(50);
  });
});
