// jobs-progress.test.ts — regressions for the "always spinning" bug class
// (Sep 8 2026). Four independent defects made running jobs look frozen or
// lie about time:
//   1. the ETA sampler pinned its rate baseline to the first sample
//      (`lastCount === 0 ||` guard), so the ETA froze after the first
//      second and flapped to null as jobs changed speed;
//   2. benchmark/checksum/scan jobs had NO wall-clock bound and their
//      liveness heartbeat hid a wedged job from the phantom reaper
//      forever (spawn-backed verify/mirror already had timeouts);
//   3. cancelled jobs were forced to progress 1 — a full green bar over
//      a job that never finished;
//   4. phase strings were machine-speak ("phase-2") in a human dock.
import { describe, it, expect } from "bun:test";
import { createEtaEstimator, verifyPhase } from "../src/jobs";

describe("createEtaEstimator", () => {
  it("returns null until a full sample window exists (primed, not frozen)", () => {
    const eta = createEtaEstimator();
    expect(eta(0, 100, 0)).toBeNull(); // prime
    expect(eta(10, 100, 500)).toBeNull(); // <1s window: keep last verdict
    // window closes: 10 items in 1s → rate 10/s, 90 left → 9s
    expect(eta(10, 100, 1_000)).toBe(9);
  });

  it("re-bases the rate window on every sample ≥1s apart — no frozen first sample", () => {
    const eta = createEtaEstimator();
    eta(0, 1000, 0); // prime
    // fast burst: 200 items in the first 1s window → rate 200/s
    expect(eta(200, 1000, 1_000)).toBe(4); // 800 left / 200 per s
    // then it crawls: 10 more items over the next 10s → rate 1/s
    // the old code kept the frozen first-sample rate (ETA would still
    // claim ~4s here); the fix re-derives from the CURRENT window.
    expect(eta(210, 1000, 11_000)).toBe(790);
  });

  it("reports null (unknown) when the window saw no movement", () => {
    const eta = createEtaEstimator();
    eta(0, 100, 0);
    expect(eta(50, 100, 1_000)).toBe(1);
    // stalled: no progress for 5s → honest unknown, not a stale ETA
    expect(eta(50, 100, 6_000)).toBeNull();
  });

  it("never goes negative near completion", () => {
    const eta = createEtaEstimator();
    eta(0, 100, 0);
    expect(eta(100, 100, 1_000)).toBe(0);
    expect(eta(105, 100, 2_000)).toBe(0); // overshoot clamps, no -N seconds
  });
});

describe("verifyPhase", () => {
  it("still maps the real script's phase lines (unchanged contract)", () => {
    const m = verifyPhase("  tracks: 3512", 0);
    expect(m).not.toBeNull();
    expect(m!.progress).toBe(0.35);
  });
});
