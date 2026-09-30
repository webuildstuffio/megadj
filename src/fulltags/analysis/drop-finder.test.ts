import { describe, expect, test } from "bun:test";
import { findDropSection, findDropCandidates } from "./drop-finder";

describe("findDropSection", () => {
  test("returns null when fewer than 16 downbeats", () => {
    expect(findDropSection([0, 2, 4, 6, 8, 10])).toBeNull();
    expect(findDropSection([])).toBeNull();
  });

  test("returns a section when exactly 16 bars", () => {
    const downbeats = Array.from({ length: 16 }, (_, i) => i * 1.875);
    const section = findDropSection(downbeats, 30);
    expect(section).not.toBeNull();
    expect(section!.lengthBars).toBe(16);
    expect(section!.startSec).toBeGreaterThanOrEqual(0);
    expect(section!.endSec).toBeGreaterThan(section!.startSec);
    expect(section!.durationSec).toBeGreaterThan(0);
    expect(section!.score).toBeGreaterThan(0);
  });

  test("prefers the middle of the track (drop territory)", () => {
    const downbeats = Array.from({ length: 64 }, (_, i) => i * 1.875);
    const section = findDropSection(downbeats, 120);
    expect(section).not.toBeNull();
    expect(section!.startBar).toBeGreaterThanOrEqual(10);
    expect(section!.startBar).toBeLessThanOrEqual(40);
    expect(section!.lengthBars).toBe(32);
  });

  test("density breaks ties: denser bars score higher", () => {
    const downbeats: number[] = [];
    let t = 0;
    for (let i = 0; i < 20; i++) {
      downbeats.push(t);
      t += 2.5;
    }
    for (let i = 0; i < 32; i++) {
      downbeats.push(t);
      t += 1.5;
    }
    for (let i = 0; i < 20; i++) {
      downbeats.push(t);
      t += 2.5;
    }
    const section = findDropSection(downbeats, t);
    expect(section).not.toBeNull();
    expect(section!.startBar).toBeGreaterThanOrEqual(15);
    expect(section!.startBar).toBeLessThanOrEqual(35);
  });

  test("section duration is reasonable (30s–120s for typical tracks)", () => {
    const downbeats = Array.from({ length: 128 }, (_, i) => i * 1.875);
    const section = findDropSection(downbeats, 240);
    expect(section).not.toBeNull();
    expect(section!.durationSec).toBeGreaterThanOrEqual(30);
    expect(section!.durationSec).toBeLessThanOrEqual(120);
  });

  test("startBar is 1-based", () => {
    const downbeats = Array.from({ length: 32 }, (_, i) => i * 2);
    const section = findDropSection(downbeats, 64);
    expect(section).not.toBeNull();
    expect(section!.startBar).toBeGreaterThanOrEqual(1);
  });
});

describe("findDropCandidates", () => {
  test("returns empty for too-short tracks", () => {
    expect(findDropCandidates([0, 2, 4])).toEqual([]);
  });

  test("returns up to N non-overlapping candidates", () => {
    const downbeats = Array.from({ length: 128 }, (_, i) => i * 1.875);
    const candidates = findDropCandidates(downbeats, 3, 240);
    expect(candidates.length).toBeLessThanOrEqual(3);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    // Sorted by score descending
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i]!.score).toBeLessThanOrEqual(
        candidates[i - 1]!.score,
      );
    }
  });

  test("candidates are non-overlapping (gap >= 8 bars)", () => {
    const downbeats = Array.from({ length: 128 }, (_, i) => i * 1.875);
    const candidates = findDropCandidates(downbeats, 5, 240);
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const gap = Math.abs(candidates[i]!.startBar - candidates[j]!.startBar);
        expect(gap).toBeGreaterThanOrEqual(8);
      }
    }
  });

  test("first candidate matches findDropSection", () => {
    const downbeats = Array.from({ length: 64 }, (_, i) => i * 1.875);
    const single = findDropSection(downbeats, 120);
    const candidates = findDropCandidates(downbeats, 3, 120);
    expect(candidates[0]!.startBar).toBe(single!.startBar);
  });
});
