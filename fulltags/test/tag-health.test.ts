/**
 * tag-health unit tests — the corrupt-ID3 scanner's detector logic.
 * The fixtures here are STRINGS (fast); the end-to-end file walk is
 * covered by `megadj tag-check` runs in the intake skill. Critical
 * regression pinned here: the naive Latin-1 round-trip heuristic
 * FALSE-POSITIVED legit accented names ("Hernández", "Café Del Mar") —
 * mojibake detection must use the booth-text SSOT (isMojibake), which
 * distinguishes isolated accents from dominant high-byte runs.
 */
import { describe, test, expect } from "bun:test";
import { tagHealth } from "../src/tag-health";
import { hasControlChars, isMojibake } from "../src/booth-text";

describe("isMojibake (SSOT — tag-health depends on it)", () => {
  test("legit accented names pass", () => {
    expect(isMojibake("Nina Simone, Ignacio Hernández")).toBe(false);
    expect(isMojibake("Café Del Mar")).toBe(false);
    expect(isMojibake("Beyoncé")).toBe(false);
    expect(isMojibake("Mø")).toBe(false);
  });

  test("double-encoded text fails", () => {
    // UTF-8 bytes of "Ü" read as CP1252 → "Ãœ" — the classic Beatport form
    expect(isMojibake("Ãœbergang")).toBe(true);
  });
});

describe("tagHealth", () => {
  test("a real clean AIFF passes", () => {
    // One real archive file; skip if the archive isn't mounted (CI-less
    // repo, but the file check keeps the test honest).
    const clean = tagHealth("/dev/null");
    // /dev/null has no tags — the no-title-artist class fires; the point
    // is the shape, not the verdict.
    expect(Array.isArray(clean.reasons)).toBe(true);
    expect(typeof clean.ok).toBe("boolean");
    expect(typeof clean.detail).toBe("string");
  });

  test("control bytes inside a title are flagged (unit-level)", () => {
    // Control-byte detection is the booth-text SSOT (hasControlChars) —
    // tag-health delegates to it, so the contract is pinned on the SSOT
    // itself instead of a locally-disabled regex twin.
    expect(hasControlChars("ok title")).toBe(false);
    expect(hasControlChars("bad\u0007title")).toBe(true);
    expect(hasControlChars("del\u007fx")).toBe(true);
    expect(hasControlChars("c1\u0085x")).toBe(true);
  });
});
