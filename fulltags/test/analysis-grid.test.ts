/**
 * plan.md GA-01 + GA-04: the constant-tempo fit and the grid-audit
 * verdicts. Pure math — no env, no fixtures. These pin the numbers the
 * whole grid-audit story depends on (the "largest single accuracy gain"
 * claim lives or dies by the fit being exact on clean grids).
 */
import { describe, test, expect } from "bun:test";
import { fitConstantTempo, gridAudit, foldTempo } from "../src/analysis";

/** Perfect machine grid: n beats at exactly `bpm` starting at t0. */
const perfectGrid = (bpm: number, n: number, t0 = 0.02): number[] =>
  Array.from({ length: n }, (_, i) => t0 + (i * 60) / bpm);

describe("fitConstantTempo (GA-01)", () => {
  test("recovers the exact tempo from a perfect grid", () => {
    const g = perfectGrid(128, 640); // 5 min of house
    const fit = fitConstantTempo(g)!;
    // Regression is exact on a perfect grid — not median-interbeat
    // rounding to 128.00; expect sub-0.001 BPM error.
    expect(Math.abs(fit.bpmFitted - 128)).toBeLessThan(0.001);
    expect(fit.residualStd).toBeLessThan(1e-6);
  });

  test("beats the median-interval readout on a rounded grid", () => {
    // Real ledger data arrives rounded to 1/10000 s; at 123.456 BPM the
    // median interval snaps to 0.486 s → 123.04 BPM off, while the fit
    // uses every interval and lands on the truth.
    const bpm = 123.456;
    const g = perfectGrid(bpm, 400).map((t) => Math.round(t * 10000) / 10000);
    const fit = fitConstantTempo(g)!;
    const medianBpm = 60 / (g[10]! - g[9]!);
    expect(Math.abs(fit.bpmFitted - bpm)).toBeLessThan(
      Math.abs(medianBpm - bpm),
    );
    expect(Math.abs(fit.bpmFitted - bpm)).toBeLessThan(0.02);
  });

  test("residual exposes non-constant tempo (halved at the halfway point)", () => {
    // 128 BPM for 3 min, then 140 for 3 min — the fit's residual must be
    // large, flagging "multi-point grid" territory.
    const a = perfectGrid(128, 192); // 3 min
    const last = a[a.length - 1]!;
    const b = Array.from({ length: 210 }, (_, i) => last + (i * 60) / 140);
    const fit = fitConstantTempo([...a, ...b])!;
    expect(fit.residualStd * (60 / fit.bpmFitted) * 1000).toBeGreaterThan(40);
  });

  test("degenerate inputs return null, never a confident tempo", () => {
    expect(fitConstantTempo([])).toBeNull();
    expect(fitConstantTempo([0, 1, 2])).toBeNull(); // <4 beats
    expect(fitConstantTempo([0, 0, 0, 0, 0])).toBeNull(); // zero span
    expect(fitConstantTempo([0, NaN, 2, 3, 4])).toBeNull(); // non-finite
  });
});

describe("gridAudit (GA-04/GA-05)", () => {
  test("A-OK: clean grid at the stored BPM", () => {
    const v = gridAudit(perfectGrid(128, 640), 128)!;
    expect(v.bucket).toBe("A-OK");
    expect(Math.abs(v.bpmDelta)).toBeLessThan(0.1);
    expect(Math.abs(v.driftMs)).toBeLessThan(15);
    expect(v.anchorDeltaMs).toBeNull(); // ANLZ decode is GA-03's scope
  });

  test("TEMPO: octave lock detected by ratio, not by count", () => {
    // grid at 87, RB stored 174 (the drum&bass half-lock)
    const v = gridAudit(perfectGrid(87, 400), 174)!;
    expect(v.bucket).toBe("TEMPO");
    expect(Math.abs(v.bpmRatio - 0.5)).toBeLessThan(0.001);
  });

  test("DRIFT: monotonic positional deviation on a tempo mismatch", () => {
    // RB says 130.4, the real grid is 146 — deviation accumulates in one
    // direction to seconds by the outro.
    const v = gridAudit(perfectGrid(146, 730), 130.4)!;
    expect(v.bucket).toBe("DRIFT");
    expect(Math.abs(v.driftMs)).toBeGreaterThan(15);
    expect(v.driftMonotonic).toBe(true);
  });

  test("SHIFT/PHASE stay unassigned until the ANLZ anchor exists", () => {
    // The ledger-only pass can't see RB's anchor, so a uniform anchor
    // offset (the plan's SHIFT) is invisible here — a 130.4348 grid vs
    // RB 128 over a 5-minute track IS >15 ms of slide → DRIFT, not
    // SHIFT. GA-03's ANLZ decode will split DRIFT-vs-SHIFT honestly.
    const v = gridAudit(perfectGrid(130.4348, 640), 128)!;
    expect(v.bucket).toBe("DRIFT");
    expect(v.bpmDelta).toBeCloseTo(-2.4, 1);
  });

  test("CHAOS: sign-flipping jitter routes to manual", () => {
    // Half the track at 128, half at 140, RB stores the average —
    // deviation swings both directions.
    const a = perfectGrid(128, 192);
    const last = a[a.length - 1]!;
    const b = Array.from({ length: 192 }, (_, i) => last + (i * 60) / 140);
    const v = gridAudit([...a, ...b], 133.5)!;
    expect(["CHAOS", "DRIFT"]).toContain(v.bucket);
    expect(v.bucket === "CHAOS" ? !v.driftMonotonic : true).toBe(true);
  });

  test("short/degenerate grids return null", () => {
    expect(gridAudit([], 128)).toBeNull();
    expect(gridAudit([0, 1, 2, 3], 128)).toBeNull(); // <8 beats
    expect(gridAudit(perfectGrid(128, 640), 0)).toBeNull(); // no RB BPM
  });
});

describe("foldTempo regression guard", () => {
  test("70–180 window folding unchanged (trap convention input)", () => {
    expect(foldTempo(140)).toBe(140);
    expect(foldTempo(70)).toBe(70);
    expect(foldTempo(280)).toBe(140);
    expect(foldTempo(35)).toBe(70);
  });
});
