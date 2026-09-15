// state-similar.ts — I49 "sounds like" persistence + similarity math,
// split out of state.ts (file-length guard). Same ArchiveState DB, same
// ledger rules: corrupt rows read as ABSENT (never poison a ranking),
// upserts are idempotent by video_id.
import type { Database } from "bun:sqlite";
import { isFiniteNumberArray } from "../../cratedeck/shared/guards";
import { cosineSimilarity } from "../../cratedeck/shared/similarity";

export { cosineSimilarity } from "../../cratedeck/shared/similarity";

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

export class EmbeddingsLedger {
  constructor(
    private readonly db: Database,
    private readonly now: () => string,
  ) {}

  /** Upsert one embedding. Idempotent by video_id: a re-run replaces the
   * row (fresh timestamps). */
  setEmbeddingRecord(rec: {
    videoId: string;
    vec: number[];
    sourcePath: string;
  }): void {
    this.db
      .query(
        `INSERT INTO embeddings (video_id, dim, vec_json, source_path, analyzed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           dim = excluded.dim,
           vec_json = excluded.vec_json,
           source_path = excluded.source_path,
           analyzed_at = excluded.analyzed_at`,
      )
      .run(
        rec.videoId,
        rec.vec.length,
        JSON.stringify(rec.vec),
        rec.sourcePath,
        this.now(),
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
      console.error(error instanceof Error ? error.message : error);
      return null;
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
        console.error(error instanceof Error ? error.message : error);
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

/** Normalize a raw genre string into a comparable label: lowercase, first
 * comma-separated token, strip parenthetical. "Music"/"unknown"/"fixme"
 * and empty are unusable seeds (the genre column has "Music" ×99 — a
 * YouTube-tier label that must not vote). Also repairs ingestion escape
 * artifacts (`r\u0026b`-style `\uXXXX` sequences measured in the live
 * column — 19+ rows) before matching. */
export function normalizeGenre(genre: string): string | null {
  const unescaped = genre.replace(
    /\\u([0-9a-fA-F]{4})/g,
    (_match: string, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
  );
  const base = unescaped
    .toLowerCase()
    .split(",")[0]
    ?.trim()
    .replace(/\(.*?\)/g, "")
    .trim();
  if (!base || base === "music" || base === "unknown" || base === "fixme")
    return null;
  return base;
}

/** Genre FAMILIES — the vote buckets. Raw ID3 labels fragment ("house" /
 * "deep house" / "progressive house" = three never-agreeing buckets), so
 * each normalized label collapses to the family that matches what the
 * embedding space actually clusters. Null = too niche/off-genre to vote.
 * Order matters: "bass house" / "bassline" are bass-music usage, so the
 * bass family is checked BEFORE house. The final mapping is mutually
 * exclusive by construction (tested).
 *
 * 2026-09-14 additions are audit-driven (genre-audit §7): labels found
 * unmapped on the live library, each verified against the Discogs-400
 * head's audio placement — grime/jersey club/donk cluster with bass
 * music; minimal/deep-tech/hard-tekk are techno families; eurodance/
 * nightcore sit in EDM; IDM/chillwave/synthwave in mood; country in pop.
 * Junk-URL labels (djsoundtop.com) are explicitly unusable. */
const GENRE_FAMILY: [RegExp, string][] = [
  [
    /drum ?and ?bass|jungle|breakbeat|breaks|bass|dubstep|footwork|juke|grime|jersey club|donk|wall slappers/,
    "bass",
  ],
  [/(?<!bass |afro )house|disco|garage|boogie/, "house"],
  [/techno|melodic|minimal(?! \/)|deep tech|hardtekk|softtekk|tekk/, "techno"],
  [/trance|psy(?![a-z])/, "trance"],
  [/hip ?[- ]?hop|rap|trap/, "hiphop"],
  [
    /edm|electro|big ?room|future (?!bass)|hardstyle|bounce|eurodance|euro ?dance|nightcore|uptempo|hard dance|hardcore/,
    "edm",
  ],
  [
    /pop|rock|indie|alternative|punk|metal|folk|singer|country|top 40|chanson/,
    "pop",
  ],
  [
    /r ?& ?b|soul|funk|amapiano|afrobeat|afro ?house|reggaeton|latin|dancehall|reggae/,
    "groove",
  ],
  [
    /jazz|blues|ambient|downtempo|lofi|lo ?fi|classical|soundtrack|idm|chillwave|synthwave|world|spoken word|tutorial/,
    "mood",
  ],
  [/\bgroove\b/, "groove"],
  [/\bdance\b|mainstream club|loop samples|dj tools/, "edm"],
];

/** Normalized genre → vote family. Null when no family claims it. */
export function genreFamily(genre: string): string | null {
  const base = normalizeGenre(genre);
  if (!base) return null;
  for (const [re, fam] of GENRE_FAMILY) if (re.test(base)) return fam;
  return null;
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
 * (0.6 default). Deterministic: ties break alphabetically. */
export function inferGenre(
  seeds: GenreSeed[],
  queryVec: number[],
  k = 5,
  minAgreement = 0.6,
): GenreVote {
  const usable = seeds
    .map((s) => ({ ...s, family: genreFamily(s.genre) }))
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
 *  Pure: the DB read happens in the caller (`genre --eval`). */
export function evalLeaveOneOut(
  seeds: GenreSeed[],
  k = 5,
  minAgreement = 0.6,
  durationGuard: { videoId: string; durationS: number | null }[] = [],
): EvalSummary {
  const guard = new Map(durationGuard.map((d) => [d.videoId, d.durationS]));
  const inBand = (id: string): boolean => {
    const sec = guard.get(id);
    // absent from the guard map = durations unknown = guard off for this
    // row; an explicit null duration is also kept (unknown, not out-of-band)
    if (sec === undefined || sec === null) return true;
    return sec >= 90 && sec <= 480;
  };
  const pop = seeds.filter(
    (s) => genreFamily(s.genre) !== null && inBand(s.videoId),
  );
  const summary: EvalSummary = {
    evaluated: pop.length,
    agree: 0,
    disagree: 0,
    refused: 0,
    agreement: 0,
    refusal: 0,
    ungatedAgreement: 0,
    rows: [],
  };
  let ungatedAgree = 0;
  for (let i = 0; i < pop.length; i++) {
    const held = pop[i]!;
    const family = genreFamily(held.genre)!;
    const rest = pop.toSpliced(i, 1);
    const vote = inferGenre(rest, held.vec, k, minAgreement);
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
        label: genreFamily(s.genre) ?? "",
        score: cosineSimilarity(held.vec, s.vec),
      }))
      .toSorted((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, Math.min(Math.max(k, 1), rest.length));
    const tally = new Map<string, number>();
    for (const n of nn)
      if (n.label) tally.set(n.label, (tally.get(n.label) ?? 0) + 1);
    const top2 = [...tally.entries()]
      .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
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
  const gated = summary.agree + summary.disagree;
  summary.agreement = gated > 0 ? summary.agree / gated : 0;
  summary.refusal = pop.length > 0 ? summary.refused / pop.length : 0;
  summary.ungatedAgreement = pop.length > 0 ? ungatedAgree / pop.length : 0;
  return summary;
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
  const guard = new Map(durationGuard.map((d) => [d.videoId, d.durationS]));
  const inBand = (id: string): boolean => {
    const sec = guard.get(id);
    if (sec === undefined || sec === null) return true;
    return sec >= 90 && sec <= 480;
  };
  const pop = seeds.filter(
    (s) => genreFamily(s.genre) !== null && inBand(s.videoId),
  );
  const artistOf = (id: string): string => artists.get(id) ?? "";
  const summary: EvalSummary = {
    evaluated: pop.length,
    agree: 0,
    disagree: 0,
    refused: 0,
    agreement: 0,
    refusal: 0,
    ungatedAgreement: 0,
    rows: [],
  };
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
    const best = [...tally.entries()].toSorted(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    const agreement = usable.length > 0 && best ? best[1] / usable.length : 0;
    const predicted =
      best !== undefined && agreement >= minAgreement ? best[0] : null;
    if (predicted === null) summary.refused++;
    else if (predicted === family) summary.agree++;
    else summary.disagree++;
    if (best !== undefined && best[0] === family) ungatedAgree++;
    const top2 = [...tally.entries()]
      .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
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
  const gated = summary.agree + summary.disagree;
  summary.agreement = gated > 0 ? summary.agree / gated : 0;
  summary.refusal = pop.length > 0 ? summary.refused / pop.length : 0;
  summary.ungatedAgreement = pop.length > 0 ? ungatedAgree / pop.length : 0;
  return summary;
}

/**
 * Track_keys ledger — DEPRECATED shim retained only so the type stays
 * importable; the live cache implementation is ArchiveReader's
 * keyRecord/setKeyRecord (cratedeck/src/archive.ts). Do not extend here.
 */
export class KeysLedger {
  constructor(
    private readonly db: Database,
    private readonly now: () => string,
  ) {}

  /** Upsert one key. Idempotent by video_id: a re-read replaces the row. */
  setKeyRecord(rec: {
    videoId: string;
    key: string;
    sourcePath: string;
  }): void {
    this.db
      .query(
        `INSERT INTO track_keys (video_id, key, source_path, analyzed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           key = excluded.key,
           source_path = excluded.source_path,
           analyzed_at = excluded.analyzed_at`,
      )
      .run(rec.videoId, rec.key, rec.sourcePath, this.now());
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
