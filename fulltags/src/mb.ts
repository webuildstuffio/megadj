/**
 * MusicBrainz folksonomy genre harvest (roadmap #5) — the third genre vote
 * alongside SoundCloud tags + AI. Artist-level tags ("house", "uk garage")
 * mapped through the same canonical vocabulary as every other source.
 *
 * 1 rps token bucket (MB politeness); in-process cache; never throws.
 * `megadj enrich` now delegates here — the old duplicate writer in
 * src/commands/enrich.ts is deleted, one genre ladder remains.
 */
import { canonGenre } from "./schema";

export interface MbGenreResult {
  artist: string;
  genre: string | null;
  /** All raw folksonomy tags seen (for debugging/provenance). */
  rawTags: string[];
}

interface MbArtistSearch {
  artists?: Array<{
    name?: string;
    tags?: Array<{ name: string; count: number }>;
  }>;
}

const artistCache = new Map<string, string | null>();
const RATE_MS = 1050; // MB hard limit 1 rps — stay over it
let lastCall = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const wait = lastCall + RATE_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

/** Artist → canonical genre via MB folksonomy tags. Null on miss/error. */
export async function mbGenreForArtist(artist: string): Promise<string | null> {
  const key = artist.toLowerCase().trim();
  if (artistCache.has(key)) return artistCache.get(key) ?? null;
  await rateLimit();
  const url = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(`"${artist}"`)}&fmt=json&limit=1`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "megadj/0.1 (https://github.com/megadj/megadj)",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as MbArtistSearch;
    const a = data.artists?.[0];
    if (!a) {
      artistCache.set(key, null);
      return null;
    }
    // Folksonomy: highest-count tag wins through the canonical map.
    const tags = (a.tags ?? []).slice().sort((x, y) => y.count - x.count);
    const raw = tags.map((t) => t.name).join(" ");
    const genre = canonGenre(raw) ?? null;
    artistCache.set(key, genre);
    return genre;
  } catch {
    return null;
  }
}

/** Batch: resolve genres for many artists (cache collapses repeats). */
export async function mbGenresForArtists(
  artists: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const a of artists) {
    const key = a.toLowerCase().trim();
    if (!out.has(key)) out.set(key, await mbGenreForArtist(a));
  }
  return out;
}

/** Reset the in-process cache (tests). */
export function mbGenreCacheReset(): void {
  artistCache.clear();
}
