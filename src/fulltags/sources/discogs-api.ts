/**
 * discogs-api.ts — Discogs REST API search for genre/style lookups.
 *
 * Uses key/secret auth (60 req/min authenticated).
 * Env: MEGADJ_DISCOGS_KEY + MEGADJ_DISCOGS_SECRET, or keychain fallback.
 *
 * This is the LIVE alternative to the offline CC0 dump path in
 * discogs-ingest.ts. The vote module (discogs-vote.ts) prefers the
 * offline DB (instant) and falls back to this API when no DB exists.
 */
import { type DiscogsGenreResult, mapDiscogsRelease } from "./discogs";
import { nonEmptyEnv } from "../../shared/leaf/guards";

const DISCOGS_API = "https://api.discogs.com";
const DISCOGS_TIMEOUT_MS = 10_000;
/** 60 req/min authenticated = 1 per second. Stay over it. */
const DISCOGS_DELAY_MS = 1050;

/** Discogs search result (only the fields we read). */
interface DiscogsSearchResult {
  readonly id: number;
  readonly title: string;
  readonly genre: readonly string[];
  readonly style: readonly string[];
  readonly year: string;
  readonly country: string;
}

interface DiscogsSearchResponse {
  readonly results?: readonly DiscogsSearchResult[];
}

/** Parse a Discogs year string safely (Number.isFinite guard). */
function parseDiscogsApiYear(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 1900 && n < 2100 ? n : null;
}

/** In-process cache: "artist::title" → result (including verified misses). */
const apiCache = new Map<string, DiscogsGenreResult | null>();

/** Trailing-edge rate limiter. */
let lastDiscogsCall = 0;
async function discogsDelay(): Promise<void> {
  const now = Date.now();
  const wait = lastDiscogsCall + DISCOGS_DELAY_MS - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastDiscogsCall = Date.now();
}

/** Read Discogs credentials from env (or keychain via shell). */
function discogsAuth(): { key: string; secret: string } | null {
  const key = nonEmptyEnv("MEGADJ_DISCOGS_KEY");
  const secret = nonEmptyEnv("MEGADJ_DISCOGS_SECRET");
  if (key && secret) return { key, secret };
  return null;
}

let cachedAuth: { key: string; secret: string } | null | false = false;

/** Lazy-resolve auth (false = not tried, null = unavailable). */
function getAuth(): { key: string; secret: string } | null {
  if (cachedAuth !== false) return cachedAuth;
  cachedAuth = discogsAuth();
  return cachedAuth;
}

/**
 * Search Discogs API for a track by artist + title.
 * Returns the best match's genre result, or null.
 */
export async function discogsApiSearch(
  artist: string,
  title: string,
): Promise<DiscogsGenreResult | null> {
  const auth = getAuth();
  if (!auth) return null;

  const cacheKey = `${artist.normalize("NFC").toLowerCase()}::${title.normalize("NFC").toLowerCase()}`;
  if (apiCache.has(cacheKey)) return apiCache.get(cacheKey) ?? null;

  await discogsDelay();

  const params = new URLSearchParams({ q: `${artist} ${title}`, type: "release", per_page: "3" });

  let response: Response;
  try {
    response = await fetch(`${DISCOGS_API}/database/search?${params}`, {
      headers: {
        Authorization: `Discogs key=${auth.key}, secret=${auth.secret}`,
        "User-Agent": "megadj/0.1",
      },
      signal: AbortSignal.timeout(DISCOGS_TIMEOUT_MS),
    });
  } catch {
    apiCache.set(cacheKey, null);
    return null;
  }

  if (!response.ok) {
    apiCache.set(cacheKey, null);
    return null;
  }

  let data: DiscogsSearchResponse;
  try {
    data = (await response.json()) as DiscogsSearchResponse;
  } catch {
    apiCache.set(cacheKey, null);
    return null;
  }

  const hit = data.results?.[0];
  if (!hit) {
    apiCache.set(cacheKey, null);
    return null;
  }

  const result = mapDiscogsRelease({
    releaseId: hit.id,
    title: hit.title,
    artists: [artist],
    genres: [...hit.genre],
    styles: [...hit.style],
    year: hit.year ? parseDiscogsApiYear(hit.year) : null,
    country: hit.country ?? null,
  });

  // Only cache non-null results that mapped to at least one family
  if (!result.bestFamily && !result.bestStyle) {
    apiCache.set(cacheKey, null);
    return null;
  }

  apiCache.set(cacheKey, result);
  return result;
}

/** Check if Discogs API credentials are available. */
export function discogsApiAvailable(): boolean {
  return getAuth() !== null;
}

/** Reset the in-process cache (tests). */
export function discogsApiCacheReset(): void {
  apiCache.clear();
  cachedAuth = false;
}
