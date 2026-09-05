import { describe, expect, test } from "bun:test";
import {
  canonGenre,
  completeness,
  inferGenre,
  sanitizeGenreFolder,
  SC_GENRE_CANON,
} from "../src/schema";
import { validatePatch } from "../src/schema-guards";

describe("schema: genre canon", () => {
  test("maps known SC labels to canonical genres", () => {
    expect(canonGenre("Hip-Hop & Rap")).toBe("Hip-Hop");
    expect(canonGenre("hip-hop & rap")).toBe("Hip-Hop");
    expect(canonGenre("#house")).toBe("House");
    expect(canonGenre("Tech House")).toBe("Tech House");
    expect(canonGenre("r&b / soul")).toBe("R&B");
    expect(canonGenre("Drum & Bass")).toBe("Drum & Bass");
    expect(canonGenre("dance & edm")).toBe("EDM");
  });

  test("title-cases unknown labels", () => {
    expect(canonGenre("afro house")).toBe("Afro house");
    expect(canonGenre("Baltimore club")).toBe("Baltimore club");
  });

  test("strips hashtag prefix", () => {
    expect(canonGenre("#techno")).toBe("Techno");
  });

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
  test("complete when all fields present", () => {
    const r = completeness({
      art: true,
      title: "T",
      artist: "A",
      album: "Al",
      genre: "House",
      year: "2024",
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

  test("rejects out-of-range years", () => {
    expect(() => validatePatch({ year: 1899 })).toThrow();
    expect(() => validatePatch({ year: 2101 })).toThrow();
    expect(() => validatePatch({ year: 20.5 as unknown as number })).toThrow();
    expect(() => validatePatch({ year: NaN })).toThrow();
    expect(() => validatePatch({ year: 1995 })).not.toThrow();
  });

  test("rejects out-of-range bpm/energy", () => {
    expect(() => validatePatch({ bpm: 0 })).toThrow(/bpm/);
    expect(() => validatePatch({ bpm: 500 })).toThrow(/bpm/);
    expect(() => validatePatch({ energy: 0 })).toThrow(/energy/);
    expect(() => validatePatch({ energy: 11 })).toThrow(/energy/);
  });

  test("rejects empty required strings", () => {
    expect(() => validatePatch({ title: "  " })).toThrow(/non-empty/);
    expect(() => validatePatch({ artist: "" })).toThrow(/non-empty/);
  });

  test("rejects wrong types", () => {
    expect(() => validatePatch({ title: 42 as unknown as string })).toThrow(
      /must be a string/,
    );
    expect(() => validatePatch({ year: "2020" as unknown as number })).toThrow(
      /integer 1900–2100/,
    );
  });

  test("rejects overlong strings", () => {
    expect(() => validatePatch({ title: "x".repeat(501) })).toThrow(/too long/);
  });

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
