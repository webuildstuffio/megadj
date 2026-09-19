import { cosineSimilarity } from "../shared/leaf/vector-space";
import { familyOf as defaultFamilyOf } from "../fulltags/genre/genre-vocab";
import {
  closeEvalSummary,
  evalDurationBand,
  newEvalSummary,
  tallySorted,
  type EvalSummary,
} from "./similar-evaluation";

/**
 * Genre inference over the embeddings ledger (the "genre ID3 is
 * unreliable" answer): kNN vote in the effnet embedding space, seeded by
 * the genres users/tools DID trust. Only usable labels vote, sub-genres
 * collapse to canonical families (house/deep-house/progressive-house all
 * vote "house" — raw labels fragment the vote into noise), and only
 * homogeneous neighbourhoods decide: a split vote leaves the track's
 * genre untouched instead of guessing. Pure — the caller feeds the
 * corpus; this file never reads the DB itself.
 */
export interface GenreSeed {
  videoId: string;
  genre: string;
  vec: number[];
}

/** Normalized genre → vote family. Null when no family claims it, and
 *  for junk category labels ("loop samples", "dj tools" — intentionally
 *  unmapped, #187). Delegates to the vocabulary SSOT
 *  (fulltags/src/genre-vocab.ts `familyOf`). */
export function genreFamily(genre: string): string | null {
  return defaultFamilyOf(genre);
}

export interface GenreVote {
  /** The winning family. */
  genre: string;
  /** Null when the neighbourhood was too split to decide. */
  inferred: string | null;
  /** Agreement fraction of the k votes (1.0 = unanimous). */
  agreement: number;
}

/** kNN genre-family vote for one query vector. Neighbours with a usable
 * seed family vote; the plurality family wins ONLY at ≥ `minAgreement`
 * (0.6 default). Deterministic: ties break alphabetically. `familyOf`
 * injects the label→family map (defaults to the pinned `genreFamily`):
 * the refold's scoring arbitration (`--eval --refold`) abstains umbrella
 * labels by passing `scoringFamily` — the default path is byte-identical
 * to the shipped baseline. */
