// transition-types.test.ts — M5 (#329): typed transition grammar tests.
import { describe, expect, test } from "bun:test";
import {
  classifyChain,
  classifyTransition,
  TRANSITION_TYPE_LABELS,
  typedCoverage,
  type TransitionType,
} from "./transition-types";
import { fakeStep as step } from "../../test-support/megaset-fixtures";

describe("classifyTransition (M5 #329)", () => {
  test("opener (null transition) → hold", () => {
    const r = classifyTransition(step(), step({ transition: null }));
    expect(r.type).toBe("hold");
    expect(r.reason).toContain("opener");
  });

  test("half-time evidence → half-time-shift", () => {
    const r = classifyTransition(
      step(),
      step({
        evidence: {
          tempo: 0.3,
          key: 0.3,
          arcFit: 0.2,
          anchor: 0.1,
          similarity: 0,
          artistPenalty: 0,
          total: 0.9,
          halftime: true,
        },
      }),
    );
    expect(r.type).toBe("half-time-shift");
  });

  test("large cue overlap → long-blend", () => {
    const r = classifyTransition(
      step({ mixOutCue: { bar: 33, position: 60 } }),
      step({ mixInCue: { bar: 17, position: 30 } }),
    );
    expect(r.type).toBe("long-blend");
    expect(r.reason).toContain("16-bar");
  });

  test("high arousal + early cue → drop-entry", () => {
    const r = classifyTransition(
      step({ mixOutCue: { bar: 57, position: 110 } }),
      step({ arousal: 7.5, mixInCue: { bar: 1, position: 0 } }),
    );
    expect(r.type).toBe("drop-entry");
  });

  test("large arousal delta with cues → energy-swap", () => {
    const r = classifyTransition(
      step({ arousal: 3, mixOutCue: { bar: 57, position: 110 } }),
      step({ arousal: 7, mixInCue: { bar: 9, position: 16 } }),
    );
    expect(r.type).toBe("energy-swap");
  });

  test("cues present, no special condition → phrase-cut", () => {
    const r = classifyTransition(
      step({ arousal: 5, mixOutCue: { bar: 57, position: 110 } }),
      step({ arousal: 5.5, mixInCue: { bar: 49, position: 95 } }),
    );
    expect(r.type).toBe("phrase-cut");
  });

  test("no cues, large arousal delta → energy-swap", () => {
    const r = classifyTransition(step({ arousal: 3 }), step({ arousal: 7 }));
    expect(r.type).toBe("energy-swap");
  });

  test("no cues, small arousal delta → hold", () => {
    const r = classifyTransition(step({ arousal: 5 }), step({ arousal: 5.5 }));
    expect(r.type).toBe("hold");
    expect(r.reason).toContain("no cues");
  });
});

describe("classifyChain", () => {
  test("empty chain → empty", () => {
    expect(classifyChain([])).toEqual([]);
  });

  test("single step → opener hold", () => {
    const r = classifyChain([step({ transition: null })]);
    expect(r).toHaveLength(1);
    expect(r[0]?.type).toBe("hold");
  });

  test("multi-step chain has one classification per step", () => {
    const chain = [step({ transition: null, atMin: 5 }), step({ atMin: 10 }), step({ atMin: 15 })];
    const r = classifyChain(chain);
    expect(r).toHaveLength(3);
    expect(r[0]?.type).toBe("hold"); // opener
  });
});

describe("typedCoverage", () => {
  test("all non-hold transitions → ratio 1", () => {
    const c = typedCoverage([
      { type: "hold", reason: "opener" },
      { type: "phrase-cut", reason: "test" },
      { type: "long-blend", reason: "test" },
    ]);
    expect(c.typed).toBe(2);
    expect(c.total).toBe(2);
    expect(c.ratio).toBe(1);
  });

  test("mixed hold/typed → correct ratio", () => {
    const c = typedCoverage([
      { type: "hold", reason: "opener" },
      { type: "phrase-cut", reason: "test" },
      { type: "hold", reason: "no cues" },
      { type: "long-blend", reason: "test" },
    ]);
    expect(c.typed).toBe(2);
    expect(c.total).toBe(3);
    expect(c.ratio).toBeCloseTo(2 / 3, 10);
  });

  test("empty → ratio 1 (no transitions to judge)", () => {
    expect(typedCoverage([]).ratio).toBe(1);
  });
});

describe("TRANSITION_TYPE_LABELS", () => {
  test("every TransitionType has a label", () => {
    const types: TransitionType[] = [
      "long-blend",
      "phrase-cut",
      "energy-swap",
      "half-time-shift",
      "drop-entry",
      "hold",
    ];
    for (const t of types) {
      expect(TRANSITION_TYPE_LABELS[t]).toBeDefined();
      expect(typeof TRANSITION_TYPE_LABELS[t]).toBe("string");
    }
  });
});
