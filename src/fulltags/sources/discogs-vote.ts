/**
 * discogs-vote.ts — Discogs vote rung for the genre ladder (W9).
 *
 * Looks up a track in the local Discogs cache DB (populated by
 * `megadj discogs-ingest`) and returns a GenreVote if matched.
 *
 * The DB is lazily opened on first call and held for the process
 * lifetime (the fetch pipeline runs many tracks sequentially).
 * Env: MEGADJ_DISCOGS_DB (path to the SQLite cache; skipped when absent).
 *
 * Pure lookup — no network, no rate limiting.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { GENRE_VOTE_WEIGHTS, type GenreVote } from "../genre/genre-vote";
import { discogsLookup } from "./discogs-ingest";
import { nonEmptyEnv } from "../../shared/leaf/guards";
import { canonicalizeClaim } from "../genre/genre-vocab";

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
    // DB file corrupt or unreadable — degrade silently
    cachedDb = null;
    return null;
  }
}

/**
 * Produce a GenreVote from the Discogs cache, or null if no match.
 * Ready for the vote ladder — the caller pushes onto genreVotes[].
 */
export function discogsGenreVote(
  artist: string,
  title: string,
): GenreVote | null {
  const db = getDiscogsDb();
  if (!db) return null;

  const result = discogsLookup(db, artist, title);
  if (!result?.bestStyle && !result?.bestFamily) return null;

  // Prefer the specific style (L3) over the broad family (L2)
  const genre = result.bestStyle
    ? canonicalizeClaim(result.bestStyle)
    : result.bestFamily;
  if (!genre) return null;

  return {
    rung: "discogs",
    genre,
    weight: GENRE_VOTE_WEIGHTS.discogs,
    detail: `discogs:${result.releaseId}${result.bestStyle ? ` style:${result.bestStyle}` : ""}`,
  };
}

/** Close the cached DB (tests / process cleanup). */
export function discogsDbClose(): void {
  if (cachedDb !== null && cachedDb !== NOT_TRIED) {
    cachedDb.close();
  }
  cachedDb = NOT_TRIED;
}
