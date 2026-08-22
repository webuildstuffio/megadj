import { describe, expect, test } from "bun:test";
import {
  buildMetadata,
  cleanTitle,
  extractComposer,
  inferGenre,
} from "./metadata";

describe("cleanTitle", () => {
  test("strips official-audio noise", () => {
    expect(cleanTitle("Let Her Go (Official Audio)")).toBe("Let Her Go");
    expect(cleanTitle("P2 [Official Lyric Video]")).toBe("P2");
    expect(cleanTitle("Fade Away (Official Video)")).toBe("Fade Away");
  });

  test("normalizes smart quotes and whitespace", () => {
    expect(cleanTitle("Rich “And” Blind")).toBe('Rich "And" Blind');
    expect(cleanTitle("too   many    spaces")).toBe("too many spaces");
  });

  test("keeps feat. formatting normalized", () => {
    expect(cleanTitle("Go Dumb (feat. blackbear)")).toBe("Go Dumb (ft. blackbear)");
  });

  test("handles null", () => {
    expect(cleanTitle(null)).toBeNull();
    expect(cleanTitle(undefined)).toBeNull();
  });
});

describe("inferGenre", () => {
  test("detects hip-hop", () => {
    expect(inferGenre(["Juice WRLD - rap track"])).toBe("Hip-Hop");
  });
  test("detects house", () => {
    expect(inferGenre(["Deep House Mix 2023"])).toBe("House");
  });
  test("detects workout", () => {
    expect(inferGenre(["Best Workout Music 2026 Playlist"])).toBe("Workout");
  });
  test("returns null on no match", () => {
    expect(inferGenre(["something random"])).toBeNull();
  });
});

describe("extractComposer", () => {
  test("pulls producer credits", () => {
    const desc = "Producer: Heavy Keyzz\nProducer: SEVEN\nWriter: someone";
    expect(extractComposer(desc)).toBe("Heavy Keyzz, SEVEN");
  });
  test("handles 'Produced by' variant", () => {
    expect(extractComposer("Produced by John Cunningham")).toBe("John Cunningham");
  });
  test("dedupes and caps at 3", () => {
    const desc = "Producer: A\nProducer: A\nProducer: B\nProducer: C\nProducer: D";
    expect(extractComposer(desc)).toBe("A, B, C");
  });
  test("null when no credits", () => {
    expect(extractComposer("no credits here")).toBeNull();
    expect(extractComposer(null)).toBeNull();
  });
});

describe("buildMetadata", () => {
  test("assembles full metadata from ytdlp info", () => {
    const meta = buildMetadata({
      title: "Fade Away (Official Audio)",
      artist: "The Kid LAROI",
      album: "Fade Away",
      release_date: "20200416",
      description: "Producer: Heavy Keyzz",
      webpage_url: "https://music.youtube.com/watch?v=x",
      genre: "Music",
    });
    expect(meta.title).toBe("Fade Away");
    expect(meta.artist).toBe("The Kid LAROI");
    expect(meta.album).toBe("Fade Away");
    expect(meta.date).toBe("2020");
    expect(meta.composer).toBe("Heavy Keyzz");
    expect(meta.comment).toContain("music.youtube.com");
  });

  test("falls back gracefully on sparse info", () => {
    const meta = buildMetadata({ title: "Unknown Track" });
    expect(meta.title).toBe("Unknown Track");
    expect(meta.artist).toBeNull();
    expect(meta.genre).toBe("Music");
  });
});
