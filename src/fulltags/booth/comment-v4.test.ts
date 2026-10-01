/**
 * comment-v4.test.ts — Tests for booth metadata v4.
 *
 * Format: `E8 IN:32 OUT:16 VOX Drop Dark · MelTechno`
 */
import { describe, expect, test } from "bun:test";
import {
  abbreviateSubgenre,
  buildCommentV4,
  energyBand,
  energyBandFromScores,
  familyPercentile,
  parseCommentV4,
  passesSubgenreGate,
  roundBarsDown,
  type MixWindowBars,
} from "./comment-v4";

// ---------- roundBarsDown ----------

describe("roundBarsDown", () => {
  const cases: [number, MixWindowBars][] = [
    [0, 0],
    [4, 0],
    [7, 0],
    [8, 8],
    [15, 8],
    [16, 16],
    [30, 16],
    [31, 16],
    [32, 32],
    [63, 32],
    [64, 64],
    [128, 64],
    [256, 64],
  ];

  test.each(cases)("%d bars → IN:%d", (raw, expected) => {
    expect(roundBarsDown(raw)).toBe(expected);
  });
});

// ---------- energyBand ----------

describe("energyBand", () => {
  test("percentile 0 → E1", () => {
    expect(energyBand(0.01)).toBe(1);
  });

  test("percentile 0.5 → E5", () => {
    expect(energyBand(0.5)).toBe(5);
  });

  test("percentile 1.0 → E9", () => {
    expect(energyBand(1.0)).toBe(9);
  });

  test("percentile 0.11 → E1", () => {
    expect(energyBand(0.11)).toBe(1);
  });

  test("percentile 0.12 → E2", () => {
    expect(energyBand(0.12)).toBe(2);
  });

  test("percentile 0.89 → E9", () => {
    expect(energyBand(0.89)).toBe(9);
  });

  test("clamps below 1", () => {
    expect(energyBand(0)).toBe(1);
  });
});

// ---------- energyBandFromScores ----------

describe("energyBandFromScores", () => {
  test("lowest score → E1", () => {
    const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(energyBandFromScores(1, scores)).toBe(1);
  });

  test("highest score → E9", () => {
    const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(energyBandFromScores(9, scores)).toBe(9);
  });

  test("empty library → E5", () => {
    expect(energyBandFromScores(5, [])).toBe(5);
  });

  test("mid score in large library → mid band", () => {
    const scores = Array.from({ length: 100 }, (_, i) => i + 1);
    const band = energyBandFromScores(50, scores);
    expect(band).toBeGreaterThanOrEqual(4);
    expect(band).toBeLessThanOrEqual(5);
  });
});

// ---------- familyPercentile ----------

describe("familyPercentile", () => {
  test("top of family → near 1.0", () => {
    const family = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    expect(familyPercentile(0.9, family, family)).toBeCloseTo(1.0, 1);
  });

  test("bottom of family → near 0.1", () => {
    const family = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    expect(familyPercentile(0.1, family, family)).toBeCloseTo(0.11, 1);
  });

  test("small family (<300) falls back to allValues", () => {
    const small = [0.5, 0.6, 0.7];
    const all = Array.from({ length: 1000 }, (_, i) => i / 1000);
    const pctSmall = familyPercentile(0.5, small, all);
    expect(pctSmall).toBeCloseTo(0.501, 1);
  });

  test("large family uses family values", () => {
    const big = Array.from({ length: 500 }, (_, i) => i / 500);
    const all = Array.from({ length: 5000 }, (_, i) => i / 5000);
    const pct = familyPercentile(0.5, big, all);
    expect(pct).toBeGreaterThan(0.4);
    expect(pct).toBeLessThan(0.6);
  });
});

// ---------- passesSubgenreGate ----------

describe("passesSubgenreGate", () => {
  test("high score, clear lead → pass", () => {
    expect(passesSubgenreGate(0.7, 0.2)).toBe(true);
  });

  test("score below 0.5 → fail", () => {
    expect(passesSubgenreGate(0.4, 0.1)).toBe(false);
  });

  test("score 0.5, lead exactly 0.15 → pass", () => {
    expect(passesSubgenreGate(0.5, 0.35)).toBe(true);
  });

  test("score 0.5, lead under 0.15 → fail", () => {
    expect(passesSubgenreGate(0.5, 0.36)).toBe(false);
  });

  test("no runner-up → pass", () => {
    expect(passesSubgenreGate(0.8, 0)).toBe(true);
  });
});

// ---------- abbreviateSubgenre ----------

