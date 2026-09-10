/**
 * booth-text tests — the Pioneer display-compatibility gate. Every case
 * here is a real booth failure class from the Sep 10 research pass
 * (manuals + field reports), pinned so the checker can't regress.
 */
import { describe, expect, test } from "bun:test";
import { boothTextCompat, isMojibake } from "../src/booth-text";

const safe = (over: Record<string, string> = {}) => ({
  filename: "Artist - Title.mp3",
  title: "Title",
  artist: "Artist",
  album: "Album",
  genre: "Techno",
  ...over,
});

describe("boothTextCompat — clean text passes", () => {
  test("plain latin text is ok", () => {
    const r = boothTextCompat(safe());
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  test("latin-1 accented text is ok (Beyoncé, Mø, Sigur Rós)", () => {
    const r = boothTextCompat(
      safe({ artist: "Beyoncé", title: "Mønergy — Rós" }),
    );
    expect(r.ok).toBe(true);
  });
});

describe("boothTextCompat — emoji / non-fleet scripts", () => {
  test("emoji in title flags non-fleet-characters", () => {
    const r = boothTextCompat(safe({ title: "Fire 🔥 Remix" }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("non-fleet-characters");
    expect(r.offenders.title).toBe("🔥");
  });

  test("CJK characters flag (CDJ-2000 language-table class)", () => {
    const r = boothTextCompat(safe({ artist: "福島節子" }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("non-fleet-characters");
  });

  test("Cyrillic flags", () => {
    const r = boothTextCompat(safe({ artist: "Виктор Верстаков" }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("non-fleet-characters");
  });

  test("ZWJ family emoji (👍🏽) flags via ZWJ/skin-tone members", () => {
    const r = boothTextCompat(safe({ title: "thumbs 👍🏽 up" }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("non-fleet-characters");
  });

  test("variation selector U+FE0F alone flags", () => {
    const r = boothTextCompat(safe({ title: "sun ☀\uFE0F" }));
    expect(r.ok).toBe(false);
  });
});

describe("boothTextCompat — mojibake", () => {
  test("Beatport double-encode flags (Ü → Ãœ)", () => {
    const r = boothTextCompat(safe({ title: "Ãœber Gectro" }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("mojibake");
  });

  test("CP1251-declared-Latin-1 Cyrillic debris flags", () => {
    const r = boothTextCompat(safe({ artist: "Ïîõîä" }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("mojibake");
  });

  test("isMojibake: real accented text does NOT flag", () => {
    expect(isMojibake("Beyoncé")).toBe(false);
    expect(isMojibake("Mø")).toBe(false);
    expect(isMojibake("Rós")).toBe(false);
  });

  test("isMojibake: pure ASCII never flags", () => {
    expect(isMojibake("Attack Attack")).toBe(false);
  });
});

describe("boothTextCompat — path shape", () => {
  test("semicolon in filename flags path-illegal-character", () => {
    const r = boothTextCompat(
      safe({ filename: "Awell; Ingrosso - Remix.mp3" }),
    );
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("path-illegal-character");
    expect(r.offenders.filename).toBe(";");
  });

  test("control byte in filename flags", () => {
    const r = boothTextCompat(safe({ filename: "track\u0007name.mp3" }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("path-illegal-character");
  });

  test("relPath over 255 UTF-8 bytes flags path-too-long", () => {
    const deep = `${"n".repeat(252)}.mp3`; // 256 bytes
    const r = boothTextCompat(safe({ filename: deep }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("path-too-long");
  });

  test("relPath 8+ folders deep flags path-too-deep (XDJ-XZ limit)", () => {
    const r = boothTextCompat(safe({ filename: "t.mp3" }));
    const deep = boothTextCompat({
      ...safe(),
      relPath: "a/b/c/d/e/f/g/h/t.mp3",
    });
    expect(r.ok).toBe(true); // 0 folders fine
    expect(deep.ok).toBe(false);
    expect(deep.reasons).toContain("path-too-deep");
  });
});

describe("boothTextCompat — reasons dedupe", () => {
  test("two emoji fields produce one deduped reason", () => {
    const r = boothTextCompat(safe({ title: "a 🎉", artist: "b 🎉" }));
    expect(r.reasons).toEqual(["non-fleet-characters"]);
  });
});
