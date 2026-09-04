import { describe, expect, test } from "bun:test";
import { buildPrompt } from "./artwork";

describe("buildPrompt", () => {
  const base: Parameters<typeof buildPrompt>[0] = {
    path: "/music/x.mp3",
    title: "Savin Me",
    artist: "Flozone",
    album: null,
    reason: "no-source-found",
  };

  test("includes artist, title, and no-text instruction", () => {
    const p = buildPrompt({ ...base });
    expect(p).toContain("Flozone");
    expect(p).toContain('"Savin Me"');
    expect(p).toContain("no text");
    expect(p).toContain("Square album cover art");
  });

  test("mentions remix origin when present", () => {
    const p = buildPrompt({ ...base, remixOf: "Nickelback - Savin Me" });
    expect(p).toContain("remix of Nickelback - Savin Me");
  });

  test("style hint comes from a real album, not a bootleg bucket", () => {
    const p1 = buildPrompt({ ...base, album: "House Music Classics" });
    expect(p1).toContain("style: House Music Classics");
    const p2 = buildPrompt({ ...base, album: "Flozone — Bootlegs & Edits" });
    expect(p2).not.toContain("style:");
  });
});