describe("abbreviateSubgenre", () => {
  test("known subgenres abbreviate", () => {
    expect(abbreviateSubgenre("Tech House")).toBe("TechHouse");
    expect(abbreviateSubgenre("Melodic Techno")).toBe("MelTechno");
    expect(abbreviateSubgenre("Drum & Bass")).toBe("DnB");
    expect(abbreviateSubgenre("Hip-Hop")).toBe("HipHop");
    expect(abbreviateSubgenre("UK Garage")).toBe("UKG");
    expect(abbreviateSubgenre("Psytrance")).toBe("Psy");
    expect(abbreviateSubgenre("deep house")).toBe("DeepHouse");
  });

  test("unknown subgenre strips spaces", () => {
    expect(abbreviateSubgenre("Future Funk")).toBe("FutureFunk");
  });

  test("slashes and apostrophes are stripped", () => {
    expect(abbreviateSubgenre("EDM/Bass")).toBe("EDMBass");
    expect(abbreviateSubgenre("Funky/groove/jackin'house")).toBe(
      "Funkygroovejackinhouse",
    );
  });

  test("accented characters transliterated to ASCII", () => {
    expect(abbreviateSubgenre("Electrónica")).toBe("Electronica");
    expect(abbreviateSubgenre("Eletrônica")).toBe("Eletronica");
    expect(abbreviateSubgenre("Matveï")).toBe("Matvei");
  });

  test("new map entries resolve correctly", () => {
    expect(abbreviateSubgenre("Alternative Rock")).toBe("AltRock");
    expect(abbreviateSubgenre("Contemporary R&B")).toBe("RnB");
    expect(abbreviateSubgenre("Soulful House")).toBe("SoulHouse");
  });
});

// ---------- buildCommentV4 ----------

describe("buildCommentV4", () => {
  test("full v4: all tokens", () => {
    expect(
      buildCommentV4({
        energy: 8,
        introBars: 32,
        outroBars: 16,
        vox: true,
        hook: false,
        drop: true,
        roll: false,
        hard: false,
        soft: false,
        dark: true,
        euph: false,
        varTempo: false,
        subgenre: "MelTechno",
      }),
    ).toBe("E8 IN:32 OUT:16 VOX Drop Dark · MelTechno");
  });

  test("energy only (no phrase data)", () => {
    expect(
      buildCommentV4({
        energy: 5,
        introBars: null,
        outroBars: null,
        vox: false,
        hook: false,
        drop: false,
        roll: false,
        hard: false,
        soft: false,
        dark: false,
        euph: false,
        varTempo: false,
        subgenre: null,
      }),
    ).toBe("E5");
  });

  test("energy + mood tokens only", () => {
    expect(
      buildCommentV4({
        energy: 9,
        introBars: null,
        outroBars: null,
        vox: false,
        hook: false,
        drop: false,
        roll: false,
        hard: true,
        soft: false,
        dark: true,
        euph: false,
        varTempo: false,
        subgenre: "PeakTechno",
      }),
    ).toBe("E9 Hard Dark · PeakTechno");
  });

  test("HOOK instead of VOX", () => {
    expect(
      buildCommentV4({
        energy: 6,
        introBars: 32,
        outroBars: 32,
        vox: false,
        hook: true,
        drop: false,
        roll: true,
        hard: false,
        soft: false,
        dark: false,
        euph: false,
        varTempo: false,
        subgenre: "DeepHouse",
      }),
    ).toBe("E6 IN:32 OUT:32 HOOK Roll · DeepHouse");
  });

  test("Hard and Euph together (not contradictory)", () => {
    expect(
      buildCommentV4({
        energy: 9,
        introBars: 32,
        outroBars: 16,
        vox: false,
        hook: false,
        drop: true,
        roll: false,
        hard: true,
        soft: false,
        dark: false,
        euph: true,
        varTempo: false,
        subgenre: "Trance",
      }),
    ).toBe("E9 IN:32 OUT:16 Drop Hard Euph · Trance");
  });

  test("VAR token", () => {
    expect(
      buildCommentV4({
        energy: 5,
        introBars: 16,
        outroBars: 16,
        vox: false,
        hook: false,
        drop: false,
        roll: false,
        hard: false,
        soft: false,
        dark: false,
        euph: false,
        varTempo: true,
        subgenre: null,
      }),
    ).toBe("E5 IN:16 OUT:16 VAR");
  });

  test("radio edit: IN:0 OUT:0", () => {
    expect(
      buildCommentV4({
        energy: 7,
        introBars: 0,
        outroBars: 0,
        vox: true,
        hook: false,
        drop: true,
        roll: false,
        hard: false,
        soft: false,
        dark: false,
        euph: false,
        varTempo: false,
        subgenre: null,
      }),
    ).toBe("E7 IN:0 OUT:0 VOX Drop");
  });

  test("Soft Euph — gentle and euphoric", () => {
    expect(
      buildCommentV4({
        energy: 3,
        introBars: null,
        outroBars: null,
        vox: false,
        hook: false,
        drop: false,
        roll: false,
        hard: false,
        soft: true,
        dark: false,
        euph: true,
        varTempo: false,
        subgenre: "DeepHouse",
      }),
    ).toBe("E3 Soft Euph · DeepHouse");
  });

  test("worst case: every token fires", () => {
    const comment = buildCommentV4({
      energy: 9,
      introBars: 64,
      outroBars: 64,
      vox: true,
      hook: false,
      drop: true,
      roll: false,
      hard: true,
      soft: false,
      dark: true,
      euph: false,
      varTempo: true,
      subgenre: "PeakTechno",
    });
    expect(comment).toBe("E9 IN:64 OUT:64 VOX Drop Hard Dark VAR · PeakTechno");
    expect(comment.length).toBeLessThanOrEqual(52);
  });

  test("energy clamps to 1-9", () => {
    expect(
      buildCommentV4({
        energy: 10,
        introBars: null,
        outroBars: null,
        vox: false,
        hook: false,
        drop: false,
        roll: false,
        hard: false,
        soft: false,
        dark: false,
        euph: false,
        varTempo: false,
        subgenre: null,
      }),
    ).toBe("E9");
  });
});

