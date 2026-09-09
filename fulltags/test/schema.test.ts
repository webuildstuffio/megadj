import { describe, expect, test } from "bun:test";
import {
  completeness,
  inferGenre,
  sanitizeGenreFolder,
  SC_GENRE_CANON,
} from "../src/schema";
import { validatePatch } from "../src/schema-guards";
import {
  runCanonGenreCases,
  runValidatePatchCases,
} from "./helpers/patchCases";

describe("schema: genre canon", () => {
  runCanonGenreCases();

  test("canon map covers the SC labels", () => {
    expect(SC_GENRE_CANON["hip-hop & rap"]).toBe("Hip-Hop");
  });
});

describe("schema: inferGenre + sanitize", () => {
  test("word-boundary match ignores substrings", () => {
    expect(
      inferGenre(["Karma Fields - You and Me (Soulji Remix) [House]"]),
    ).toBe("House");
    expect(inferGenre(["Chill Sunset Vibes"])).toBe("Chill / Lo-Fi");
    expect(inferGenre(["something random"])).toBeNull();
  });

  test("sanitizeGenreFolder is filesystem-safe", () => {
    expect(sanitizeGenreFolder("R&B / Soul")).toBe("R&B Soul");
    expect(sanitizeGenreFolder("Hip-Hop:")).toBe("Hip-Hop");
  });
});

describe("schema: completeness", () => {
  test("flags every missing required field", () => {
    const r = completeness({ art: true, title: "T" });
    expect(r.complete).toBe(false);
    expect(r.missing).toContain("artist");
    expect(r.missing).toContain("genre");
    expect(r.missing).toContain("year");
  });
  test("mood + energy are required fields (rev 6.1: analysis stages feed the gate)", () => {
    const full = {
      art: true,
      title: "T",
      artist: "A",
      album: "Al",
      genre: "House",
      year: "2024",
    };
    expect(completeness(full).missing).toEqual(["mood", "energy"]);
    expect(
      completeness({ ...full, mood: "dance=0.5", energy: 7 }).complete,
    ).toBe(true);
  });
  test("complete when all fields present", () => {
    const r = completeness({
      art: true,
      title: "T",
      artist: "A",
      album: "Al",
      genre: "House",
      year: "2024",
      mood: "dance=0.5; party=0.6; valence=4.0; arousal=5.0",
      energy: 7,
    });
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
  });
});

describe("schema-guards: validatePatch", () => {
  test("accepts valid values", () => {
    expect(() =>
      validatePatch({
        title: "T",
        artist: "A",
        album: "Al",
        genre: "House",
        year: 2026,
        comment: "hi",
        bpm: 128,
        energy: 7.5,
      }),
    ).not.toThrow();
  });

  test("rejects out-of-range bpm/energy", () => {
    expect(() => validatePatch({ bpm: 0 })).toThrow(/bpm/);
    expect(() => validatePatch({ bpm: 500 })).toThrow(/bpm/);
    expect(() => validatePatch({ energy: 0 })).toThrow(/energy/);
    expect(() => validatePatch({ energy: 11 })).toThrow(/energy/);
  });

  runValidatePatchCases();

  test("AI provenance stamps must be value|confidence", () => {
    expect(() => validatePatch({ aiGenre: "Techno|0.92" })).not.toThrow();
    expect(() => validatePatch({ aiYear: "2019|0.7" })).not.toThrow();
    expect(() => validatePatch({ aiGenre: "Techno" })).toThrow(
      /value\|confidence/,
    );
    expect(() => validatePatch({ aiYear: "2019|" })).toThrow(
      /value\|confidence/,
    );
    expect(() => validatePatch({ aiGenre: "" })).toThrow(/non-empty/);
  });

  test("allows undefined fields", () => {
    expect(() => validatePatch({})).not.toThrow();
  });
});
