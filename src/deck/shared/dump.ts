/**
 * Dump types on the wire — the shared contract for #20's dump census.
 * DEFINED here (the hygiene.ts pattern: a leaf both trees import) and
 * re-exported by src/core/dump-ledger.ts so the engine reads one
 * namespace. `src` side owns the SQLite seam; this side owns the wire.
 */

/** dump.status — partial means a re-runnable failure tail exists (zip
 *  holds, skips, broken files); done means nothing pending. A re-ingest
 *  of a done dump is a safe no-op that only bumps updated_at. */
export type DumpStatus = "partial" | "done";

export interface DumpRecord {
  /** the dated batch folder name ("2026-09-09 new dump") — the natural key */
  folder: string;
  sourceFolder: string;
  status: DumpStatus;
  ingested: number;
  duplicates: number;
  /** broken/tag-write/skip tail — a re-run resumes these */
  pending: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DumpCensus {
  dumps: DumpRecord[];
  counts: { total: number; partial: number; done: number; pending: number };
}
