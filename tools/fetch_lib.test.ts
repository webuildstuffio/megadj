import { describe, expect, test } from "bun:test";
import { canonGenre, validateTagValues } from "./fetch_lib";

describe("canonGenre", () => {
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
});

describe("validateTagValues", () => {
  test("accepts valid values", () => {
    expect(() =>
      validateTagValues({
        title: "T",
        artist: "A",
        album: "Al",
        genre: "House",
        year: 2026,
        comment: "hi",
      }),
    ).not.toThrow();
  });

  test("rejects out-of-range years", () => {
    expect(() => validateTagValues({ year: 1899 })).toThrow();
    expect(() => validateTagValues({ year: 2101 })).toThrow();
    expect(() =>
      validateTagValues({ year: 20.5 as unknown as number }),
    ).toThrow();
    expect(() => validateTagValues({ year: NaN })).toThrow();
    expect(() => validateTagValues({ year: 1995 })).not.toThrow();
  });

  test("rejects empty required strings", () => {
    expect(() => validateTagValues({ title: "  " })).toThrow(/non-empty/);
    expect(() => validateTagValues({ artist: "" })).toThrow(/non-empty/);
  });

  test("rejects wrong types", () => {
    expect(() => validateTagValues({ title: 42 as unknown as string })).toThrow(
      /must be a string/,
    );
    expect(() =>
      validateTagValues({ year: "2020" as unknown as number }),
    ).toThrow(/integer 1900–2100/);
  });

  test("rejects overlong strings", () => {
    expect(() => validateTagValues({ title: "x".repeat(501) })).toThrow(
      /too long/,
    );
  });

  test("allows undefined fields", () => {
    expect(() => validateTagValues({})).not.toThrow();
  });
});
