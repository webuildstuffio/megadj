/**
 * lastfm.ts — Last.fm track tags arm (B4.5).
 *
 * Uses the Last.fm API to fetch user-applied tags for tracks.
 * Tags are community-sourced and carry genre/mood/era information.
 *
 * Free tier: 5 requests/second, API key required.
 */
import { mapToFamily } from "../genre/taxonomy-v3";

const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_DELAY_MS = 250; // 4 req/sec, below the 5/sec limit

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

/**
 * Fetch track tags from Last.fm.
 *
 * @param artist - Artist name
 * @param track - Track title
 * @param apiKey - Last.fm API key
 * @returns Track tags with genre mapping
 */
export async function fetchLastfmTags(
  artist: string,
  track: string,
  apiKey: string,
): Promise<LastfmTrackResult | null> {
  const params = new URLSearchParams({
    method: "track.getInfo",
    artist,
    track,
    api_key: apiKey,
    format: "json",
  });

  const url = `${LASTFM_API_URL}?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) return null;

  const data = (await response.json()) as LastfmApiResponse;
  if (!data.track) return null;

  const rawTags = data.track.toptags?.tag ?? [];
  const tags: LastfmTag[] = rawTags
    .filter(
      (t): t is { name: string; count: number } =>
        typeof t.name === "string" && typeof t.count === "number",
    )
    .map((t) => ({
      name: t.name,
      count: t.count,
      family: mapToFamily(t.name),
    }));

  // Find the top genre family
  let topFamily: string | null = null;
  let topCount = 0;
  for (const t of tags) {
    if (t.family !== null && t.count > topCount) {
      topFamily = t.family;
      topCount = t.count;
    }
  }

  return {
    trackName: data.track.name ?? track,
    artistName: data.track.artist?.name ?? artist,
    tags,
    topFamily,
  };
}

/** Delay between Last.fm API calls. */
export function lastfmDelay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, LASTFM_DELAY_MS);
  });
}
