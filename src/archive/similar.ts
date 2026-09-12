// state-similar.ts — I49 "sounds like" persistence + similarity math,
// split out of state.ts (file-length guard). Same ArchiveState DB, same
// ledger rules: corrupt rows read as ABSENT (never poison a ranking),
// upserts are idempotent by video_id.
import type { Database } from "bun:sqlite";
import { cosineSimilarity } from "../../cratedeck/shared/similarity";

export { cosineSimilarity } from "../../cratedeck/shared/similarity";

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
    let vec: number[] = [];
    try {
      vec = JSON.parse(row.vec_json) as number[];
    } catch {
      return null;
    }
    if (!Array.isArray(vec) || vec.length === 0) return null;
    return {
      videoId: row.video_id,
      vec,
      sourcePath: row.source_path,
      analyzedAt: row.analyzed_at,
    };
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
        const vec = JSON.parse(r.vec_json) as number[];
        if (!Array.isArray(vec) || vec.length === 0) return [];
        return [
          {
            videoId: r.video_id,
            title: r.title,
            artist: r.artist,
            vec,
          },
        ];
      } catch {
        return []; // corrupt row — skip, never throw
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
 * YouTube-tier label that must not vote). */
export function normalizeGenre(genre: string): string | null {
  const base = genre
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
 * exclusive by construction (tested). */
const GENRE_FAMILY: [RegExp, string][] = [
  [
    /drum ?and ?bass|jungle|breakbeat|breaks|bass|dubstep|footwork|juke/,
    "bass",
  ],
  [/(?<!bass |afro )house|disco|garage|boogie/, "house"],
  [/techno|melodic/, "techno"],
  [/trance|psy/, "trance"],
  [/hip ?[- ]?hop|rap|trap/, "hiphop"],
  [/edm|electro|big ?room|future (?!bass)|hardstyle|bounce/, "edm"],
  [/pop|rock|indie|alternative|punk|metal|folk|singer/, "pop"],
  [
    /r ?& ?b|soul|funk|amapiano|afrobeat|afro ?house|reggaeton|latin|dancehall|reggae/,
    "groove",
  ],
  [/jazz|blues|ambient|downtempo|lofi|lo ?fi|classical|soundtrack/, "mood"],
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
