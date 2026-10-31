import { isFiniteNumberArray } from "../shared/leaf/guards";
import { vecFromF32Blob, vecToF32Blob } from "../shared/leaf/vector-space";
import { RecordLedger } from "./record-ledger";

/** Parse one persisted embedding vector (#562: `vec_f32 BLOB` — raw
 * float32 bytes, not JSON). Structural validity is not enough to trust:
 * every downstream cosine operation requires a non-empty vector of
 * finite numbers. The caller supplies row context so corruption is
 * actionable instead of disappearing behind a cast. */
export function parseEmbeddingVector(vecBlob: Uint8Array | null, context: string): number[] {
  if (vecBlob === null || vecBlob.length === 0 || vecBlob.length % 4 !== 0) {
    throw new Error(`${context} has invalid vec_f32: expected a non-empty float32 byte blob`);
  }
  const vec = vecFromF32Blob(vecBlob);
  if (!isFiniteNumberArray(vec) || vec.length === 0) {
    throw new Error(`${context} has invalid vec_f32: expected a non-empty array of finite numbers`);
  }
  return vec;
}

export class EmbeddingsLedger extends RecordLedger {
  /** Upsert one embedding. Idempotent by video_id: a re-run replaces the
   * row (fresh timestamps) — the SQL plumbing is RecordLedger's.
   * M1 (#325): `model` is required on new writes (nullable in the DDL for
   * backfill, but the write seam refuses to omit it).
   * #562: hot paths read `vec_f32` (BLOB); `vec_json` stays populated for
   * the debugging tools and non-migrated readers (megaset, bench, probes). */
  setEmbeddingRecord(rec: {
    videoId: string;
    vec: number[];
    sourcePath: string;
    model: string;
  }): void {
    this.upsert(
      "embeddings",
      rec.videoId,
      ["dim", "vec_json", "vec_f32", "source_path", "analyzed_at", "model"],
      [
        rec.vec.length,
        JSON.stringify(rec.vec),
        vecToF32Blob(rec.vec),
        rec.sourcePath,
        this.now(),
        rec.model,
      ],
    );
  }

  /** One embedding (by video id), null when never analyzed. A row without
   * a readable `vec_f32` reads as absent — a corrupt row can never poison
   * a similarity query. */
  embeddingRecord(
    videoId: string,
  ): {
    videoId: string;
    vec: number[];
    sourcePath: string;
    analyzedAt: string;
    model: string | null;
  } | null {
    const row = this.db
      .query(
        `SELECT video_id, vec_f32, source_path, analyzed_at, model
         FROM embeddings WHERE video_id = ?`,
      )
      .get(videoId) as {
      video_id: string;
      vec_f32: Uint8Array | null;
      source_path: string;
      analyzed_at: string;
      model: string | null;
    } | null;
    if (!row) return null;
    try {
      const vec = parseEmbeddingVector(row.vec_f32, `embedding ${row.video_id}`);
      return {
        videoId: row.video_id,
        vec,
        sourcePath: row.source_path,
        analyzedAt: row.analyzed_at,
        model: row.model,
      };
    } catch (error) {
      // THE poison-row guard (#74): one home for the whole ledger family.
      return this.absorbParseFailure(error, `embedding ${row.video_id}`, console.error);
    }
  }

  /** All embeddings joined to their track rows (downloaded only) — the
   * query-side corpus for cosine kNN. Corrupt rows are skipped.
   * M1 (#325): when `modelFilter` is provided, only rows with that model
   * are returned — cross-model blending is an honest gap. */
  embeddingCorpus(
    modelFilter?: string,
  ): {
    videoId: string;
    title: string | null;
    artist: string | null;
    vec: number[];
    model: string | null;
  }[] {
    const whereClause =
      modelFilter !== undefined
        ? `WHERE t.status = 'downloaded' AND e.model = ?`
        : `WHERE t.status = 'downloaded'`;
    const params = modelFilter !== undefined ? [modelFilter] : [];
    const rows = this.db
      .query(
        `SELECT e.video_id, t.title, t.artist, e.vec_f32, e.model
         FROM embeddings e JOIN tracks t ON t.video_id = e.video_id
         ${whereClause}`,
      )
      .all(...params) as {
      video_id: string;
      title: string | null;
      artist: string | null;
      vec_f32: Uint8Array | null;
      model: string | null;
    }[];
    return rows.flatMap((r) => {
      try {
        const vec = parseEmbeddingVector(r.vec_f32, `embedding ${r.video_id}`);
        return [{ videoId: r.video_id, title: r.title, artist: r.artist, vec, model: r.model }];
      } catch (error) {
        this.absorbParseFailure(error, `embedding ${r.video_id}`, console.error);
        return [];
      }
    });
  }