export function inferGenre(
  seeds: GenreSeed[],
  queryVec: number[],
  k = 5,
  minAgreement = 0.6,
  familyOf: (genre: string) => string | null = genreFamily,
): GenreVote {
  const usable = seeds
    .map((s) => ({ ...s, family: familyOf(s.genre) }))
    .filter((s) => s.family !== null);
  if (!usable.length || queryVec.length === 0)
    return { genre: "", inferred: null, agreement: 0 };
  const nn = usable
    .filter((s) => s.vec.length === queryVec.length)
    .map((s) => ({
      label: s.family!,
      score: cosineSimilarity(queryVec, s.vec),
    }))
    .toSorted((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, Math.min(Math.max(k, 1), usable.length));
  const tally = new Map<string, number>();
  for (const n of nn) tally.set(n.label, (tally.get(n.label) ?? 0) + 1);
  const best = [...tally.entries()].toSorted(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];
  const agreement = best![1] / nn.length;
  return {
    genre: best![0],
    inferred: agreement >= minAgreement ? best![0] : null,
    agreement: Math.round(agreement * 100) / 100,
  };
}

/** Leave-one-out family-agreement harness over seed vectors — the genre
 *  hygiene regression gate (docs/fulltags/genre-audit.md §5b.3 step 4).
 *  Every family-evaluable seed is held out in turn; the remaining seeds
 *  vote on it (k nearest, gated at `minAgreement`). `durationGuard`
 *  drops the short/long outliers (90–480 s measured band) when the
 *  caller supplies durations — analysis hygiene, ~metric-neutral (G5).
 *  `familyOf` injects the label→family map (defaults to the pinned
 *  `genreFamily`; `scoringFamily` = the refold's umbrella arbitration).
 *  Pure: the DB read happens in the caller (`genre --eval`). */

export function evalLeaveOneOut(
  seeds: GenreSeed[],
  k = 5,
  minAgreement = 0.6,
  durationGuard: { videoId: string; durationS: number | null }[] = [],
  familyOf: (genre: string) => string | null = genreFamily,
): EvalSummary {
  const inBand = evalDurationBand(durationGuard);
  const pop = seeds.filter(
    (s) => familyOf(s.genre) !== null && inBand(s.videoId),
  );
  const summary: EvalSummary = newEvalSummary(pop.length);
  let ungatedAgree = 0;
  for (let i = 0; i < pop.length; i++) {
    const held = pop[i]!;
    const family = familyOf(held.genre)!;
    const rest = pop.toSpliced(i, 1);
    const vote = inferGenre(rest, held.vec, k, minAgreement, familyOf);
    if (vote.inferred === null) summary.refused++;
    else if (vote.inferred === family) summary.agree++;
    else summary.disagree++;
    // ungated twin: plain plurality, no gate
    if (vote.genre === family) ungatedAgree++;
    // per-row outcome (top-2 = the two largest tally buckets, ties
    // alphabetical — deterministic). Recompute the tally cheaply: k
    // neighbours, families only.
    const nn = rest
      .filter((s) => s.vec.length === held.vec.length)
      .map((s) => ({
        label: familyOf(s.genre) ?? "",
        score: cosineSimilarity(held.vec, s.vec),
      }))
      .toSorted((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, Math.min(Math.max(k, 1), rest.length));
    const tally = new Map<string, number>();
    for (const n of nn)
      if (n.label) tally.set(n.label, (tally.get(n.label) ?? 0) + 1);
    const top2 = tallySorted(tally)
      .slice(0, 2)
      .map(([label]) => label);
    summary.rows.push({
      videoId: held.videoId,
      family,
      predicted: vote.inferred,
      agreement: vote.agreement,
      top2,
    });
  }
  return closeEvalSummary(summary, pop.length, ungatedAgree);
}

interface DisjointVote {
  predicted: string | null;
  agreement: number;
  ungatedFamily: string | null;
  top2: string[];
}

function scoreDisjointVote(
  seeds: GenreSeed[],
  queryVec: number[],
  k: number,
  minAgreement: number,
): DisjointVote {
  const usable = seeds
    .map((seed) => ({
      family: genreFamily(seed.genre),
      score: cosineSimilarity(queryVec, seed.vec),
    }))
    .filter(
      (seed): seed is { family: string; score: number } => seed.family !== null,
    )
    .toSorted((a, b) => b.score - a.score || a.family.localeCompare(b.family))
    .slice(0, Math.min(Math.max(k, 1), seeds.length));
  const tally = new Map<string, number>();
  for (const neighbour of usable)
    tally.set(neighbour.family, (tally.get(neighbour.family) ?? 0) + 1);
  const sorted = tallySorted(tally);
  const best = sorted[0];
  const agreement = usable.length > 0 && best ? best[1] / usable.length : 0;
  return {
    predicted: best !== undefined && agreement >= minAgreement ? best[0] : null,
    agreement: Math.round(agreement * 100) / 100,
    ungatedFamily: best?.[0] ?? null,
    top2: sorted.slice(0, 2).map(([label]) => label),
  };
}

/** Artist-disjoint LOO (Sturm's "horse" control, research review F2/0.2):
 *  the same harness, but any neighbour sharing the held-out row's artist
 *  is excluded from the vote. If agreement holds, the kNN reads AUDIO;
 *  if it collapses, the tower fingerprinted artists/metadata and every
 *  plain-LOO number is inflated. Pure, like evalLeaveOneOut. */
export function evalLeaveOneOutArtistDisjoint(
  seeds: GenreSeed[],
  artists: Map<string, string>,
  k = 5,
  minAgreement = 0.6,
  durationGuard: { videoId: string; durationS: number | null }[] = [],
): EvalSummary {
  const inBand = evalDurationBand(durationGuard);
  const pop = seeds.filter(
    (s) => genreFamily(s.genre) !== null && inBand(s.videoId),
  );
  const artistOf = (id: string): string => artists.get(id) ?? "";
  const summary: EvalSummary = newEvalSummary(pop.length);
  let ungatedAgree = 0;
  for (let i = 0; i < pop.length; i++) {
    const held = pop[i]!;
    const family = genreFamily(held.genre)!;
    const heldArtist = artistOf(held.videoId);
    // the one difference from evalLeaveOneOut: same-artist seeds cannot vote
    const rest = pop.filter(
      (s, j) =>
        j !== i &&
        s.vec.length === held.vec.length &&
        artistOf(s.videoId) !== heldArtist,
    );
    const vote = scoreDisjointVote(rest, held.vec, k, minAgreement);
    if (vote.predicted === null) summary.refused++;
    else if (vote.predicted === family) summary.agree++;
    else summary.disagree++;
    if (vote.ungatedFamily === family) ungatedAgree++;
    summary.rows.push({
      videoId: held.videoId,
      family,
      predicted: vote.predicted,
      agreement: vote.agreement,
      top2: vote.top2,
    });
  }
  return closeEvalSummary(summary, pop.length, ungatedAgree);
}
