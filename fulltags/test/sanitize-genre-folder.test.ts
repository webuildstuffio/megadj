import { describe, expect, test } from "bun:test";
import { sanitizeGenreFolder } from "../src/schema";

/** Sep 11 regression: unix timestamps baked into scraped genre tags were
 *  used as folder names — 278 tracks landed in 278 one-file numeric
 *  folders ("1492978368/"). Pure-digit genres now bucket into
 *  "Unknown Genre" until fetch fills a real one. */
describe("sanitizeGenreFolder — junk guards", () => {
  test("unix-timestamp genre → Unknown Genre", () => {
    expect(sanitizeGenreFolder("1492978368")).toBe("Unknown Genre");
    expect(sanitizeGenreFolder("1384355308")).toBe("Unknown Genre");
  });

  test("placeholder 'Music' → Unknown Genre", () => {
    expect(sanitizeGenreFolder("Music")).toBe("Unknown Genre");
    expect(sanitizeGenreFolder("music")).toBe("Unknown Genre");
  });

  test("real genres pass through", () => {
    expect(sanitizeGenreFolder("House")).toBe("House");
    expect(sanitizeGenreFolder("R&B / Soul")).toBe("R&B Soul");
    expect(sanitizeGenreFolder("Hip-Hop")).toBe("Hip-Hop");
  });

  test("all-digit strings (any length) guarded", () => {
    expect(sanitizeGenreFolder("12345")).toBe("Unknown Genre");
  });
});
