// archive_genre.ts — the #215 genre-vote explainability read: one track's
// #173 vote-ladder breakdown, re-elected through the SAME seam the write
// path used (`electGenre`), so the stored genre and the replayed winner
// can never disagree. Same readonly ArchiveReader handle, same rules as
// archive_similar.ts: pure reads — a bug here cannot corrupt archive
// state.
import {
  electGenre,
  GENRE_VOTE_WEIGHTS,
  parseVotes,
} from "../../src/fulltags/genre/genre-vote";
import type { ArchiveQuery } from "./archive_types";

/** Round to 4 decimals for wire payloads. Pure — module-level. */
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

export function genreWhy(reader: ArchiveQuery, videoId: string) {
  const empty = () => ({
    available: reader.available(),
    video_id: videoId,
    title: null as string | null,
    artist: null as string | null,
    db_genre: null as string | null,
    voted: false,
    votes: [] as {
      rung: string;
      genre: string;
      weight: number;
      elected: boolean;
      detail: string | null;
    }[],
  });

  const track = reader.row<{
    title: string | null;
    artist: string | null;
    genre: string | null;
    genre_votes: string | null;
  }>(
    "SELECT title, artist, genre, genre_votes FROM tracks WHERE video_id = ?",
    videoId,
  );
  if (!track) return { ...empty(), missing: true as const };

  const votes = parseVotes(track.genre_votes);
  if (votes.length === 0) return empty();

  // Replay through the write path's exact election seam — a breakdown
  // always re-elects the genre the row carries (or exposes the drift).
  const elected = electGenre(votes);
  return {
    available: reader.available(),
    video_id: videoId,
    title: track.title,
    artist: track.artist,
    db_genre: track.genre,
    voted: true,
    elected: elected.genre,
    elected_weight: r4(elected.weight),
    winner_rungs: elected.winnerRungs,
    matches_db: elected.genre === track.genre,
    votes: votes.map((v) => ({
      rung: v.rung,
      genre: v.genre,
      weight: r4(GENRE_VOTE_WEIGHTS[v.rung]),
      elected: elected.genre !== null && v.genre === elected.genre,
      detail: v.detail ?? null,
    })),
  };
}

export type ArchiveGenreWhy = ReturnType<typeof genreWhy>;
