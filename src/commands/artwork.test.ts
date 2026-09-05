import { describe, expect, test } from "bun:test";
import { buildPrompt, parseQueue } from "./artwork";

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

describe("parseQueue (corrupt-line resilience)", () => {
  const good = JSON.stringify({
    path: "/music/x.mp3",
    title: "X",
    reason: "no-source-found",
  });

  test("one corrupt line no longer voids the whole queue", () => {
    // Regression: the old map(JSON.parse) threw on the FIRST bad line, the
    // catch reported "queue is empty", and the command exited 0 having done
    // nothing — one partial write bricked every queued entry forever.
    const { entries, badLines } = parseQueue(
      [good, "{corrupt", good.replace("X", "Y")].join("\n"),
    );
    expect(badLines).toBe(1);
    expect(entries.length).toBe(2);
    expect(entries[0]?.title).toBe("X");
    expect(entries[1]?.title).toBe("Y");
  });

  test("all-good content parses with zero bad lines; blank lines ignored", () => {
    const { entries, badLines } = parseQueue(`${good}\n\n  \n`);
    expect(badLines).toBe(0);
    expect(entries.length).toBe(1);
  });
});
