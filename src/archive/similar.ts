// state-similar.ts — I49 "sounds like" persistence + similarity math,
// split out of state.ts (file-length guard). Same ArchiveState DB, same
// ledger rules: corrupt rows read as ABSENT (never poison a ranking),
// upserts are idempotent by video_id — both contracts live in
// RecordLedger (#74), the ledgers below only own their SQL + shapes.
import { isFiniteNumberArray } from "../../cratedeck/shared/guards";
import { cosineSimilarity } from "../../cratedeck/shared/vector-space";
import { RecordLedger } from "./record-ledger";
// The genre vocabulary (normalizeGenre, familyOf, repairEscapes) lives in
// fulltags/src/genre-vocab.ts (#187 — one module owns every named map).
// This file keeps the kNN inference engine; `familyOf` is the injected
// label→family map.
import { familyOf as defaultFamilyOf } from "../fulltags/genre/genre-vocab";

export { cosineSimilarity } from "../../cratedeck/shared/vector-space";

/** Parse one persisted embedding vector. Syntactically valid JSON is not
 * enough: every downstream cosine operation requires a non-empty vector of
 * finite numbers. The caller supplies row context so corruption is
 * actionable instead of disappearing behind a cast. */
export function parseEmbeddingVector(
  vecJson: string,
  context: string,
): number[] {
  let value: unknown;
  try {
    value = JSON.parse(vecJson) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(
      `${context} has invalid vec_json: malformed JSON${detail}`,
      {
        cause: error,
      },
    );
  }
  if (!isFiniteNumberArray(value) || value.length === 0) {
    throw new Error(
      `${context} has invalid vec_json: expected a non-empty array of finite numbers`,
    );
  }
  return value;
}

export class EmbeddingsLedger extends RecordLedger {
  /** Upsert one embedding. Idempotent by video_id: a re-run replaces the
   * row (fresh timestamps) — the SQL plumbing is RecordLedger's. */
  setEmbeddingRecord(rec: {
    videoId: string;
    vec: number[];
    sourcePath: string;
  }): void {
    this.upsert(
      "embeddings",
      rec.videoId,
      ["dim", "vec_json", "source_path", "analyzed_at"],
      [rec.vec.length, JSON.stringify(rec.vec), rec.sourcePath, this.now()],
    );
  }

  /** One embedding (by video id), null when never analyzed. Corrupt JSON
   * reads as absent — a corrupt row can never poison a similarity query. */
  embeddingRecord(videoId: string): {
    videoId: string;
    vec: number[];
    sourcePath: string;
    analyzedAt: string;
  } | null {
    const row = this.db
      .query(
        `SELECT video_id, vec_json, source_path, analyzed_at
         FROM embeddings WHERE video_id = ?`,
      )
      .get(videoId) as {
      video_id: string;
      vec_json: string;
      source_path: string;
      analyzed_at: string;
    } | null;
    if (!row) return null;
    try {
      const vec = parseEmbeddingVector(
        row.vec_json,
        `embedding ${row.video_id}`,
      );
      return {
        videoId: row.video_id,
        vec,
        sourcePath: row.source_path,
        analyzedAt: row.analyzed_at,
      };
    } catch (error) {
      // THE poison-row guard (#74): one home for the whole ledger family.
      return this.absorbParseFailure(
        error,
        `embedding ${row.video_id}`,
        console.error,
      );
    }
  }

  /** All embeddings joined to their track rows (downloaded only) — the
   * query-side corpus for cosine kNN. Corrupt rows are skipped. */
  embeddingCorpus(): {
    videoId: string;
    title: string | null;
    artist: string | null;
    vec: number[];
  }[] {
    const rows = this.db
      .query(
        `SELECT e.video_id, t.title, t.artist, e.vec_json
         FROM embeddings e JOIN tracks t ON t.video_id = e.video_id
         WHERE t.status = 'downloaded'`,
      )
      .all() as {
      video_id: string;
      title: string | null;
      artist: string | null;
      vec_json: string;
    }[];
    return rows.flatMap((r) => {
      try {
        const vec = parseEmbeddingVector(r.vec_json, `embedding ${r.video_id}`);
        return [
          {
            videoId: r.video_id,
            title: r.title,
            artist: r.artist,
            vec,
          },
        ];
      } catch (error) {
        this.absorbParseFailure(
          error,
          `embedding ${r.video_id}`,
          console.error,
        );
        return [];
      }
    });
  }
}

export interface SimilarHit {
  videoId: string;
  title: string | null;
  artist: string | null;
  /** Cosine similarity 0..1 — higher is more similar. */
  score: number;
}

/** k nearest neighbours of `queryVec` within `corpus`, excluding the query
 * track itself. Pure — the DB read happens in embeddingCorpus(). */
export function similarTracks(
  corpus: {
    videoId: string;
    title: string | null;
    artist: string | null;
    vec: number[];
  }[],
  queryVideoId: string,
  queryVec: number[],
  k: number,
): SimilarHit[] {
  return corpus
    .filter(
      (c) => c.videoId !== queryVideoId && c.vec.length === queryVec.length,
    )
    .map((c) => ({
      videoId: c.videoId,
      title: c.title,
      artist: c.artist,
      score: cosineSimilarity(queryVec, c.vec),
    }))
    .toSorted((a, b) => b.score - a.score)
    .slice(0, Math.max(0, k));
}

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

/** One per-row LOO outcome — the handle the Tier-0 diagnostics and the
 *  artist-disjoint rerun consume (the aggregate summary hides the rows
 *  they need). `top2` is the vote's best-two families in rank order
 *  (ties broken alphabetically, deterministic). */
