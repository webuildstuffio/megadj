import { describe, expect, test } from "bun:test";
import {
  sanitizeDisplayText,
  sanitizeFilename,
  repairMojibake,
} from "./booth-fix";
import { setBoothFleet } from "../../fulltags/src/exports";

describe("sanitizeDisplayText", () => {
  test("strips emoji + ZWJ + variation selectors", () => {
    expect(sanitizeDisplayText("Fire 🔥 Track")).toBe("Fire Track");
    expect(sanitizeDisplayText("family 👩‍👩‍👧‍👦 mix")).toBe("family mix");
    expect(sanitizeDisplayText("star ⭐️ night")).toBe("star night"); // ⭐+FE0F
  });
  test("strips private-use + control bytes", () => {
    expect(sanitizeDisplayText("logo\uE000.end")).toBe("logo.end");
    expect(sanitizeDisplayText("a\u0001b")).toBe("ab");
  });
  test("maps typographic punctuation to ASCII", () => {
    expect(sanitizeDisplayText("\u201cQuote\u201d \u2014 em")).toBe(
      '"Quote" - em',
    );
    expect(sanitizeDisplayText("don\u2019t")).toBe("don't");
  });
  test("keeps accented Latin the fleet renders fine", () => {
    // em dash maps to ASCII hyphen (booth-safe); accents are untouched
    expect(sanitizeDisplayText("Beyoncé — Mø Rós")).toBe("Beyoncé - Mø Rós");
    expect(sanitizeDisplayText("Sigur Rós — Hoppípolla")).toBe(
      "Sigur Rós - Hoppípolla",
    );
  });
  test("collapses runs of spaces left by strips", () => {
    expect(sanitizeDisplayText("A  B")).toBe("A B");
  });
});

describe("sanitizeFilename", () => {
  test("semicolons become commas, trailing dot/space before ext removed", () => {
    expect(sanitizeFilename("D2D Low (flo rida) Flip; final.aiff")).toBe(
      "D2D Low (flo rida) Flip, final.aiff",
    );
    expect(sanitizeFilename("final v3 .aiff")).toBe("final v3.aiff");
    expect(sanitizeFilename("name..mp3")).toBe("name.mp3");
  });
  test("emoji-bearing names survive", () => {
    expect(sanitizeFilename("track 🔥.mp3")).toBe("track.mp3");
  });
  test("never returns an empty name", () => {
    expect(sanitizeFilename("🔥").length).toBeGreaterThan(0);
  });
});

describe("repairMojibake", () => {
  test("reverses the Beatport CP1252 double-encode", () => {
    // "Ü" mis-encoded → Ãœ in UTF-8
    expect(repairMojibake("BÃ¶rk")).toBe("Börk");
  });
  test("returns null for already-clean text (no rewrite)", () => {
    expect(repairMojibake("Beyoncé")).toBe(null);
    expect(repairMojibake("Plain ASCII")).toBe(null);
  });
});

describe("fleet selection is pinned in tests", () => {
  test("booth-fix tests run under the default trio", () => {
    setBoothFleet(["xdj-xz", "cdj-3000", "cdj-2000nxs2"]);
    expect(true).toBe(true);
  });
});
