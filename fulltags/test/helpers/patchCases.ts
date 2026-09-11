import { expect, test } from "bun:test";
import { canonGenre, validatePatch } from "../../src/exports";

/** Shared validatePatch scenario cases (used by schema.test.ts and
 *  compat-fetch-lib.test.ts — the compat shim delegates to validatePatch,
 *  so both suites must prove the same behavior). */
export function runValidatePatchCases(): void {
  test("accepts valid values", () => {
    expect(() =>
      validatePatch({
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
    expect(() => validatePatch({ year: 1899 })).toThrow();
    expect(() => validatePatch({ year: 2101 })).toThrow();
    expect(() => validatePatch({ year: 20.5 as unknown as number })).toThrow();
    expect(() => validatePatch({ year: NaN })).toThrow();
    expect(() => validatePatch({ year: 1995 })).not.toThrow();
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

  test("allows undefined fields", () => {
    expect(() => validatePatch({})).not.toThrow();
  });
}

/** Shared canonGenre scenario cases (schema.test.ts owns the canon map
 *  coverage; compat-fetch-lib proves the shim delegates to the same impl). */
export function runCanonGenreCases(): void {
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
}
