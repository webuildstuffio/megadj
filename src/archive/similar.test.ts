import { describe, expect, test } from "bun:test";
import { genreFamily, inferGenre, normalizeGenre } from "./similar";

describe("archive similarity genre voting", () => {
  test("normalizes and buckets common genre labels", () => {
    expect(normalizeGenre("Deep House (Club Mix), Electronic")).toBe(
      "deep house",
    );
    expect(genreFamily("Deep House (Club Mix)")).toBe("house");
    expect(genreFamily("Music")).toBeNull();
  });

  test("infers a family only when the neighbourhood agrees", () => {
    const seeds = [
      { videoId: "house-a", genre: "House", vec: [1, 0] },
      { videoId: "house-b", genre: "Deep House", vec: [0.99, 0.01] },
      { videoId: "techno", genre: "Techno", vec: [0, 1] },
    ];

    expect(inferGenre(seeds, [1, 0], 2)).toEqual({
      genre: "house",
      inferred: "house",
      agreement: 1,
    });
    expect(inferGenre(seeds, [0.1, 1], 2).inferred).toBeNull();
  });
});