// ---------- parseCommentV4 ----------

describe("parseCommentV4", () => {
  test("round-trip: full comment", () => {
    const parsed = parseCommentV4("E8 IN:32 OUT:16 VOX Drop Dark · MelTechno");
    expect(parsed.energy).toBe(8);
    expect(parsed.introBars).toBe(32);
    expect(parsed.outroBars).toBe(16);
    expect(parsed.vox).toBe(true);
    expect(parsed.hook).toBe(false);
    expect(parsed.drop).toBe(true);
    expect(parsed.roll).toBe(false);
    expect(parsed.hard).toBe(false);
    expect(parsed.soft).toBe(false);
    expect(parsed.dark).toBe(true);
    expect(parsed.euph).toBe(false);
    expect(parsed.varTempo).toBe(false);
    expect(parsed.subgenre).toBe("MelTechno");
  });

  test("energy only", () => {
    const parsed = parseCommentV4("E5");
    expect(parsed.energy).toBe(5);
    expect(parsed.introBars).toBeNull();
    expect(parsed.outroBars).toBeNull();
    expect(parsed.subgenre).toBeNull();
  });

  test("Hard and Euph together", () => {
    const parsed = parseCommentV4("E9 IN:32 OUT:16 Drop Hard Euph · Trance");
    expect(parsed.hard).toBe(true);
    expect(parsed.euph).toBe(true);
    expect(parsed.drop).toBe(true);
    expect(parsed.subgenre).toBe("Trance");
  });

  test("HOOK parses", () => {
    const parsed = parseCommentV4("E6 IN:32 OUT:32 HOOK Roll · DeepHouse");
    expect(parsed.hook).toBe(true);
    expect(parsed.vox).toBe(false);
    expect(parsed.roll).toBe(true);
  });

  test("VAR parses", () => {
    const parsed = parseCommentV4("E5 IN:16 OUT:16 VAR");
    expect(parsed.varTempo).toBe(true);
  });

  test("empty string", () => {
    const parsed = parseCommentV4("");
    expect(parsed.energy).toBeNull();
    expect(parsed.subgenre).toBeNull();
  });

  test("all five placements", () => {
    const parsed = parseCommentV4("E9 Hard Dark · PeakTechno");
    expect(parsed.hard).toBe(true);
    expect(parsed.dark).toBe(true);
    expect(parsed.subgenre).toBe("PeakTechno");
  });

  test("multi-genre subgenre with + separator", () => {
    const parsed = parseCommentV4(
      "E8 IN:32 OUT:16 Drop Dark · MelTechno+DeepHouse",
    );
    expect(parsed.energy).toBe(8);
    expect(parsed.drop).toBe(true);
    expect(parsed.dark).toBe(true);
    expect(parsed.subgenre).toBe("MelTechno+DeepHouse");
  });

  test("multi-genre round-trip: build then parse", () => {
    const comment = buildCommentV4({
      energy: 7,
      introBars: 16,
      outroBars: 8,
      vox: false,
      hook: false,
      drop: true,
      roll: false,
      hard: false,
      soft: true,
      dark: false,
      euph: false,
      varTempo: false,
      subgenre: "TechHouse+ProgHouse",
    });
    expect(comment).toBe("E7 IN:16 OUT:8 Drop Soft · TechHouse+ProgHouse");
    const parsed = parseCommentV4(comment);
    expect(parsed.subgenre).toBe("TechHouse+ProgHouse");
  });
});
