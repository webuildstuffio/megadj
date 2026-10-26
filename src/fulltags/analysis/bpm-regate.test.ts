/**
 * bpm-regate.test.ts — Tests for BPM regate logic (B1.4).
 */
import { describe, expect, test } from "bun:test";
import { gateBpm, bpmInGenreRange, regateBpm } from "./bpm-regate";

describe("gateBpm", () => {
  test("within 1% → pass", () => {
    expect(gateBpm(128, 128)).toBe("pass");
    expect(gateBpm(127, 128)).toBe("pass");
    expect(gateBpm(129, 128)).toBe("pass");
  });

  test("octave double → octave", () => {
    expect(gateBpm(256, 128)).toBe("octave");
  });

  test("octave half → octave", () => {
    expect(gateBpm(64, 128)).toBe("octave");
  });

  test("far off → fail", () => {
    expect(gateBpm(100, 128)).toBe("fail");
  });
});

describe("bpmInGenreRange", () => {
  test("house: 128 is in range", () => {
    expect(bpmInGenreRange(128, "house")).toBe(true);
  });

  test("house: 90 is out of range", () => {
    expect(bpmInGenreRange(90, "house")).toBe(false);
  });

  test("drum and bass: 174 is in range", () => {
    expect(bpmInGenreRange(174, "drum and bass")).toBe(true);
  });

  test("null genre → always in range", () => {
    expect(bpmInGenreRange(999, null)).toBe(true);
  });

  test("unknown genre → always in range", () => {
    expect(bpmInGenreRange(999, "polka")).toBe(true);
  });
});

describe("regateBpm", () => {
  test("matches answer key → pass", () => {
    const results = regateBpm(
      [{ trackId: "t1", bpm: 128, genreFamily: "house" }],
      new Map([["t1", 128]]),
    );
    expect(results[0]!.verdict).toBe("pass");
    expect(results[0]!.needsReanalysis).toBe(false);
  });

  test("out of genre range without AK → fail", () => {
    const results = regateBpm([{ trackId: "t1", bpm: 90, genreFamily: "house" }], new Map());
    expect(results[0]!.verdict).toBe("fail");
    expect(results[0]!.needsReanalysis).toBe(true);
  });

  test("batch processing", () => {
    const results = regateBpm(
      [
        { trackId: "t1", bpm: 128, genreFamily: "house" },
        { trackId: "t2", bpm: 174, genreFamily: "drum and bass" },
        { trackId: "t3", bpm: 90, genreFamily: "techno" },
      ],
      new Map([["t1", 128]]),
    );
    expect(results).toHaveLength(3);
    expect(results[0]!.verdict).toBe("pass");
    expect(results[2]!.verdict).toBe("fail");
  });
});
