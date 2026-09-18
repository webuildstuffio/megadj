import { expect, test } from "bun:test";
import { canonicalizeClaim } from "../genre/genre-vocab";
import { validatePatchUntrusted } from "../schema-guards";

/** Shared validatePatch scenario cases (used by schema.test.ts and
 *  compat-fetch-lib.test.ts — the archive-ledger validateTagValues shim
 *  delegates to validatePatch, so both suites must prove the same
 *  behavior). Negative cases go through validatePatchUntrusted: the
 *  runtime validator genuinely receives unknown-typed values there,
 *  which is exactly what a bad batch is. */
export function runValidatePatchCases(): void {
  test("accepts valid values", () => {
    expect(() =>
      validatePatchUntrusted({
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
    expect(() => validatePatchUntrusted({ year: 1899 })).toThrow();
    expect(() => validatePatchUntrusted({ year: 2101 })).toThrow();
    expect(() => validatePatchUntrusted({ year: 20.5 })).toThrow();
    expect(() => validatePatchUntrusted({ year: NaN })).toThrow();
    expect(() => validatePatchUntrusted({ year: 1995 })).not.toThrow();
  });

  test("rejects empty required strings", () => {
    expect(() => validatePatchUntrusted({ title: "  " })).toThrow(/non-empty/);
    expect(() => validatePatchUntrusted({ artist: "" })).toThrow(/non-empty/);
  });

  test("rejects wrong types", () => {
    expect(() => validatePatchUntrusted({ title: 42 })).toThrow(
      /must be a string/,
    );
    expect(() => validatePatchUntrusted({ year: "2020" })).toThrow(
      /integer 1900–2100/,
    );
  });

  test("rejects overlong strings", () => {
    expect(() => validatePatchUntrusted({ title: "x".repeat(501) })).toThrow(
      /too long/,
    );
  });

  test("allows undefined fields", () => {
    expect(() => validatePatchUntrusted({})).not.toThrow();
  });
}

/** Shared canonicalizeClaim scenario cases (schema.test.ts owns the canon
 *  map coverage; compat-fetch-lib proves the same verb end-to-end). */
export function runCanonGenreCases(): void {
  test("maps known SC labels to canonical genres", () => {
    expect(canonicalizeClaim("Hip-Hop & Rap")).toBe("Hip-Hop");
    expect(canonicalizeClaim("hip-hop & rap")).toBe("Hip-Hop");
    expect(canonicalizeClaim("#house")).toBe("House");
    expect(canonicalizeClaim("Tech House")).toBe("Tech House");
    expect(canonicalizeClaim("r&b / soul")).toBe("R&B");
    expect(canonicalizeClaim("Drum & Bass")).toBe("Drum & Bass");
    expect(canonicalizeClaim("dance & edm")).toBe("EDM");
  });

  test("title-cases unknown labels", () => {
    expect(canonicalizeClaim("afro house")).toBe("Afro house");
    expect(canonicalizeClaim("Baltimore club")).toBe("Baltimore club");
  });

  test("strips hashtag prefix", () => {
    expect(canonicalizeClaim("#techno")).toBe("Techno");
  });
}
