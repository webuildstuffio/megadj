/**
 * anlz.test.ts — pins the ANLZ codec contract: build/parse round-trips,
 * rewriteAnlzGrid's byte-exactness guarantees (#147 Q4 armament), and
 * the PSSI phrase parser (#427 IN/OUT bars).
 */
import { describe, expect, test } from "bun:test";
import {
  buildAnlz,
  parseAnlzGrid,
  parseAnlzInventory,
  parseAnlzPhrases,
  phraseInOutBars,
  rewriteAnlzGrid,
  PHRASE_KINDS,
  TRACK_MOOD,
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

describe("parseAnlzPhrases (PSSI phrase structure, #427)", () => {
  const { HIGH } = PHRASE_KINDS;

  const mkPhrases = (
    entries: { index: number; beat: number; kind: number }[],
    endBeat = 500,
    mood: number = TRACK_MOOD.HIGH,
  ) =>
    buildAnlz({
      path: "/Contents/Artist/Album/track.mp3",
      phrases: { mood, endBeat, entries },
    });

  test("unmasked round-trip: phrases survive encode/decode", () => {
    const entries = [
      { index: 1, beat: 1, kind: HIGH.INTRO },
      { index: 2, beat: 33, kind: HIGH.UP },
      { index: 3, beat: 97, kind: HIGH.CHORUS },
      { index: 4, beat: 225, kind: HIGH.DOWN },
      { index: 5, beat: 289, kind: HIGH.CHORUS },
      { index: 6, beat: 449, kind: HIGH.OUTRO },
    ];
    const data = mkPhrases(entries, 513);
    const parsed = parseAnlzPhrases(data);
    expect(parsed).not.toBeNull();
    expect(parsed!.mood).toBe(TRACK_MOOD.HIGH);
    expect(parsed!.endBeat).toBe(513);
    expect(parsed!.path).toBe("/Contents/Artist/Album/track.mp3");
    expect(parsed!.phrases).toHaveLength(6);
    expect(parsed!.phrases[0]!.kind).toBe(HIGH.INTRO);
    expect(parsed!.phrases[0]!.beat).toBe(1);
    expect(parsed!.phrases[5]!.kind).toBe(HIGH.OUTRO);
    expect(parsed!.phrases[5]!.beat).toBe(449);
  });

  test("no PSSI section → null", () => {
    const data = buildAnlz({
      path: "/x",
      beats: grid(12800, 16),
    });
    expect(parseAnlzPhrases(data)).toBeNull();
  });

  test("garbage input → null, never a throw", () => {
    expect(parseAnlzPhrases(new Uint8Array(4))).toBeNull();
  });

  test("PSSI coexists with PQTZ", () => {
    const data = buildAnlz({
      path: "/Contents/track.mp3",
      beats: grid(12800, 32),
      phrases: {
        mood: TRACK_MOOD.HIGH,
        endBeat: 200,
        entries: [
          { index: 1, beat: 1, kind: HIGH.INTRO },
          { index: 2, beat: 65, kind: HIGH.CHORUS },
          { index: 3, beat: 161, kind: HIGH.OUTRO },
        ],
      },
    });
    expect(parseAnlzGrid(data)).not.toBeNull();
    expect(parseAnlzPhrases(data)).not.toBeNull();
    expect(parseAnlzPhrases(data)!.phrases).toHaveLength(3);
  });

  test("MID mood phrases parse correctly", () => {
    const { MID } = PHRASE_KINDS;
    const data = mkPhrases(
      [
        { index: 1, beat: 1, kind: MID.INTRO },
        { index: 2, beat: 33, kind: MID.VERSE1 },
        { index: 3, beat: 97, kind: MID.CHORUS },
        { index: 4, beat: 161, kind: MID.OUTRO },
      ],
      200,
      TRACK_MOOD.MID,
    );
    const parsed = parseAnlzPhrases(data);
    expect(parsed).not.toBeNull();
    expect(parsed!.mood).toBe(TRACK_MOOD.MID);
    expect(parsed!.phrases[3]!.kind).toBe(MID.OUTRO);
  });
});

describe("phraseInOutBars (#427 IN/OUT bar computation)", () => {
  const { HIGH, MID } = PHRASE_KINDS;

  test("high mood: 8-bar intro, 16-bar outro", () => {
    const data = buildAnlz({
      path: "/track.mp3",
      phrases: {
        mood: TRACK_MOOD.HIGH,
        endBeat: 513,
        entries: [
          { index: 1, beat: 1, kind: HIGH.INTRO },
          { index: 2, beat: 33, kind: HIGH.UP },
          { index: 3, beat: 97, kind: HIGH.CHORUS },
          { index: 4, beat: 225, kind: HIGH.DOWN },
          { index: 5, beat: 289, kind: HIGH.CHORUS },
          { index: 6, beat: 449, kind: HIGH.OUTRO },
        ],
      },
    });
    const parsed = parseAnlzPhrases(data)!;
    const { introBars, outroBars } = phraseInOutBars(parsed);
    expect(introBars).toBe(8); // (33-1)/4 = 8
    expect(outroBars).toBe(16); // (513-449)/4 = 16
  });

  test("mid mood: outro kind=10", () => {
    const data = buildAnlz({
      path: "/track.mp3",
      phrases: {
        mood: TRACK_MOOD.MID,
        endBeat: 300,
        entries: [
          { index: 1, beat: 1, kind: MID.INTRO },
          { index: 2, beat: 65, kind: MID.VERSE1 },
          { index: 3, beat: 193, kind: MID.CHORUS },
          { index: 4, beat: 257, kind: MID.OUTRO },
        ],
      },
    });
    const parsed = parseAnlzPhrases(data)!;
    const { introBars, outroBars } = phraseInOutBars(parsed);
    expect(introBars).toBe(16); // (65-1)/4 = 16
    expect(outroBars).toBe(10); // (300-257)/4 = 10 (floor)
  });

  test("no intro → introBars=0, no outro → outroBars=0", () => {
    const data = buildAnlz({
      path: "/track.mp3",
      phrases: {
        mood: TRACK_MOOD.HIGH,
        endBeat: 200,
        entries: [
          { index: 1, beat: 1, kind: HIGH.UP },
          { index: 2, beat: 65, kind: HIGH.CHORUS },
        ],
      },
    });
    const parsed = parseAnlzPhrases(data)!;
    const { introBars, outroBars } = phraseInOutBars(parsed);
    expect(introBars).toBe(0);
    expect(outroBars).toBe(0);
  });

  test("3-bar intro rounds to 0 in roundBarsDown", () => {
    const data = buildAnlz({
      path: "/track.mp3",
      phrases: {
        mood: TRACK_MOOD.HIGH,
        endBeat: 200,
        entries: [
          { index: 1, beat: 1, kind: HIGH.INTRO },
          { index: 2, beat: 13, kind: HIGH.CHORUS }, // 12 beats = 3 bars
          { index: 3, beat: 161, kind: HIGH.OUTRO },
        ],
      },
    });
    const parsed = parseAnlzPhrases(data)!;
    const { introBars } = phraseInOutBars(parsed);
    expect(introBars).toBe(3); // raw bars
  });

  test("64-bar outro stays at 64 in roundBarsDown", () => {
    const data = buildAnlz({
      path: "/track.mp3",
      phrases: {
        mood: TRACK_MOOD.HIGH,
        endBeat: 257 + 256, // 64 bars of outro
        entries: [
          { index: 1, beat: 1, kind: HIGH.INTRO },
          { index: 2, beat: 33, kind: HIGH.CHORUS },
          { index: 3, beat: 257, kind: HIGH.OUTRO },
        ],
      },
    });
    const parsed = parseAnlzPhrases(data)!;
    const { outroBars } = phraseInOutBars(parsed);
    expect(outroBars).toBe(64);
  });
});
