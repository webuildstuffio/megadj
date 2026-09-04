import { describe, expect, test } from "bun:test";
import { parseFilename, normalize, qualityScore, detectRemix } from "./ingest";

describe("parseFilename", () => {
  test("NNN - Artist - Title prefix", () => {
    const r = parseFilename("042 - Fred again.. - Turn On The Lights.m4a");
    expect(r.trackNo).toBe(42);
    expect(r.artist).toBe("Fred again..");
    expect(r.title).toBe("Turn On The Lights");
  });

  test("Artist - Title without number", () => {
    const r = parseFilename("Tita Lau - Live @ Brazil Mix.m4a");
    expect(r.trackNo).toBeNull();
    expect(r.artist).toBe("Tita Lau");
    expect(r.title).toBe("Live @ Brazil Mix");
  });

  test("bare title falls back with null artist", () => {
    const r = parseFilename("good morning house mix.mp3");
    expect(r.trackNo).toBeNull();
    expect(r.artist).toBeNull();
    expect(r.title).toBe("good morning house mix");
  });

  test("dashes inside title are preserved", () => {
    const r = parseFilename(
      "MKLA - Progressive House / Tech House - Dance Mix.m4a",
    );
    expect(r.artist).toBe("MKLA");
    expect(r.title).toBe("Progressive House / Tech House - Dance Mix");
  });
});

describe("normalize", () => {
  test("strips Safari (1) dupes, brackets, and version noise", () => {
    expect(normalize("Anyway (Extended Mix) (1)")).toBe("anyway extended mix");
    expect(normalize("pop dat thang (kvolx flip) final v3 (1) (1)")).toBe(
      "pop dat thang kvolx flip",
    );
    expect(normalize("RL GRIME - UCLA (SPOONE FLIP)FINAL")).toBe(
      "rl grime ucla spoone flip",
    );
  });

  test("identity matching collapses dupes across names", () => {
    expect(normalize("Nari & Milani - Atom (Immersed remix )_FINAL")).toBe(
      normalize("Nari & Milani Atom Immersed remix"),
    );
  });
});

describe("qualityScore", () => {
  test("lossless dominates bitrate", () => {
    const lossless = qualityScore({
      ok: true,
      durationS: 300,
      bitrateKbps: 2304,
      sampleRate: 44100,
      codec: "pcm_s16le",
      hasArt: false,
      tags: {},
    });
    const highMp3 = qualityScore({
      ok: true,
      durationS: 300,
      bitrateKbps: 320,
      sampleRate: 44100,
      codec: "mp3",
      hasArt: false,
      tags: {},
    });
    expect(lossless).toBeGreaterThan(highMp3);
  });

  test("higher bitrate wins within same codec", () => {
    const a = qualityScore({
      ok: true,
      durationS: 300,
      bitrateKbps: 320,
      sampleRate: 44100,
      codec: "mp3",
      hasArt: false,
      tags: {},
    });
    const b = qualityScore({
      ok: true,
      durationS: 300,
      bitrateKbps: 128,
      sampleRate: 44100,
      codec: "mp3",
      hasArt: false,
      tags: {},
    });
    expect(a).toBeGreaterThan(b);
  });
});

describe("detectRemix", () => {
  test("parses classic Artist - Track (Remixer Remix)", () => {
    const r = detectRemix("NICKELBACK - SAVIN ME (FLOZONE FLIP)");
    expect(r).not.toBeNull();
    expect(r!.originalArtist).toBe("NICKELBACK");
    expect(r!.track).toBe("SAVIN ME");
    expect(r!.remixer).toBe("FLOZONE");
    expect(r!.remixName).toBe("FLOZONE FLIP");
  });
  test("multi-remixer credit takes the last name", () => {
    const r = detectRemix(
      "Caesars Palace - Jerk It Out (Kelland x BROSA x Juush Ext Remix)",
    );
    expect(r!.originalArtist).toBe("Caesars Palace");
    expect(r!.remixer).toBe("Juush Ext");
  });

  test("returns null for non-remix titles", () => {
    // "Extended Mix" is a version type, not a remix credit with an
    // original artist — correctly not detected.
    expect(detectRemix("In My Mind (Extended Mix)")).toBeNull();
    expect(detectRemix("Hynotize")).toBeNull();
    expect(detectRemix("Tiga - Mind Dimension")).toBeNull();
  });

  test("bootleg keyword detection", () => {
    expect(
      detectRemix("Daft Punk - Around The World (WESTEND BOOTLEG)"),
    ).not.toBeNull();
  });
});
