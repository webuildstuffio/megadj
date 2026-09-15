/**
 * name-key.test.ts — pins the ONE NFC+casefold name key (issue #67).
 * Ten hand-rolled normalize sites meant one command's join matched a
 * file and another's missed it (variant-sprawl bug class). The seam now
 * lives in shared/name-key; these tests pin the Unicode traps it kills.
 */
import { describe, expect, test } from "bun:test";
import { nameKey, nfc } from "./name-key";

describe("nameKey (NFC + casefold)", () => {
  test("NFD and NFC forms of the same name collapse to one key", () => {
    // "Café" composed vs decomposed (the macOS NFD trap)
    const nfcForm = "Caf\u00e9 Del Mar";
    const nfdForm = "Cafe\u0301 Del Mar";
    expect(nfcForm).not.toEqual(nfdForm); // sanity: the trap is real
    expect(nameKey(nfcForm)).toBe(nameKey(nfdForm));
  });

  test("case variants collapse (exFAT is case-insensitive)", () => {
    expect(nameKey("TRACK - 01.MP3")).toBe(nameKey("track - 01.mp3"));
  });

  test("combined: NFD + odd case still one key", () => {
    expect(nameKey("Cafe\u0301 DEL MAR.MP3")).toBe(
      nameKey("caf\u00e9 del mar.mp3"),
    );
  });

  test("different names stay different", () => {
    expect(nameKey("track 1.mp3")).not.toBe(nameKey("track 2.mp3"));
  });

  test("nfc() alone is case-aware (for case-sensitive index keys)", () => {
    expect(nfc("Cafe\u0301")).toBe("Caf\u00e9");
    expect(nfc("ABC")).not.toBe(nfc("abc"));
  });
});
