// megaset-contract.test.ts — the megaset SURFACE contracts: query
// parsing (preset/minutes validation), the shared pool-cap guard, and
// the shelf-offline wire signature. Split out of megaset.test.ts
// (file-length guard); the pure-engine scoring/sequencing tests stay
// in megaset.test.ts.
import { describe, expect, test } from "bun:test";
import { bpmScore, parseMegasetQuery } from "../src/megaset";
import {
  isShelfOffline,
  clampMegasetPool,
  MEGASET_POOL_MAX,
  MEGASET_POOL_UNLIMITED,
  MEGASET_TEMPO_PERFECT,
  MEGASET_TEMPO_WINDOW,
  MEGASET_TRANSITION_WEIGHTS,
} from "../shared/types";

describe("parseMegasetQuery", () => {
  test("defaults: absent preset/minutes → peak / 60", () => {
    expect(parseMegasetQuery({})).toEqual({ preset: "peak", minutes: 60 });
    expect(parseMegasetQuery({ preset: null, minutes: null })).toEqual({
      preset: "peak",
      minutes: 60,
    });
  });
  test("minutes clamp into 10–240; absent stays default, PRESENT-but-invalid errors (B7)", () => {
    expect(parseMegasetQuery({ minutes: "999" })).toEqual({
      preset: "peak",
      minutes: 240,
    });
    expect(parseMegasetQuery({ minutes: "1" })).toEqual({
      preset: "peak",
      minutes: 10,
    });
    expect(parseMegasetQuery({ minutes: "90" })).toEqual({
      preset: "peak",
      minutes: 90,
    });
    // a number delivered as a number is fine too (MCP surface)
    expect(parseMegasetQuery({ minutes: 45 })).toEqual({
      preset: "peak",
      minutes: 45,
    });
    // B7 regression (issue #105): "banana" used to silently re-score as
    // the 60-minute default; now it errors like the unknown-preset path
    const bad = parseMegasetQuery({ minutes: "banana" });
    expect("error" in bad && bad.error).toContain('got "banana"');
    expect(parseMegasetQuery({ minutes: Number.NaN })).toEqual({
      error: 'minutes must be a number (got "NaN")',
    });
    // empty string = absent → default (the UI's blank input)
    expect(parseMegasetQuery({ minutes: "" })).toEqual({
      preset: "peak",
      minutes: 60,
    });
  });
  test("valid preset accepted", () => {
    expect(parseMegasetQuery({ preset: "afterhours" })).toEqual({
      preset: "afterhours",
      minutes: 60,
    });
  });
  test("unknown preset → error, never a silent peak fallback", () => {
    const r = parseMegasetQuery({ preset: "wedding" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toContain("warmup, peak, afterhours");
  });
});

describe("scoring constants are pinned — a silent drift would re-rank every proposal", () => {
  test("tempo window keeps the classic DJ mixability curve (±2% → ±6%)", () => {
    expect(MEGASET_TEMPO_PERFECT).toBe(0.02);
    expect(MEGASET_TEMPO_WINDOW).toBe(0.06);
    // the curve itself: full score inside the flat zone, zero beyond the
    // window (d = |a−b|/max), linear between (midpoint proves the slope)
    expect(bpmScore(120, 120 * 1.02)).toBe(1);
    expect(bpmScore(128, 137)).toBe(0); // 7.03% off the max — window over
    expect(bpmScore(128, 134)).toBeCloseTo(0.380597, 6); // ~4.7% off
  });
  test("transition weights keep tempo > key > arc-fit emphasis", () => {
    expect(MEGASET_TRANSITION_WEIGHTS.tempo).toBe(0.45);
    expect(MEGASET_TRANSITION_WEIGHTS.key).toBe(0.3);
    expect(MEGASET_TRANSITION_WEIGHTS.arcFit).toBe(0.25);
    expect(
      MEGASET_TRANSITION_WEIGHTS.tempo +
        MEGASET_TRANSITION_WEIGHTS.key +
        MEGASET_TRANSITION_WEIGHTS.arcFit,
    ).toBeCloseTo(1, 10);
  });
});

describe("clampMegasetPool (the ?limit= guard shared by route + MCP tool)", () => {
  test("clamps into 1–1000, unlimited when absent/non-finite", () => {
    expect(clampMegasetPool(500)).toBe(500);
    expect(clampMegasetPool(0)).toBe(1);
    expect(clampMegasetPool(-5)).toBe(1);
    expect(clampMegasetPool(99999)).toBe(1000);
    expect(clampMegasetPool(12.7)).toBe(13);
    expect(clampMegasetPool(null)).toBe(0);
    expect(clampMegasetPool(undefined)).toBe(0);
    expect(clampMegasetPool(Number.NaN)).toBe(0);
  });
  test("the shared sentinel and explicit cap cannot describe a false default", () => {
    expect(MEGASET_POOL_UNLIMITED).toBe(0);
    expect(MEGASET_POOL_MAX).toBe(1000);
  });
});

describe("isShelfOffline (the unmounted-shelf signature)", () => {
  const offline = {
    steps: [],
    source_total: 3664,
    pool: 8,
    missing_files: 3656,
    metadata_only: 0,
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
  test("B1 (#104): metadata-only rows are part of the missing population — the identity includes them", () => {
    // the audit's live offline census WITH B1 admission: 8 mounted +
    // 3,500 mirror-scored + 156 unmeasurable missing = 3,664 total
    const offlineWithMeta = {
      ...offline,
      pool: 8,
      metadata_only: 3500,
      missing_files: 156,
    };
    // steps empty + every row accounted by (pool + metadata + missing)
    // and nothing relocated → still the shelf-offline signature
    expect(isShelfOffline(offlineWithMeta, offlineWithMeta)).toBe(true);
    // but if the chain built from those metadata rows, it is NOT offline
    const built = { ...offlineWithMeta, steps: [{ atMin: 30 }] };
    expect(isShelfOffline(built, built)).toBe(false);
  });
});
