/**
 * anlz + gridAuditFull tests — GA-03/GA-04. The parser is validated
 * against format constants from three independent published sources
 * (crate-digger ksy, djl-analysis field guide, fourfour PIONEER.md);
 * fixtures round-trip through the parser's own builder so the tests
 * exercise real container walking, not hand-mocked parse results.
 */
import { describe, expect, test } from "bun:test";
import {
  buildAnlz,
  parseAnlzGrid,
  parseAnlzInventory,
  type AnlzBeat,
} from "../src/anlz";
import { gridAuditFull } from "../src/analysis";

/** A clean 128 BPM grid: beats every 468.75 ms, downbeat first. */
function grid(beats: number, bpm = 128, startMs = 0): AnlzBeat[] {
  const step = 60000 / bpm;
  return Array.from({ length: beats }, (_, i) => ({
    num: (i % 4) + 1,
    bpmx100: Math.round(bpm * 100),
    timeMs: Math.round(startMs + i * step),
  }));
}

/** Our ledger grid: seconds, same tempo — matches ANLZ exactly. */
const ledgerGrid = (n: number, bpm = 128, startS = 0): number[] =>
  Array.from({ length: n }, (_, i) => startS + (i * 60) / bpm);

describe("parseAnlzGrid", () => {
  test("round-trips a built container", () => {
    const bytes = buildAnlz({
      path: "/Contents/Artist/track.aiff",
      beats: grid(8),
    });
    const g = parseAnlzGrid(bytes);
    expect(g).not.toBeNull();
    expect(g!.path).toBe("/Contents/Artist/track.aiff");
    expect(g!.beats).toHaveLength(8);
    expect(g!.beats[0]).toEqual({ num: 1, bpmx100: 12800, timeMs: 0 });
    expect(g!.beats[1]!.timeMs).toBe(469); // 468.75 rounded by the builder
  });

  test("rejects truncated / wrong-magic / empty input", () => {
    expect(parseAnlzGrid(new Uint8Array(0))).toBeNull();
    expect(parseAnlzGrid(new Uint8Array(30))).toBeNull();
    const bad = buildAnlz({ path: "/x", beats: grid(4) });
    bad.set([0x58, 0x58, 0x58, 0x58], 0); // not PMAI
    expect(parseAnlzGrid(bad)).toBeNull();
    expect(parseAnlzGrid(bad.subarray(0, 40))).toBeNull();
  });

  test("rejects PQTZ with a beat_number outside 1–4 or zero tempo", () => {
    const bytes = buildAnlz({ path: "/x", beats: grid(4) });
    // PQTZ starts right after the 44-byte head + path bytes ("/x" → 4
    // bytes + 2-byte NUL via the builder's utf16be).
    const pqOff = 44 + 6;
    const dv = new DataView(bytes.buffer);
    dv.setUint16(pqOff + 24, 7, false); // beat_number 7 — invalid
    expect(parseAnlzGrid(bytes)).toBeNull();
    dv.setUint16(pqOff + 24, 1, false);
    dv.setUint16(pqOff + 26, 0, false); // tempo 0
    expect(parseAnlzGrid(bytes)).toBeNull();
  });

  test("inventory lists sections with byte lengths (GA-07 diff view)", () => {
    const bytes = buildAnlz({
      path: "/x",
      beats: grid(4),
      extraSections: [{ tag: "PWAV", bytes: 420 }],
    });
    const inv = parseAnlzInventory(bytes);
    expect(inv).not.toBeNull();
    expect(inv!.sections.map((s) => s.tag)).toEqual(["PWAV", "PQTZ"]);
    expect(inv!.sections.find((s) => s.tag === "PQTZ")!.bytes).toBe(24 + 4 * 8);
    expect(inv!.sections.find((s) => s.tag === "PWAV")!.bytes).toBe(420);
  });

  test("no PQTZ → null grid (waveform-only sidecar), but inventory works", () => {
    const bytes = buildAnlz({
      path: "/x",
      extraSections: [{ tag: "PWAV", bytes: 420 }],
    });
    expect(parseAnlzGrid(bytes)).toBeNull();
    expect(parseAnlzInventory(bytes)!.sections.map((s) => s.tag)).toEqual([
      "PWAV",
    ]);
  });
});

describe("gridAuditFull (GA-04 completion: anchor/phase/SHIFT/PHASE)", () => {
  test("aligned grids → A-OK with anchor 0, phase 0", () => {
    const v = gridAuditFull(ledgerGrid(256), grid(256), 128);
    expect(v).not.toBeNull();
    expect(v!.bucket).toBe("A-OK");
    expect(Math.abs(v!.anchorDeltaMs)).toBeLessThanOrEqual(1);
    expect(v!.phaseBeats).toBe(0);
  });

  test("fixed +40 ms offset, same tempo → SHIFT (the bucket the ledger pass can't see)", () => {
    const v = gridAuditFull(ledgerGrid(256), grid(256, 128, 40), 128);
    expect(v!.bucket).toBe("SHIFT");
    expect(v!.anchorDeltaMs).toBe(40);
    // Zero whole beats of phase — the whole offset is sub-beat.
    expect(v!.phaseBeats).toBe(0);
    expect(v!.phaseMs).toBe(40);
  });

  test("one-beat offset → PHASE with phaseBeats 1", () => {
    const step = 60000 / 128;
    const v = gridAuditFull(ledgerGrid(256), grid(256, 128, step), 128);
    expect(v!.bucket).toBe("PHASE");
    expect(v!.phaseBeats).toBe(1);
    expect(Math.abs(v!.phaseMs)).toBeLessThanOrEqual(15);
  });

  test("two-beat offset → PHASE (downbeat on the wrong beat of the bar)", () => {
    const step = 60000 / 128;
    const v = gridAuditFull(ledgerGrid(256), grid(256, 128, step * 2), 128);
    expect(v!.bucket).toBe("PHASE");
    expect(v!.phaseBeats).toBe(2);
  });

  test("tempo-class problems keep their bucket (a shifted wrong-tempo grid is TEMPO first)", () => {
    // Ledger grid at 64 BPM against RB 128 → octave TEMPO dominates.
    const v = gridAuditFull(ledgerGrid(256, 64), grid(256, 128), 128);
    expect(v!.bucket).toBe("TEMPO");
  });

  test("1.4-beat offset → PHASE (nearest-beat) with the residual in phaseMs", () => {
    // Nearest whole beat is 1; the -0.4-beat (-187 ms) residual is the
    // calibration signal for GA-05, not a different bucket — the repair
    // for a constant offset is still a whole-beat shift.
    const step = 60000 / 128;
    const v = gridAuditFull(ledgerGrid(256), grid(256, 128, step * 1.4), 128);
    expect(v!.bucket).toBe("PHASE");
    expect(v!.phaseBeats).toBe(1);
    expect(Math.abs(v!.phaseMs)).toBeGreaterThan(15);
  });

  test("null when either side lacks a grid", () => {
    expect(gridAuditFull([], grid(8), 128)).toBeNull();
    expect(gridAuditFull(ledgerGrid(8), [], 128)).toBeNull();
    expect(gridAuditFull(ledgerGrid(4), grid(8), 128)).toBeNull();
  });
});
