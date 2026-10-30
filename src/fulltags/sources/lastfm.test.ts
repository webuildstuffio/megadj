/**
 * lastfm.test.ts — Tests for Last.fm tag mapping and vote rung (B4.5/W8).
 */
import { describe, expect, test, mock, afterEach } from "bun:test";
import { mapToFamily } from "../genre/taxonomy-v3";
import { lastfmCacheReset } from "./lastfm";

type TagShape = { name: string; count: number };

/** track.getInfo response body carrying the given toptags. */
const trackResponse = (tags: TagShape[], name = "Test", artist = "Test Artist") => ({
  track: { name, artist: { name: artist }, toptags: { tag: tags } },
});

/** Run against a mocked globalThis.fetch, restoring the original afterwards. */
async function withMockedFetch<T>(
  respond: () => Response | Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const origFetch = globalThis.fetch;
  globalThis.fetch = mock(() => Promise.resolve(respond())) as unknown as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = origFetch;
  }
}

/** lastfmGenreVote against a mocked response. */
const voteWith = (respond: () => Response | Promise<Response>, artist = "Test Artist", title = "Test") =>
  withMockedFetch(respond, async () => {
    const { lastfmGenreVote } = await import("./lastfm");
    return lastfmGenreVote(artist, title, "test-key");
  });

/** lastfmGenreVote against a track response with the given tags. */
const voteWithTags = (tags: TagShape[], artist = "Test Artist", title = "Test") =>
  voteWith(() => Response.json(trackResponse(tags, title, artist)), artist, title);

/** fetchLastfmTags against a mocked response. */
const fetchTagsWith = (respond: () => Response | Promise<Response>, artist: string, title: string) =>
  withMockedFetch(respond, async () => {
    const { fetchLastfmTags } = await import("./lastfm");
    return fetchLastfmTags(artist, title, "key");
  });

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
    expect(await voteWithTags([])).toBeNull();
  });

  test("returns a vote when tags include a genre", async () => {
    const vote = await voteWithTags([
      { name: "techno", count: 100 },
      { name: "electronic", count: 80 },
      { name: "seen live", count: 50 },
    ]);
    expect(vote).not.toBeNull();
    expect(vote?.rung).toBe("lastfm");
    expect(vote?.genre).toBeTruthy();
    expect(vote?.weight).toBe(0.3);
  });

  test("drops tags with count below threshold", async () => {
    expect(
      await voteWithTags([
        { name: "techno", count: 10 },
        { name: "house", count: 5 },
      ]),
    ).toBeNull();
  });

  test("returns null on API error", async () => {
    expect(await voteWith(() => new Response("", { status: 500 }))).toBeNull();
  });

  test("caches results — second call does not fetch", async () => {
    let fetchCount = 0;
    const respond = () => {
      fetchCount++;
      return Response.json(trackResponse([{ name: "techno", count: 100 }], "CacheTest", "CacheArtist"));
    };
    await fetchTagsWith(respond, "CacheArtist", "CacheTest");
    await fetchTagsWith(respond, "CacheArtist", "CacheTest");
    expect(fetchCount).toBe(1);
  });

  test("vote detail includes tag names and counts", async () => {
    const vote = await voteWithTags(
      [
        { name: "house", count: 80 },
        { name: "deep house", count: 60 },
      ],
      "DetailArtist",
      "DetailTest",
    );
    expect(vote?.detail).toContain("lastfm:");
    expect(vote?.detail).toContain("house");
  });

  test("returns null when no track in response", async () => {
    expect(await fetchTagsWith(() => Response.json({}), "NoTrack", "NoTrack")).toBeNull();
  });

  test("returns null on malformed JSON response", async () => {
    expect(
      await fetchTagsWith(() => new Response("not json", { status: 200 }), "BadJSON", "BadJSON"),
    ).toBeNull();
  });
});
