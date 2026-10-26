/**
 * lastfm.test.ts — Tests for Last.fm tag mapping and vote rung (B4.5/W8).
 */
import { describe, expect, test, mock, afterEach } from "bun:test";
import { mapToFamily } from "../genre/taxonomy-v3";
import { lastfmCacheReset } from "./lastfm";

describe("lastfm tag → family mapping", () => {
  test("'deep house' → house", () => {
    expect(mapToFamily("deep house")).toBe("house");
  });

  test("'techno' → techno", () => {
    expect(mapToFamily("techno")).toBe("techno");
  });

  test("'drum and bass' → drum and bass", () => {
    expect(mapToFamily("drum and bass")).toBe("drum and bass");
  });

  test("'electronic' umbrella → null", () => {
    expect(mapToFamily("electronic")).toBeNull();
  });

  test("'trap' → hip hop", () => {
    expect(mapToFamily("trap")).toBe("hip hop");
  });

  test("unknown tag → null", () => {
    expect(mapToFamily("seen live")).toBeNull();
  });
});

describe("lastfmGenreVote", () => {
  afterEach(() => {
    lastfmCacheReset();
    mock.restore();
  });

  test("returns null when API returns no tags", async () => {
    const { lastfmGenreVote } = await import("./lastfm");
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        Response.json({
          track: { name: "Test", artist: { name: "Test Artist" }, toptags: { tag: [] } },
        }),
      ),
    ) as unknown as typeof fetch;
    try {
      const vote = await lastfmGenreVote("Test Artist", "Test", "test-key");
      expect(vote).toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("returns a vote when tags include a genre", async () => {
    const { lastfmGenreVote } = await import("./lastfm");
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        Response.json({
          track: {
            name: "Test",
            artist: { name: "Test Artist" },
            toptags: {
              tag: [
                { name: "techno", count: 100 },
                { name: "electronic", count: 80 },
                { name: "seen live", count: 50 },
              ],
            },
          },
        }),
      ),
    ) as unknown as typeof fetch;
    try {
      const vote = await lastfmGenreVote("Test Artist", "Test", "test-key");
      expect(vote).not.toBeNull();
      expect(vote?.rung).toBe("lastfm");
      expect(vote?.genre).toBeTruthy();
      expect(vote?.weight).toBe(0.3);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("drops tags with count below threshold", async () => {
    const { lastfmGenreVote } = await import("./lastfm");
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        Response.json({
          track: {
            name: "Test",
            artist: { name: "Test Artist" },
            toptags: {
              tag: [
                { name: "techno", count: 10 },
                { name: "house", count: 5 },
              ],
            },
          },
        }),
      ),
    ) as unknown as typeof fetch;
    try {
      const vote = await lastfmGenreVote("Test Artist", "Test", "test-key");
      expect(vote).toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("returns null on API error", async () => {
    const { lastfmGenreVote } = await import("./lastfm");
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("", { status: 500 })),
    ) as unknown as typeof fetch;
    try {
      const vote = await lastfmGenreVote("Test Artist", "Test", "test-key");
      expect(vote).toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("caches results — second call does not fetch", async () => {
    const { fetchLastfmTags } = await import("./lastfm");
    const origFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = mock(() => {
      fetchCount++;
      return Promise.resolve(
        Response.json({
          track: {
            name: "CacheTest",
            artist: { name: "CacheArtist" },
            toptags: { tag: [{ name: "techno", count: 100 }] },
          },
        }),
      );
    }) as unknown as typeof fetch;
    try {
      await fetchLastfmTags("CacheArtist", "CacheTest", "key");
      await fetchLastfmTags("CacheArtist", "CacheTest", "key");
      expect(fetchCount).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("vote detail includes tag names and counts", async () => {
    const { lastfmGenreVote } = await import("./lastfm");
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        Response.json({
          track: {
            name: "DetailTest",
            artist: { name: "DetailArtist" },
            toptags: {
              tag: [
                { name: "house", count: 80 },
                { name: "deep house", count: 60 },
              ],
            },
          },
        }),
      ),
    ) as unknown as typeof fetch;
    try {
      const vote = await lastfmGenreVote("DetailArtist", "DetailTest", "key");
      expect(vote?.detail).toContain("lastfm:");
      expect(vote?.detail).toContain("house");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("returns null when no track in response", async () => {
    const { fetchLastfmTags } = await import("./lastfm");
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(Response.json({}))) as unknown as typeof fetch;
    try {
      const result = await fetchLastfmTags("NoTrack", "NoTrack", "key");
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("returns null on malformed JSON response", async () => {
    const { fetchLastfmTags } = await import("./lastfm");
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("not json", { status: 200 })),
    ) as unknown as typeof fetch;
    try {
      const result = await fetchLastfmTags("BadJSON", "BadJSON", "key");
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