  // ── Section embeddings ──────────────────────────────────────────────

  /** Upsert one section embedding. Compound key: (video_id, model). */
  setSectionEmbeddingRecord(rec: {
    videoId: string;
    vec: number[];
    sourcePath: string;
    model: string;
    sectionStart?: number;
    sectionEnd?: number;
  }): void {
    this.db
      .query(
        `INSERT INTO section_embeddings
           (video_id, model, dim, vec_json, vec_f32, source_path, analyzed_at,
            section_start, section_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id, model) DO UPDATE SET
           dim = excluded.dim, vec_json = excluded.vec_json,
           vec_f32 = excluded.vec_f32,
           source_path = excluded.source_path,
           analyzed_at = excluded.analyzed_at,
           section_start = excluded.section_start,
           section_end = excluded.section_end`,
      )
      .run(
        rec.videoId,
        rec.model,
        rec.vec.length,
        JSON.stringify(rec.vec),
        vecToF32Blob(rec.vec),
        rec.sourcePath,
        this.now(),
        rec.sectionStart ?? null,
        rec.sectionEnd ?? null,
      );
  }

  /** Section embedding for a video (by model), null when absent. */
  sectionEmbeddingRecord(
    videoId: string,
    model: string,
  ): { vec: number[]; sectionStart: number | null; sectionEnd: number | null } | null {
    const row = this.db
      .query(
        `SELECT vec_f32, section_start, section_end
         FROM section_embeddings WHERE video_id = ? AND model = ?`,
      )
      .get(videoId, model) as {
      vec_f32: Uint8Array | null;
      section_start: number | null;
      section_end: number | null;
    } | null;
    if (!row) return null;
    try {
      return {
        vec: parseEmbeddingVector(row.vec_f32, `sec-emb ${videoId}`),
        sectionStart: row.section_start,
        sectionEnd: row.section_end,
      };
    } catch (error) {
      this.absorbParseFailure(error, `sec-emb ${videoId}`, console.error);
      return null;
    }
  }

  /** Genre-inference corpus preferring section embeddings over whole-track.
   * For each downloaded track that has a section embedding: use that vector.
   * Fall back to the whole-track embedding for tracks without one.
   * This maximizes genre discrimination. */
  sectionPreferredCorpus(): {
    videoId: string;
    title: string | null;
    artist: string | null;
    vec: number[];
    isSection: boolean;
  }[] {
    // LEFT JOIN: section_embeddings onto embeddings; pick section when present
    const rows = this.db
      .query(
        `SELECT e.video_id, t.title, t.artist,
                COALESCE(se.vec_f32, e.vec_f32) AS vec_f32,
                CASE WHEN se.video_id IS NOT NULL THEN 1 ELSE 0 END AS is_section
         FROM embeddings e
         JOIN tracks t ON t.video_id = e.video_id
         LEFT JOIN section_embeddings se
           ON se.video_id = e.video_id AND se.model = 'effnet-discogs-1280-section-1'
         WHERE t.status = 'downloaded'`,
      )
      .all() as {
      video_id: string;
      title: string | null;
      artist: string | null;
      vec_f32: Uint8Array | null;
      is_section: number;
    }[];
    return rows.flatMap((r) => {
      try {
        return [
          {
            videoId: r.video_id,
            title: r.title,
            artist: r.artist,
            vec: parseEmbeddingVector(r.vec_f32, `corpus ${r.video_id}`),
            isSection: r.is_section === 1,
          },
        ];
      } catch (error) {
        this.absorbParseFailure(error, `corpus ${r.video_id}`, console.error);
        return [];
      }
    });
  }
}
