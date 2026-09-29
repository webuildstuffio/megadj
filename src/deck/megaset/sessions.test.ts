// sessions.test.ts — M6 (#330): session storage + verb tests.
import { describe, expect, test } from "bun:test";
import {
  createSession,
  keepSteps,
  sessionResultStable,
  swapStep,
} from "./sessions";
import type {
  MegasetQuality,
  MegasetResult,
  MegasetStep,
} from "../shared/megaset";

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

const quality: MegasetQuality = {
  transition: 80,
  floor: 70,
  arc: 75,
  diversity: 100,
  budget: 100,
  landmark: 100,
  total: 85,
};

const result = (): MegasetResult => ({
  preset: "peak",
  minutes: 60,
  actualMinutes: 55,
  shortfallMinutes: 5,
  complete: false,
  steps: [
    step({ videoId: "a", transition: null, atMin: 5 }),
    step({ videoId: "b", transition: 0.9, atMin: 10 }),
    step({ videoId: "c", transition: 0.7, atMin: 15 }),
  ],
  excluded: [],
  excluded_total: 0,
  excluded_groups: [],
  budget_filled: 0,
  avg_transition: 0.8,
  min_transition: 0.7,
  same_artist_pairs: 0,
  landmarks_missing: [],
  search: "greedy",
});

describe("createSession (M6 #330)", () => {
  test("creates a session with deterministic JSON", () => {
    const r = result();
    const s = createSession({ result: r, quality, genre: "house" });
    expect(s.id).toMatch(/^ses-/);
    expect(s.parent_id).toBeNull();
    expect(s.preset).toBe("peak");
    expect(s.status).toBe("draft");
    expect(s.instruction).toBeNull();
    expect(JSON.parse(s.result_json)).toEqual(r);
  });

  test("child session carries parent_id and instruction", () => {
    const r = result();
    const s = createSession({
      result: r,
      quality,
      genre: "house",
      parentId: "ses-parent-123",
      instruction: "swap b for d",
    });
    expect(s.parent_id).toBe("ses-parent-123");
    expect(s.instruction).toBe("swap b for d");
  });

  test("JSON round-trip is byte-identical", () => {
    const r = result();
    const s = createSession({ result: r, quality, genre: null });
    const session = { ...s, updated_at: s.created_at };
    expect(sessionResultStable(session)).toBe(true);
  });
});

describe("keepSteps", () => {
  test("returns only videoIds present in the chain", () => {
    const r = result();
    const kept = keepSteps(r, ["a", "c", "zzz"]);
    expect(kept.size).toBe(2);
    expect(kept.has("a")).toBe(true);
    expect(kept.has("c")).toBe(true);
    expect(kept.has("zzz")).toBe(false);
  });

  test("empty keep list → empty set", () => {
    expect(keepSteps(result(), []).size).toBe(0);
  });
});

describe("swapStep", () => {
  test("replaces the target step and recomputes stats", () => {
    const r = result();
    const replacement = step({ videoId: "d", transition: 0.95 });
    const swapped = swapStep(r, "b", replacement);

    expect(swapped.steps[1]?.videoId).toBe("d");
    expect(swapped.steps[1]?.atMin).toBe(10); // preserves slot position
    expect(swapped.steps).toHaveLength(3);
    // avg and min recomputed
    expect(swapped.avg_transition).not.toBe(r.avg_transition);
    expect(swapped.min_transition).not.toBeNull();
  });

  test("unknown target → result unchanged", () => {
    const r = result();
    const replacement = step({ videoId: "d" });
    const swapped = swapStep(r, "zzz", replacement);
    expect(swapped).toBe(r); // same reference
  });
});
