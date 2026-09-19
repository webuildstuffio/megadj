import { isFiniteNumberArray } from "../shared/leaf/guards";
import { RecordLedger } from "./record-ledger";

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
