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
});
