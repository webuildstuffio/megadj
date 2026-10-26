/**
 * itunes.ts — iTunes Search API arm for L2 genre + preview URLs (B4.4).
 *
 * The iTunes Search API is free, no auth required. Returns coarse
 * `primaryGenreName` (L2-level only: "Dance", "Electronic", "Hip-Hop/Rap",
 * "Pop", "R&B/Soul") plus preview URLs (30s AAC, useful for B3.4 audio
 * verification).
 *
 * Rate limit: ~20 calls/min (Apple documentation), enforced with delay.
 */
import { mapToFamily } from "../genre/taxonomy-v3";

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const ITUNES_DELAY_MS = 3500; // ~17 calls/min, well under 20

/** Result from an iTunes search for one track. */
export interface ItunesTrackResult {
  readonly trackName: string;
  readonly artistName: string;
  readonly primaryGenreName: string;
  readonly genreFamily: string | null;
  readonly previewUrl: string | null;
  readonly trackViewUrl: string;
  readonly collectionName: string | null;
  readonly releaseDate: string | null;
}

/** Raw iTunes API response shape. */
interface ItunesApiResponse {
  resultCount: number;
  results: ItunesApiResult[];
}

interface ItunesApiResult {
  trackName?: string;
  artistName?: string;
  primaryGenreName?: string;
  previewUrl?: string;
  trackViewUrl?: string;
  collectionName?: string;
  releaseDate?: string;
  kind?: string;
}

/**
 * Map iTunes primaryGenreName to our L2 taxonomy.
 * iTunes uses broad names: "Dance", "Electronic", "Hip-Hop/Rap", etc.
 */
const ITUNES_GENRE_MAP = new Map<string, string>([
  ["dance", "house"],
  ["electronic", "house"],
  ["electronica", "house"],
  ["house", "house"],
  ["techno", "techno"],
  ["trance", "trance"],
  ["hip-hop/rap", "hip hop"],
  ["hip-hop", "hip hop"],
  ["rap", "hip hop"],
  ["r&b/soul", "r&b"],
  ["r&b", "r&b"],
  ["soul", "soul"],
  ["pop", "pop"],
  ["rock", "pop"],
  ["alternative", "pop"],
  ["indie", "pop"],
  ["jazz", "funk"],
  ["funk", "funk"],
  ["reggae", "reggae"],
  ["latin", "latin"],
  ["classical", "ambient"],
  ["ambient", "ambient"],
  ["downtempo", "downtempo"],
  ["drum & bass", "drum and bass"],
  ["dubstep", "dubstep"],
  ["industrial", "industrial"],
  ["disco", "disco"],
]);

/**
 * Map an iTunes genre name to our L2 family.
 * Falls back to the taxonomy's mapToFamily for unmapped names.
 */
export function itunesGenreToFamily(genre: string): string | null {
  const lower = genre.toLowerCase().trim();
  const mapped = ITUNES_GENRE_MAP.get(lower);
  if (mapped) return mapped;
  return mapToFamily(genre);
}

/**
 * Search the iTunes API for a track.
 *
 * @param artist - Artist name
 * @param title - Track title
 * @param limit - Max results (default 5)
 * @returns Matching tracks with genre and preview info
 */
export async function searchItunes(
  artist: string,
  title: string,
  limit = 5,
): Promise<ItunesTrackResult[]> {
  const term = `${artist} ${title}`.slice(0, 200);
  const params = new URLSearchParams({
    term,
    media: "music",
    entity: "song",
    limit: String(limit),
  });

  const url = `${ITUNES_SEARCH_URL}?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) return [];

  const data = (await response.json()) as ItunesApiResponse;
  if (!data.results || !Array.isArray(data.results)) return [];

  return data.results
    .filter((r) => r.kind === "song" && r.trackName && r.artistName)
    .map((r) => ({
      trackName: r.trackName ?? "",
      artistName: r.artistName ?? "",
      primaryGenreName: r.primaryGenreName ?? "",
      genreFamily: r.primaryGenreName ? itunesGenreToFamily(r.primaryGenreName) : null,
      previewUrl: r.previewUrl ?? null,
      trackViewUrl: r.trackViewUrl ?? "",
      collectionName: r.collectionName ?? null,
      releaseDate: r.releaseDate ?? null,
    }));
}

/** Delay between iTunes API calls to respect rate limits. */
export function itunesDelay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ITUNES_DELAY_MS);
  });
}
