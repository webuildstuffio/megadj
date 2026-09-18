// genre-vote.ts — the weighted multi-source genre vote ladder (#173,
// genre-pipeline.md §5b.3.6). Supersedes first-win writes: every source
// rung VOTES its claim (genre + weight + provenance), the highest total
// weight wins, ties break toward the harder gate. The write seam stays
// one: applyVote runs the write-first discipline (file tag, then DB row)
// and persists the per-track vote breakdown so every stored genre is
// explainable after the fact (no code reading to answer "why Techno?").
//
// Weights are versioned IN CODE next to the doc's W-table (never
// hand-tuned at call sites). Hard gates stay absolute upstream (artist
// gate, numeric/Music refusal) — a vote only exists for a claim that
// already passed its rung's gates; a lost vote is an honest null.
//
// Migration is a re-run (the pipeline's idempotent rerun rule), never a
// hand UPDATE.

/** The vote rungs that can claim a genre during `megadj fetch` (+ the
 *  enrich/ingest sources that ride the same seam). Weights follow the
 *  doc's reliability column: catalog taxonomy > artist-tagged pages >
 *  free-text > file tags > metadata category > imprint prior (a scene
 *  inference, not a genre claim). */
export const GENRE_VOTE_WEIGHTS = {
  /** W2 SoundCloud artist-gated free-text (junk-gated, hard artist gate) */
  sc: 0.35,
  /** W3 Beatport store genre (curated taxonomy) */
  bp: 0.6,
  /** W2b Bandcamp artist-entered tags (label-curated pages, artist-gated) */
  bc: 0.5,
  /** W4 AI classifier over the closed AI_VOCAB (conf ≥ 0.7, opt-in) */
  ai: 0.45,
  /** W5 MusicBrainz folksonomy (community-curated) */
  mb: 0.4,
  /** W6 the file's own TCON (pool rips; measured 53.1%) */
  file: 0.55,
  /** W1 sync-time category/regex (lowest — category, not genre) */
  sync: 0.2,
  /** W7 imprint prior: a scene FAMILY inference, not a genre claim —
   *  abstains against real genre votes unless it's the only voice */
  imprint: 0.15,
} as const;

export type GenreVoteRung = keyof typeof GENRE_VOTE_WEIGHTS;

/** One rung's claim on a track. `genre` is the canonicalized label
 *  (junk gates already passed upstream); `family` is the scoring family
 *  the vote actually elects (imprint votes elect families, not genres). */
export interface GenreVote {
  rung: GenreVoteRung;
  genre: string;
  weight: number;
  /** provenance detail (uploader, label name, MB tag source…) */
  detail?: string | undefined;
}

/** The elected winner: genre + who voted + the full breakdown. */
export interface GenreVoteResult {
  genre: string | null;
  /** the winning rung(s) — every rung that voted the elected genre */
  winnerRungs: GenreVoteRung[];
  /** total weight of the winning genre */
  weight: number;
  /** the full vote breakdown (ledger-persisted) */
  votes: GenreVote[];
  /** true when the election was the imprint prior's family (a scene
   *  label, not a catalog genre) */
  familyOnly: boolean;
}

/** Elect the winning genre from collected votes. Highest total weight
 *  wins; ties break toward the rung with the HIGHER single weight (the
 *  harder gate — e.g. a bp vote beats two sync votes at equal mass).
 *  Deterministic: same votes, same winner, no randomness. */
export function electGenre(votes: readonly GenreVote[]): GenreVoteResult {
  if (votes.length === 0)
    return {
      genre: null,
      winnerRungs: [],
      weight: 0,
      votes: [],
      familyOnly: false,
    };
  const tally = new Map<
    string,
    {
      total: number;
      rungs: GenreVoteRung[];
      maxSingle: number;
      familyOnly: boolean;
    }
  >();
  for (const v of votes) {
    const cur = tally.get(v.genre);
    if (cur) {
      cur.total += v.weight;
      cur.maxSingle = Math.max(cur.maxSingle, v.weight);
      if (!cur.rungs.includes(v.rung)) cur.rungs.push(v.rung);
      cur.familyOnly &&= v.rung === "imprint";
    } else {
      tally.set(v.genre, {
        total: v.weight,
        rungs: [v.rung],
        maxSingle: v.weight,
        familyOnly: v.rung === "imprint",
      });
    }
  }
  let best: {
    genre: string;
    total: number;
    rungs: GenreVoteRung[];
    maxSingle: number;
    familyOnly: boolean;
  } | null = null;
  for (const [genre, t] of tally) {
    if (
      best === null ||
      t.total > best.total ||
      // tie toward the harder single gate, then alphabetical (deterministic)
      (t.total === best.total &&
        (t.maxSingle > best.maxSingle ||
          (t.maxSingle === best.maxSingle && genre < best.genre)))
    ) {
      best = { genre, ...t };
    }
  }
  return {
    genre: best?.genre ?? null,
    winnerRungs: best?.rungs ?? [],
    weight: best?.total ?? 0,
    votes: [...votes],
    familyOnly: best?.familyOnly ?? false,
  };
}

/** The vote breakdown serialized for the ledger column. */
export function serializeVotes(votes: readonly GenreVote[]): string {
  return JSON.stringify(
    votes.map((v) => ({
      rung: v.rung,
      genre: v.genre,
      weight: v.weight,
      ...(v.detail !== undefined ? { detail: v.detail } : {}),
    })),
  );
}

/** Read a persisted breakdown back. Corrupt JSON reads as empty (the
 *  poison-row rule): the breakdown is explainability metadata, its loss
 *  must never throw into a query. */
export function parseVotes(raw: string | null): GenreVote[] {
  if (raw === null || raw === "") return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const rows: unknown[] = value; // Array.isArray on unknown = any[]; pin it
    const out: GenreVote[] = [];
    for (const v of rows) {
      if (typeof v !== "object" || v === null) continue;
      const vote = v as Partial<GenreVote>;
      if (
        typeof vote.rung !== "string" ||
        typeof vote.genre !== "string" ||
        typeof vote.weight !== "number" ||
        !(vote.rung in GENRE_VOTE_WEIGHTS)
      ) {
        continue;
      }
      out.push({
        rung: vote.rung,
        genre: vote.genre,
        weight: vote.weight,
        ...(typeof vote.detail === "string" ? { detail: vote.detail } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}