export interface LoORowOutcome {
  videoId: string;
  family: string;
  /** Gated vote result (null = the gate refused). */
  predicted: string | null;
  agreement: number;
  /** Best-two families by vote tally. */
  top2: string[];
}

/** The numeric outcome of one leave-one-out evaluation pass. `agree` is
 *  the headline family agreement (the audit's gated ≥65% target);
 *  `refusal` the split-vote share the gate declined to guess on. */
export interface EvalSummary {
  /** Evaluable family-labeled queries (the LOO denominator). */
  evaluated: number;
  /** Queries where the gated kNN vote kept the row's own family. */
  agree: number;
  /** Queries where the gated vote picked a DIFFERENT family. */
  disagree: number;
  /** Family-evaluable rows the gate refused (split vote) — honest gaps. */
  refused: number;
  /** Gated agreement share 0..1 (agree / (agree + disagree)). */
  agreement: number;
  /** Refusal share 0..1 (refused / evaluated). */
  refusal: number;
  /** Ungated (plain majority) agreement 0..1 over the same population. */
  ungatedAgreement: number;
  /** Per-row outcomes, same order as the filtered population. */
  rows: LoORowOutcome[];
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

/** Duration guard shared by both LOO harnesses (#99): absent from the
 *  map = durations unknown = guard off for this row; an explicit null
 *  duration is also kept (unknown, not out-of-band). Band: 90–480 s. */
function evalDurationBand(
  durationGuard: { videoId: string; durationS: number | null }[],
): (id: string) => boolean {
  const guard = new Map(durationGuard.map((d) => [d.videoId, d.durationS]));
  return (id: string): boolean => {
    const sec = guard.get(id);
    if (sec === undefined || sec === null) return true;
    return sec >= 90 && sec <= 480;
  };
}

/** Fresh zeroed summary shared by both LOO harnesses (#99). */
function newEvalSummary(evaluated: number): EvalSummary {
  return {
    evaluated,
    agree: 0,
    disagree: 0,
    refused: 0,
    agreement: 0,
    refusal: 0,
    ungatedAgreement: 0,
    rows: [],
  };
}

/** Closing ratios shared by both LOO harnesses (#99): gated agreement,
 *  refusal share, ungated plurality agreement. Mutates + returns. */
function closeEvalSummary(
  s: EvalSummary,
  popLen: number,
  ungatedAgree: number,
): EvalSummary {
  const gated = s.agree + s.disagree;
  s.agreement = gated > 0 ? s.agree / gated : 0;
  s.refusal = popLen > 0 ? s.refused / popLen : 0;
  s.ungatedAgreement = popLen > 0 ? ungatedAgree / popLen : 0;
  return s;
}

/** Deterministic tally ordering shared by both LOO harnesses (#99):
 *  count descending, ties alphabetical. The top-2 slice and the best
 *  lookup both need this exact rule (jscpd-flagged twin). */
function tallySorted(tally: Map<string, number>): [string, number][] {
  return [...tally.entries()].toSorted(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
}

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
    // gated plurality vote inline (the disjoint pool IS the pool: k counts
    // usable seeds, same as inferGenre's contract)
    const usable = rest
      .map((s) => ({
        family: genreFamily(s.genre),
        score: cosineSimilarity(held.vec, s.vec),
      }))
      .filter((s): s is { family: string; score: number } => s.family !== null)
      .toSorted((a, b) => b.score - a.score || a.family.localeCompare(b.family))
      .slice(0, Math.min(Math.max(k, 1), rest.length));
    const tally = new Map<string, number>();
    for (const n of usable) tally.set(n.family, (tally.get(n.family) ?? 0) + 1);
    const best = tallySorted(tally)[0];
    const agreement = usable.length > 0 && best ? best[1] / usable.length : 0;
    const predicted =
      best !== undefined && agreement >= minAgreement ? best[0] : null;
    if (predicted === null) summary.refused++;
    else if (predicted === family) summary.agree++;
    else summary.disagree++;
    if (best !== undefined && best[0] === family) ungatedAgree++;
    const top2 = tallySorted(tally)
      .slice(0, 2)
      .map(([label]) => label);
    summary.rows.push({
      videoId: held.videoId,
      family,
      predicted,
      agreement: Math.round(agreement * 100) / 100,
      top2,
    });
  }
  return closeEvalSummary(summary, pop.length, ungatedAgree);
}

/**
 * Track_keys ledger — DEPRECATED shim retained only so the type stays
 * importable; the live cache implementation is ArchiveReader's
 * keyRecord/setKeyRecord (cratedeck/src/archive.ts). Do not extend here.
 * Plumbing rides RecordLedger (#74) like every other ledger.
 */
export class KeysLedger extends RecordLedger {
  /** Upsert one key. Idempotent by video_id: a re-read replaces the row. */
  setKeyRecord(rec: {
    videoId: string;
    key: string;
    sourcePath: string;
  }): void {
    this.upsert(
      "track_keys",
      rec.videoId,
      ["key", "source_path", "analyzed_at"],
      [rec.key, rec.sourcePath, this.now()],
    );
  }

  /** Cached key (by video id), null when never cached. A cache hit is
   * only valid when the file path still matches — a moved/re-ripped file
   * invalidates its own row lazily, no sweep needed. */
  keyRecord(
    videoId: string,
    sourcePath: string,
  ): { key: string; analyzedAt: string } | null {
    const row = this.db
      .query(
        `SELECT key, analyzed_at FROM track_keys
         WHERE video_id = ? AND source_path = ?`,
      )
      .get(videoId, sourcePath) as {
      key: string;
      analyzed_at: string;
    } | null;
    return row ? { key: row.key, analyzedAt: row.analyzed_at } : null;
  }
}
