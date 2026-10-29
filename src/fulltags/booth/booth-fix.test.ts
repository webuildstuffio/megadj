import { describe, expect, test } from "bun:test";
import { sanitizeDisplayText, sanitizeFilename, repairMojibake } from "./booth-fix";

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
    expect(sanitizeDisplayText("\u201cQuote\u201d \u2014 em")).toBe('"Quote" - em');
    expect(sanitizeDisplayText("don\u2019t")).toBe("don't");
  });
  test("keeps accented Latin the fleet renders fine", () => {
    // em dash maps to ASCII hyphen (booth-safe); accents are untouched
    expect(sanitizeDisplayText("Beyoncé — Mø Rós")).toBe("Beyoncé - Mø Rós");
    expect(sanitizeDisplayText("Sigur Rós — Hoppípolla")).toBe("Sigur Rós - Hoppípolla");
  });
  test("collapses runs of spaces left by strips", () => {
    expect(sanitizeDisplayText("A  B")).toBe("A B");
  });
  test("strips enclosed alphanumerics — sanitizer is a fixed point of the audit gate (Sep 19: Ⓜ survived sanitize but tripped NON_FLEET_TEXT, so booth-fix found 0 fixable while audit kept flagging)", () => {
    expect(sanitizeDisplayText("ⓂiSS Ⓜoni 7.8")).toBe("iSS oni 7.8");
    expect(sanitizeDisplayText("①②③ mix")).toBe("mix");
  });
  test("transliterates fullwidth ASCII forms (yt-dlp substitutes)", () => {
    expect(sanitizeDisplayText("Track ｜ Name")).toBe("Track | Name");
    expect(sanitizeDisplayText("Song ＂Title＂")).toBe('Song "Title"');
    expect(sanitizeDisplayText("Time ： Now")).toBe("Time : Now");
    expect(sanitizeDisplayText("A⧸B")).toBe("A/B");
    expect(sanitizeDisplayText("ａｌｌ")).toBe("all");
  });
  test("transliterates CJK brackets and fullwidth space", () => {
    expect(sanitizeDisplayText("「AMV」")).toBe("[AMV]");
    expect(sanitizeDisplayText("【REMIX】")).toBe("[REMIX]");
    expect(sanitizeDisplayText("A　B")).toBe("A B");
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
  test("fullwidth yt-dlp substitutes → safe ASCII", () => {
    expect(sanitizeFilename("Post Malone - ＂Wow.＂ (Official).m4a")).toBe(
      "Post Malone - Wow. (Official).m4a",
    );
    expect(sanitizeFilename("Touch It (Remix) ⧸ AMG ｜ TikTok.m4a")).toBe(
      "Touch It (Remix) - AMG - TikTok.m4a",
    );
    expect(sanitizeFilename("Wistoria： Wand S2 ｜ THRONE？.m4a")).toBe(
      "Wistoria Wand S2 - THRONE.m4a",
    );
  });
  test("CJK brackets in filenames → ASCII brackets", () => {
    expect(sanitizeFilename("「AMV」Burn The Moment.m4a")).toBe("[AMV]Burn The Moment.m4a");
    expect(sanitizeFilename("【REMIX】Track.m4a")).toBe("[REMIX]Track.m4a");
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
