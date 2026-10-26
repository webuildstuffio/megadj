/**
 * discogs-vote.ts — Discogs vote rung for the genre ladder (W9).
 *
 * Two paths, preferred in order:
 *   1. Offline DB (MEGADJ_DISCOGS_DB) — instant, no rate limit
 *   2. REST API (MEGADJ_DISCOGS_KEY + MEGADJ_DISCOGS_SECRET) — 1 rps
 *
 * The DB is lazily opened on first call and held for the process
 * lifetime (the fetch pipeline runs many tracks sequentially).
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { GENRE_VOTE_WEIGHTS, type GenreVote } from "../genre/genre-vote";
import { discogsLookup } from "./discogs-ingest";
import { discogsApiSearch, discogsApiAvailable } from "./discogs-api";
import { nonEmptyEnv } from "../../shared/leaf/guards";
import { canonicalizeClaim } from "../genre/genre-vocab";
import { UMBRELLA_STRINGS } from "../genre/taxonomy-v3";

/** Sentinel for "not tried yet" vs null (tried, unavailable). */
const NOT_TRIED = Symbol("not-tried");
let cachedDb: Database | null | typeof NOT_TRIED = NOT_TRIED;

/** Lazy-open the Discogs cache DB. Returns null when unavailable. */
function getDiscogsDb(): Database | null {
  if (cachedDb !== NOT_TRIED) return cachedDb;
  const dbPath = nonEmptyEnv("MEGADJ_DISCOGS_DB");
  if (!dbPath || !existsSync(dbPath)) {
    cachedDb = null;
    return null;
  }
  try {
    cachedDb = new Database(dbPath, { readonly: true });
    return cachedDb;
  } catch {
    cachedDb = null;
    return null;
  }
}

/** Build a GenreVote from a genre result (shared by DB and API paths). */
function resultToVote(
  releaseId: number,
  bestStyle: string | null,
  bestFamily: string | null,
): GenreVote | null {
  const genre = bestStyle ? canonicalizeClaim(bestStyle) : bestFamily;
  if (!genre || UMBRELLA_STRINGS.has(genre.toLowerCase())) return null;
  return {
    rung: "discogs",
    genre,
    weight: GENRE_VOTE_WEIGHTS.discogs,
    detail: `discogs:${releaseId}${bestStyle ? ` style:${bestStyle}` : ""}`,
  };
}

/**
 * Produce a GenreVote from Discogs (offline DB → API fallback), or null.
 * Ready for the vote ladder — the caller pushes onto genreVotes[].
 */
export async function discogsGenreVote(artist: string, title: string): Promise<GenreVote | null> {
  // Path 1: offline DB (instant)
  const db = getDiscogsDb();
  if (db) {
    const result = discogsLookup(db, artist, title);
    if (result?.bestStyle || result?.bestFamily) {
      return resultToVote(result.releaseId, result.bestStyle, result.bestFamily);
    }
  }

  // Path 2: REST API (rate-limited, 1 rps)
  if (discogsApiAvailable()) {
    const apiResult = await discogsApiSearch(artist, title);
    if (apiResult?.bestStyle || apiResult?.bestFamily) {
      return resultToVote(apiResult.releaseId, apiResult.bestStyle, apiResult.bestFamily);
    }
  }

  return null;
}

/** Close the cached DB (tests / process cleanup). */
export function discogsDbClose(): void {
  if (cachedDb !== null && cachedDb !== NOT_TRIED) {
    cachedDb.close();
  }
  cachedDb = NOT_TRIED;
}
