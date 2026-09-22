// genre-vote-rungs.ts — the vote-ladder rung metadata seam.
//
// Shared leaf (same pattern as megaset.ts/radar.ts/hygiene.ts: imports
// NOTHING, so the import graph stays a DAG). The weights SSOT stays
// src/fulltags/genre/genre-vote.ts (GENRE_VOTE_WEIGHTS); THIS table adds
// the display metadata every UI needs to render the full ladder — name,
// doc W-number, description, display order — without hand-copying either
// side (a local twin drifted once and crashed the render; the round-4
// lesson). The genre-vote census test pins THIS table against
// GENRE_VOTE_WEIGHTS so the two can never disagree.
//
// A rung missing here is invisible on every surface; a rung in
// GENRE_VOTE_WEIGHTS but not here fails the census test — one edit per
// new rung, in this file, alongside its weight.

/** One vote-ladder rung's display metadata. */
export interface GenreVoteRungDef {
  /** The GENRE_VOTE_WEIGHTS key (GenreVoteRung). */
  id: string;
  /** Human name on every surface. */
  name: string;
  /** The doc's W-number (genre-pipeline.md §5b.3.6). */
  docRef: string;
  /** The rung's fixed vote weight — MIRRORED from GENRE_VOTE_WEIGHTS so
   *  browser surfaces can render abstained rungs' would-be weight without
   *  importing server code. The census test
   *  (src/deck/test/genre-vote-rungs-census.test.ts) pins every value
   *  here against the SSOT, so this is a pinned mirror, never a twin
   *  that can drift. */
  weight: number;
  /** What the rung is, one clause — the full-ladder render's descriptor. */
  description: string;
  /** Render order: weight-descending (the reliability ladder). The census
   *  test verifies this ordering matches the weights. */
  order: number;
}

export const GENRE_VOTE_RUNG_DEFS: readonly GenreVoteRungDef[] = [
  {
    id: "bp",
    name: "Beatport",
    docRef: "W3",
    weight: 0.6,
    order: 1,
    description: "store taxonomy — artist-gated lookup",
  },
  {
    id: "file",
    name: "File tag",
    docRef: "W6",
    weight: 0.55,
    order: 2,
    description: "the file's own TCON (pool rips)",
  },
  {
    id: "bc",
    name: "Bandcamp",
    docRef: "W2b",
    weight: 0.5,
    order: 3,
    description: "artist page tags — hard artist gate",
  },
  {
    id: "ai",
    name: "AI classifier",
    docRef: "W4",
    weight: 0.45,
    order: 4,
    description: "closed vocab, conf ≥ 0.7, opt-in",
  },
  {
    id: "mb",
    name: "MusicBrainz",
    docRef: "W5",
    weight: 0.4,
    order: 5,
    description: "community folksonomy",
  },
  {
    id: "sc",
    name: "SoundCloud",
    docRef: "W2",
    weight: 0.35,
    order: 6,
    description: "uploader free-text — junk-gated, artist-gated",
  },
  {
    id: "sync",
    name: "Sync category",
    docRef: "W1",
    weight: 0.2,
    order: 7,
    description: "title/artist regex — a category, not a genre",
  },
  {
    id: "imprint",
    name: "Imprint prior",
    docRef: "W7",
    weight: 0.15,
    order: 8,
    description: "scene-family inference — abstains vs real votes",
  },
];

/** The full ladder in render order. */
export const genreVoteRungsInOrder = (): GenreVoteRungDef[] =>
  [...GENRE_VOTE_RUNG_DEFS].toSorted((a, b) => a.order - b.order);
