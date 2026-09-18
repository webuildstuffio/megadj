// record-ledger.ts — THE per-track ledger plumbing (issue #74).
//
// Four archive ledgers (embeddings, track_keys, mood, cues) share one
// shape: idempotent `ON CONFLICT(video_id) DO UPDATE` upsert with a fresh
// timestamp, a read that degrades, and — the drift-critical part — the
// corrupt-JSON-reads-as-absent guard. That guard existed four times; a
// fix to one had to be remembered for the others. It now has ONE home
// (absorbParseFailure) so a poison row can never be re-interpreted
// differently by different ledgers.
//
// Subclasses keep their tables, method names, and public shapes — this
// base only owns the SQL plumbing. `archive.db` stays the pipeline
// ledger: no schema changes, no new tables.
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { errorText } from "../shared/error-text";

export class RecordLedger {
  protected readonly db: Database;
  protected readonly now: () => string;

  constructor(db: Database, now: () => string) {
    this.db = db;
    this.now = now;
  }

  /** Idempotent upsert: a re-run replaces the row with fresh values and
   * a fresh timestamp. `columns` binds positional values in order. */
  protected upsert(
    table: string,
    videoId: string,
    columns: string[],
    values: SQLQueryBindings[],
  ): void {
    const placeholders = columns.map(() => "?").join(", ");
    const updates = columns.map((c) => `${c} = excluded.${c}`).join(", ");
    this.db
      .query(
        `INSERT INTO ${table} (video_id, ${columns.join(", ")})
         VALUES (?, ${placeholders})
         ON CONFLICT(video_id) DO UPDATE SET ${updates}`,
      )
      .run(videoId, ...values);
  }

  /** One row by video id, null when never written. */
  protected row<T>(
    table: string,
    videoId: string,
    columns: string[],
  ): T | null {
    return (this.db
      .query(
        `SELECT video_id, ${columns.join(", ")} FROM ${table}
         WHERE video_id = ?`,
      )
      .get(videoId) ?? null) as T | null;
  }

  /** THE poison-row guard: a row whose payload JSON no longer parses (or
   * fails its structural check) reads as ABSENT — it degrades with its
   * context label and never throws into a query, a ranking, or a census.
   * One home so every ledger's corrupt-row contract is identical. */
  protected absorbParseFailure(
    error: unknown,
    context: string,
    warn: (message: string) => void,
  ): null {
    warn(`${context}: ${errorText(error)}`);
    return null;
  }
}
