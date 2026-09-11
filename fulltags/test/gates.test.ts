import { describe, expect, test } from "bun:test";
import {
  GateSaturationError,
  applyGateWritesSync,
  runRegate,
  type GateObservation,
} from "../src/gates";

describe("re-gate harness", () => {
  const observations: GateObservation<number>[] = [
    { id: "good", expected: 120, actual: 120.5 },
    { id: "drift", expected: 128, actual: 132 },
    { id: "missing", expected: 140, actual: null },
  ];

  test("reports per-track percentage offsets and an 80% verdict", () => {
    const result = runRegate({
      dimension: "bpm",
      observations,
      tolerancePercent: 2,
      passPercent: 80,
    });
    expect(result.tracks).toHaveLength(3);
    expect(result.tracks[0]).toMatchObject({
      id: "good",
      offsetPercent: 0.42,
      pass: true,
    });
    expect(result.passPercent).toBe(33.3);
    expect(result.passed).toBe(false);
  });

  test("fails loudly when a detector head saturates", () => {
    expect(() =>
      runRegate({
        dimension: "effnet",
        observations: [
          { id: "a", expected: "house", actual: "house" },
          { id: "b", expected: "trap", actual: "house" },
        ],
      }),
    ).toThrow(GateSaturationError);
  });

  test("never invokes the writer when the gate fails", () => {
    let calls = 0;
    const result = runRegate({
      dimension: "bpm",
      observations,
      tolerancePercent: 2,
      passPercent: 80,
    });
    const writes = applyGateWritesSync(
      result,
      [{ filePath: "/tmp/not-written.mp3", patch: { bpm: 120 } }],
      () => {
        calls++;
        return true;
      },
    );
    expect(writes).toEqual({ attempted: 0, written: 0, failed: 0 });
    expect(calls).toBe(0);
  });

  test("uses label equality for genre and writes only after a pass", () => {
    const result = runRegate({
      dimension: "genre",
      observations: [
        { id: "a", expected: "House", actual: "House" },
        { id: "b", expected: "Trap", actual: "Trap" },
      ],
      passPercent: 80,
    });
    let calls = 0;
    const writes = applyGateWritesSync(
      result,
      [{ filePath: "/tmp/accepted.mp3", patch: { genre: "House" } }],
      () => {
        calls++;
        return true;
      },
    );
    expect(writes).toEqual({ attempted: 1, written: 1, failed: 0 });
    expect(calls).toBe(1);
  });
});
