/**
 * anlz.test.ts — pins the ANLZ codec contract: build/parse round-trips
 * and rewriteAnlzGrid's byte-exactness guarantees (#147 Q4 armament).
 * rewriteAnlzGrid is the function the sacrificial-track experiment
 * trusts — the invariants here are the difference between a grid
 * repair and a corrupted sidecar.
 */
import { describe, expect, test } from "bun:test";
import {
  buildAnlz,
  parseAnlzGrid,
  parseAnlzInventory,
  rewriteAnlzGrid,
  type AnlzBeat,
} from "./anlz";

const grid = (bpmx100: number, n: number): AnlzBeat[] =>
  Array.from({ length: n }, (_, i) => ({
    num: ((i % 4) + 1) as 1 | 2 | 3 | 4,
    bpmx100,
    timeMs: i * Math.round(60000 / bpmx100),
  }));

describe("buildAnlz / parseAnlzGrid round-trip", () => {
  test("beats survive an encode/decode cycle", () => {
    const beats = grid(12800, 64);
    const data = buildAnlz({
      path: "/volume/MUSIC/track.aiff",
      beats,
      extraSections: [{ tag: "PWAV", bytes: 1200 }],
    });
    const parsed = parseAnlzGrid(data);
    expect(parsed).not.toBeNull();
    expect(parsed!.beats).toEqual(beats);
    expect(parsed!.path).toBe("/volume/MUSIC/track.aiff");
  });
});

describe("rewriteAnlzGrid (the #147 Q4 writer)", () => {
  const beats0 = grid(12800, 64);
  const beats1 = grid(12900, 64); // same count, new tempo
  const beatsHalf = grid(12800, 32); // fewer beats → PQTZ shrinks
  const base = buildAnlz({
    path: "/volume/MUSIC/track.aiff",
    beats: beats0,
    extraSections: [
      { tag: "PWAV", bytes: 900 },
      { tag: "PCOB", bytes: 300 },
    ],
  });

  test("same beat count: parses back to the new grid", () => {
    const out = rewriteAnlzGrid(base, beats1);
    expect(out).not.toBeNull();
    const g = parseAnlzGrid(out!);
    expect(g!.beats).toEqual(beats1);
    expect(g!.path).toBe("/volume/MUSIC/track.aiff");
  });

  test("same beat count: file length + section inventory unchanged", () => {
    const out = rewriteAnlzGrid(base, beats1)!;
    expect(out.length).toBe(base.length);
    const invWas = parseAnlzInventory(base)!.sections;
    const invNow = parseAnlzInventory(out)!.sections;
    expect(invNow).toEqual(invWas);
  });

  test("sections OUTSIDE PQTZ are byte-identical (PPTH/PWAV/PCOB untouched)", () => {
    const out = rewriteAnlzGrid(base, beats1)!;
    // PPTH: bytes 0..44+plen — the head + path
    expect([...out.subarray(0, 60)]).toEqual([...base.subarray(0, 60)]);
    // Locate the grid in the INPUT the way the writer does (container
    // walk), then assert everything before and after the PQTZ span is
    // byte-identical (the waveform + color boxes are the expensive part)
    const inv = parseAnlzInventory(base)!.sections;
    const before = inv.slice(
      0,
      inv.findIndex((s) => s.tag === "PQTZ"),
    );
    const headEnd = 44 + 2 * ("/volume/MUSIC/track.aiff".length + 1);
    const preBytes = before.reduce((n, s) => n + s.bytes, 0);
    const pqStart = headEnd + preBytes;
    const pqTotal = 24 + beats0.length * 8;
    expect([...out.subarray(0, pqStart)]).toEqual([
      ...base.subarray(0, pqStart),
    ]);
    expect([...out.subarray(pqStart + pqTotal)]).toEqual([
      ...base.subarray(pqStart + pqTotal),
    ]);
  });

  test("fewer beats: PQTZ shrinks, container stays walkable", () => {
    const out = rewriteAnlzGrid(base, beatsHalf)!;
    expect(out.length).toBe(base.length - 32 * 8);
    const inv = parseAnlzInventory(out);
    expect(inv).not.toBeNull();
    const pq = inv!.sections.find((s) => s.tag === "PQTZ");
    expect(pq!.bytes).toBe(24 + 32 * 8);
    expect(parseAnlzGrid(out)!.beats).toEqual(beatsHalf);
  });

  test("no PQTZ in the input → null (never fabricate a grid section)", () => {
    const noGrid = buildAnlz({
      path: "/x",
      extraSections: [{ tag: "PWAV", bytes: 64 }],
    });
    expect(parseAnlzGrid(noGrid)).toBeNull();
    expect(rewriteAnlzGrid(noGrid, beats1)).toBeNull();
  });

  test("garbage input → null, never a throw", () => {
    expect(rewriteAnlzGrid(new Uint8Array(4), beats1)).toBeNull();
    expect(
      rewriteAnlzGrid(new TextEncoder().encode("not an anlz file"), beats1),
    ).toBeNull();
  });
});
