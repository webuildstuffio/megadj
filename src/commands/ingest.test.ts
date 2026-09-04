import { describe, expect, test } from "bun:test";
import { parseFilename } from "./ingest";

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
