import { describe, expect, it } from "bun:test";
import { sanitizeScTags } from "./sc-tag-sanitizer";

describe("sanitizeScTags", () => {
  it("classifies known genre tags as genre", () => {
    const result = sanitizeScTags(["techno", "deep house", "minimal"]);
    expect(result.genreTags.length).toBeGreaterThanOrEqual(1);
    expect(result.junkTags).toHaveLength(0);
    expect(result.bestGenre).toBeTruthy();
    expect(result.bestFamily).toBeTruthy();
  });

  it("rejects spam/promo tags as junk", () => {
    const result = sanitizeScTags([
      "freedownload",
      "follow4follow",
      "repostnetwork",
      "buylink",
      "https://spam.com/link",
      "check-out",
      "streaming",
    ]);
    expect(result.genreTags).toHaveLength(0);
    expect(result.junkTags.length).toBeGreaterThan(0);
  });

  it("rejects numeric-only and single-char tags", () => {
    const result = sanitizeScTags(["12345", "x", "a", "999"]);
    expect(result.genreTags).toHaveLength(0);
    expect(result.junkTags.length).toBeGreaterThan(0);
  });

  it("classifies mood/scene tags correctly", () => {
    const result = sanitizeScTags(["dark", "warehouse", "berlin", "heavy"]);
    expect(result.moodTags.length).toBeGreaterThan(0);
    expect(result.genreTags).toHaveLength(0);
  });

  it("handles mixed input with genres, moods, and junk", () => {
    const result = sanitizeScTags([
      "techno",
      "dark",
      "freedownload",
      "berlin",
      "house",
      "promo",
    ]);
    expect(result.genreTags.length).toBeGreaterThanOrEqual(1);
    expect(result.moodTags.length).toBeGreaterThan(0);
    expect(result.junkTags.length).toBeGreaterThan(0);
    expect(result.bestGenre).toBeTruthy();
  });

  it("strips # prefix from hashtags", () => {
    const result = sanitizeScTags(["#techno", "#house"]);
    expect(result.genreTags.length).toBeGreaterThanOrEqual(1);
  });

  it("returns null best genre when no tags map", () => {
    const result = sanitizeScTags(["freedownload", "12345"]);
    expect(result.bestGenre).toBeNull();
    expect(result.bestFamily).toBeNull();
  });

  it("handles empty input", () => {
    const result = sanitizeScTags([]);
    expect(result.genreTags).toHaveLength(0);
    expect(result.moodTags).toHaveLength(0);
    expect(result.junkTags).toHaveLength(0);
  });

  it("rejects platform noise tags", () => {
    const result = sanitizeScTags([
      "soundcloud",
      "spotify",
      "music",
      "dj",
      "producer",
    ]);
    expect(result.genreTags).toHaveLength(0);
  });

  it("handles year tags as junk", () => {
    const result = sanitizeScTags(["2024", "2025", "2026", "2027"]);
    expect(result.genreTags).toHaveLength(0);
    expect(result.junkTags.length).toBe(4);
  });

  it("handles .com/.net/.io suffixes as junk", () => {
    const result = sanitizeScTags(["djsoundtop.com", "promo.net", "beats.io"]);
    expect(result.genreTags).toHaveLength(0);
    expect(result.junkTags.length).toBe(3);
  });

  it("classifies era/scene tags as scene", () => {
    const result = sanitizeScTags(["90s", "oldschool", "retro"]);
    expect(result.moodTags.length).toBeGreaterThan(0);
    for (const t of result.moodTags) {
      expect(t.kind).toBe("scene");
    }
  });

  it("genre tags have family set", () => {
    const result = sanitizeScTags(["acid house", "drum and bass"]);
    for (const t of result.genreTags) {
      expect(t.family).not.toBeNull();
      expect(t.genre).not.toBeNull();
    }
  });

  it("handles case insensitive genres", () => {
    const result = sanitizeScTags(["TECHNO", "Deep House", "MINIMAL"]);
    expect(result.genreTags.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects @ prefixed tags as junk", () => {
    const result = sanitizeScTags(["@djname", "@promoter"]);
    expect(result.genreTags).toHaveLength(0);
    expect(result.junkTags.length).toBe(2);
  });
});
