/**
 * itunes.test.ts — Tests for iTunes genre mapping (B4.4).
 * Network tests are skipped (no live API calls in CI).
 */
import { describe, expect, test } from "bun:test";
import { itunesGenreToFamily } from "./itunes";

describe("itunesGenreToFamily", () => {
  test("maps Dance → house", () => {
    expect(itunesGenreToFamily("Dance")).toBe("house");
  });

  test("maps Electronic → house", () => {
    expect(itunesGenreToFamily("Electronic")).toBe("house");
  });

  test("maps Hip-Hop/Rap → hip hop", () => {
    expect(itunesGenreToFamily("Hip-Hop/Rap")).toBe("hip hop");
  });

  test("maps R&B/Soul → r&b", () => {
    expect(itunesGenreToFamily("R&B/Soul")).toBe("r&b");
  });

  test("maps Pop → pop", () => {
    expect(itunesGenreToFamily("Pop")).toBe("pop");
  });

  test("maps Techno → techno", () => {
    expect(itunesGenreToFamily("Techno")).toBe("techno");
  });

  test("maps Trance → trance", () => {
    expect(itunesGenreToFamily("Trance")).toBe("trance");
  });

  test("maps Drum & Bass → drum and bass", () => {
    expect(itunesGenreToFamily("Drum & Bass")).toBe("drum and bass");
  });

  test("falls back to taxonomy mapToFamily", () => {
    // "deep house" not in ITUNES_GENRE_MAP but is in taxonomy
    expect(itunesGenreToFamily("deep house")).toBe("house");
  });

  test("unknown genre → null", () => {
    expect(itunesGenreToFamily("Spoken Word")).toBeNull();
  });

  test("case insensitive", () => {
    expect(itunesGenreToFamily("DANCE")).toBe("house");
    expect(itunesGenreToFamily("hip-hop/rap")).toBe("hip hop");
  });
});
