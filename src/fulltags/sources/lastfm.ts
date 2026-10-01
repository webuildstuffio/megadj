/**
 * lastfm.ts — Last.fm track tags arm (B4.5, wired as W8 vote rung).
 *
 * Uses the Last.fm API to fetch user-applied tags for tracks.
 * Tags are community-sourced and carry genre/mood/era information.
 *
 * Free tier: 5 requests/second, API key required (LASTFM_API_KEY env).
 *
 * Genre mapping: each tag goes through mapToFamily individually (never
 * joined as a blob — the #351 tag-soup lesson from mb-lookup.ts). Tags
 * with count < MIN_TAG_COUNT are dropped (low-count = artist-specific junk).
 *
 * Vote integration: lastfmGenreVote() returns a GenreVote or null,
 * ready for the vote ladder. The caller (fetch-pipeline or enrich)
 * pushes it onto the genreVotes accumulator.
 */
import { canonicalizeClaim } from "../genre/genre-vocab";
import { mapToFamily } from "../genre/taxonomy-v3";
import { GENRE_VOTE_WEIGHTS, type GenreVote } from "../genre/genre-vote";

const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_DELAY_MS = 250; // 4 req/sec, below the 5/sec limit

/** Minimum tag count to consider (low-count = artist-specific junk). */
const MIN_TAG_COUNT = 25;

/** Timeout for Last.fm API requests (seconds). */
const LASTFM_TIMEOUT_MS = 8_000;

/** A Last.fm tag with its community count. */
export interface LastfmTag {
  readonly name: string;
  readonly count: number;
  /** Mapped L2 family (null if unmappable). */
  readonly family: string | null;
}

/** Result from a Last.fm tag lookup. */
export interface LastfmTrackResult {
  readonly trackName: string;
  readonly artistName: string;
  readonly tags: readonly LastfmTag[];
  /** Top genre family from tags (most frequent mappable tag). */
  readonly topFamily: string | null;
  /** Canonicalized genre label from the top mappable tag. */
  readonly topGenre: string | null;
}

/** Raw Last.fm API response shapes. */
interface LastfmApiTag {
  name?: string;
  count?: number;
}

interface LastfmApiResponse {
  track?: {
    name?: string;
    artist?: { name?: string };
    toptags?: { tag?: LastfmApiTag[] };
  };
}

/** In-process cache: artist::title → result (including verified misses). */
const lastfmCache = new Map<string, LastfmTrackResult | null>();

/**
 * Fetch track tags from Last.fm.
 * Cached per process lifetime; rate-limited to ~4 req/sec.
 */
export async function fetchLastfmTags(
  artist: string,
  track: string,
  apiKey: string,
): Promise<LastfmTrackResult | null> {
  const cacheKey = `${artist.toLowerCase()}::${track.toLowerCase()}`;
  if (lastfmCache.has(cacheKey)) return lastfmCache.get(cacheKey) ?? null;

  await lastfmDelay();

  const params = new URLSearchParams({
    method: "track.getInfo",
    artist,
    track,
    api_key: apiKey,
    format: "json",
  });

  const url = `${LASTFM_API_URL}?${params.toString()}`;
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(LASTFM_TIMEOUT_MS),
    });
  } catch {
    lastfmCache.set(cacheKey, null);
    return null;
  }
  if (!response.ok) {
    lastfmCache.set(cacheKey, null);
    return null;
  }

  let data: LastfmApiResponse;
  try {
    data = (await response.json()) as LastfmApiResponse;
  } catch {
    lastfmCache.set(cacheKey, null);
    return null;
  }

  if (!data.track) {
    lastfmCache.set(cacheKey, null);
    return null;
  }

  const rawTags = data.track.toptags?.tag ?? [];
  const tags: LastfmTag[] = rawTags
    .filter(
      (t): t is { name: string; count: number } =>
        typeof t.name === "string" &&
        typeof t.count === "number" &&
        t.count >= MIN_TAG_COUNT,
    )
    .map((t) => ({
      name: t.name,
      count: t.count,
      family: mapToFamily(t.name),
    }));

  // Find the top genre: highest-count tag that maps to a family.
  // Each tag is tried individually (never joined — #351 lesson).
  let topFamily: string | null = null;
  let topGenre: string | null = null;
  let topCount = 0;
  for (const t of tags) {
    if (t.family !== null && t.count > topCount) {
      topFamily = t.family;
      topGenre = canonicalizeClaim(t.name);
      topCount = t.count;
    }
  }

  const result: LastfmTrackResult = {
    trackName: data.track.name ?? track,
    artistName: data.track.artist?.name ?? artist,
    tags,
    topFamily,
    topGenre,
  };
  lastfmCache.set(cacheKey, result);
  return result;
}

/**
 * Produce a GenreVote from Last.fm tags, or null if no mappable tag found.
 * Ready for the vote ladder — the caller pushes onto genreVotes[].
 */
export async function lastfmGenreVote(
  artist: string,
  title: string,
  apiKey: string,
): Promise<GenreVote | null> {
  const result = await fetchLastfmTags(artist, title, apiKey);
  if (!result?.topGenre) return null;
  return {
    rung: "lastfm",
    genre: result.topGenre,
    weight: GENRE_VOTE_WEIGHTS.lastfm,
    detail: `lastfm:${result.tags
      .filter((t) => t.family !== null)
      .map((t) => `${t.name}(${t.count})`)
      .join(",")}`,
  };
}

/** Trailing-edge rate limiter: sleep until LASTFM_DELAY_MS after the
 *  last call, then stamp. The stamp is set AFTER the sleep so concurrent
 *  callers in the same event loop don't undercount the gap. */
let lastLastfmCall = 0;
export async function lastfmDelay(): Promise<void> {
  const now = Date.now();
  const wait = lastLastfmCall + LASTFM_DELAY_MS - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastLastfmCall = Date.now();
}

/** Reset the in-process cache (tests). */
export function lastfmCacheReset(): void {
  lastfmCache.clear();
}
