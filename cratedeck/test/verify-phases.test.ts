// verify-phases.test.ts — regression for the verify job's phase→progress
// mapping. Two bugs once lived here:
//   1. the phase regexes required leading spaces ("/^  tracks:/") but were
//      fed TRIMMED lines — the longest phase (per-track checks) never fired
//      and the progress bar sat at ~15% for minutes;
//   2. tick(from, to) computed progress as from/to (e.g. 0.15/0.35 = 43%)
//      instead of the absolute `from`.
// verifyPhase() is the extracted pure mapping; tests pin the contract.
import { describe, it, expect } from "bun:test";
import { verifyPhase } from "../src/jobs";

describe("verifyPhase", () => {
  it("matches indent-sensitive script lines even when untrimmed", () => {
    // usb_verify.py prints "  tracks: N" with leading spaces — the old
    // trimmed-input regexes never matched this line.
    const m = verifyPhase("  tracks: 3512", 0);
    expect(m).not.toBeNull();
    expect(m!.progress).toBe(0.35);
    expect(m!.nextIdx).toBe(2); // per-drive section fired → next candidate is idx 2
  });

  it("matches the ANLZ hashing progress lines", () => {
    const m = verifyPhase("  hashed 100/3500", 1);
    expect(m).not.toBeNull();
    expect(m!.progress).toBeGreaterThan(0.5);
  });

  it("walks phases in script order and reports absolute progress", () => {
    let idx = 0;
    const lines = [
      "### DJMASTER", // per-drive section → 0.15
      "  hardware view: export.pdb=3500 tracks vs OneLibrary DB=3500 tracks",
      "  tracks: 3500", // → 0.35 (longest phase)
      "  ANLZ missing at hash path AND at DB path: 0",
      "=== cross-drive ===", // → 0.85
      "  hashed 1200/3500", // → 0.9
      "audio hash spot-check (40): 0 mismatches", // → 0.95
      "FINAL: ALL PASS", // → 0.99
    ];
    const seen: number[] = [];
    for (const line of lines) {
      const m = verifyPhase(line, idx);
      if (m) {
        seen.push(m.progress);
        idx = m.nextIdx;
      }
    }
    expect(seen).toEqual([0.15, 0.35, 0.85, 0.9, 0.95, 0.99]);
  });

  it("returns null for non-phase output lines", () => {
    expect(verifyPhase("  MISMATCH: some/track.mp3", 1)).toBeNull();
    expect(verifyPhase("", 0)).toBeNull();
  });

  it("never rewinds: earlier-phase lines are ignored once passed", () => {
    // after tracks: fired (idx 1), another "### " line (idx 0) must not match
    expect(verifyPhase("### DJMIRROR", 1)).toBeNull();
  });
});
