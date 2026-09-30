import { describe, expect, test } from "bun:test";
import { findDropSection } from "./drop-finder";

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
  });

  test("prefers the middle of the track (drop territory)", () => {
    // 64 bars at 128 BPM (~1.875s per bar) = 2-minute track
    const downbeats = Array.from({ length: 64 }, (_, i) => i * 1.875);
    const section = findDropSection(downbeats, 120);
    expect(section).not.toBeNull();
    // The 32-bar window should start roughly in the middle (bars 16–48)
    expect(section!.startBar).toBeGreaterThanOrEqual(10);
    expect(section!.startBar).toBeLessThanOrEqual(40);
    expect(section!.lengthBars).toBe(32);
  });

  test("density breaks ties: denser bars score higher", () => {
    // Track with a dense middle section (faster BPM) and sparse ends
    const downbeats: number[] = [];
    let t = 0;
    // Bars 1-20: slow (2.5s per bar)
    for (let i = 0; i < 20; i++) {
      downbeats.push(t);
      t += 2.5;
    }
    // Bars 21-52: fast (1.5s per bar) — the "drop"
    for (let i = 0; i < 32; i++) {
      downbeats.push(t);
      t += 1.5;
    }
    // Bars 53-72: slow again (2.5s per bar)
    for (let i = 0; i < 20; i++) {
      downbeats.push(t);
      t += 2.5;
    }
    const section = findDropSection(downbeats, t);
    expect(section).not.toBeNull();
    // Should land in the fast section (bar 21–52 area)
    expect(section!.startBar).toBeGreaterThanOrEqual(15);
    expect(section!.startBar).toBeLessThanOrEqual(35);
  });

  test("section duration is reasonable (30s–120s for typical tracks)", () => {
    // 128 bars at 128 BPM
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
