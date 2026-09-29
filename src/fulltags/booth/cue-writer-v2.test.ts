/**
 * cue-writer-v2.test.ts — Tests for structural cue writer v2 (B8.4).
 */
import { describe, expect, test } from "bun:test";
import {
  planCueWrites,
  AGENT_CUE_MARKER,
  STRUCTURAL_CUE_SLOTS,
  type StructuralCue,
  type ExistingCue,
} from "./cue-writer-v2";

describe("planCueWrites", () => {
  const dropCue: StructuralCue = {
    slot: STRUCTURAL_CUE_SLOTS.DROP_1,
    positionMs: 60000,
    label: `${AGENT_CUE_MARKER} DROP`,
    colour: { r: 255, g: 0, b: 0 },
    source: "drop",
  };

  test("writes to empty slot", () => {
    const plan = planCueWrites([dropCue], []);
    expect(plan.writes).toHaveLength(1);
    expect(plan.skipped).toHaveLength(0);
  });

  test("skips user-placed hot cue", () => {
    const existing: ExistingCue[] = [
      {
        slot: STRUCTURAL_CUE_SLOTS.DROP_1,
        kind: 1,
        positionMs: 50000,
        label: "My cue",
      },
    ];
    const plan = planCueWrites([dropCue], existing);
    expect(plan.writes).toHaveLength(0);
    expect(plan.skipped).toContain(STRUCTURAL_CUE_SLOTS.DROP_1);
  });

  test("updates agent-managed hot cue", () => {
    const existing: ExistingCue[] = [
      {
        slot: STRUCTURAL_CUE_SLOTS.DROP_1,
        kind: 1,
        positionMs: 55000,
        label: `${AGENT_CUE_MARKER} OLD DROP`,
      },
    ];
    const plan = planCueWrites([dropCue], existing);
    expect(plan.writes).toHaveLength(1);
    expect(plan.updated).toContain(STRUCTURAL_CUE_SLOTS.DROP_1);
  });

  test("ignores memory cues (kind=0)", () => {
    const existing: ExistingCue[] = [
      {
        slot: STRUCTURAL_CUE_SLOTS.DROP_1,
        kind: 0,
        positionMs: 50000,
        label: "Memory",
      },
    ];
    const plan = planCueWrites([dropCue], existing);
    // Memory cue doesn't block hot cue slot
    expect(plan.writes).toHaveLength(1);
  });

  test("multiple cues: mixed writes and skips", () => {
    const introCue: StructuralCue = {
      slot: STRUCTURAL_CUE_SLOTS.INTRO,
      positionMs: 0,
      label: `${AGENT_CUE_MARKER} INTRO`,
      colour: { r: 40, g: 226, b: 20 },
      source: "phrase",
    };
    const existing: ExistingCue[] = [
      {
        slot: STRUCTURAL_CUE_SLOTS.DROP_1,
        kind: 1,
        positionMs: 50000,
        label: "User Drop",
      },
    ];
    const plan = planCueWrites([introCue, dropCue], existing);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]!.slot).toBe(STRUCTURAL_CUE_SLOTS.INTRO);
    expect(plan.skipped).toContain(STRUCTURAL_CUE_SLOTS.DROP_1);
  });
});
