// state-similar.ts — I49 "sounds like" persistence + similarity math,
// split out of state.ts (file-length guard). Same ArchiveState DB, same
// ledger rules: corrupt rows read as ABSENT (never poison a ranking),
// upserts are idempotent by video_id.
import type { Database } from "bun:sqlite";

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

// ---------- I49 cosine similarity (module fn — pure, unit-tested) ----------

/** Cosine similarity of two equal-length vectors. Returns 0 when either
 * norm is 0 (no direction — no similarity claim).
 *
 * SSOT note: cratedeck's archive-similar.ts re-implements this byte-for-byte
 * (jscpd-flagged). megadj cannot import cratedeck (cratedeck is a UI
 * workspace over megadj's output, and src/ must stay dependency-free for
 * the standalone CLI), so the duplication is sanctioned — keep the two
 * implementations in sync if either changes. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
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
