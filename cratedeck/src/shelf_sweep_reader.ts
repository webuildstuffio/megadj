// shelf_sweep_reader.ts — read-only window into the megadj archive DB's
// `shelf_sweeps` ledger (drive → shelf sweep verdicts). Read-only ATTACH is
// avoided (SQLCipher-free plain sqlite attach in bun is per-connection); a
// dedicated read-only Database is simpler and can never write the archive.
// Guarded: a missing/corrupt archive DB must degrade to `null` rows, never
// 500 the /drives list this rides on.
import { Database } from "bun:sqlite";

export interface ShelfSweepSummary {
  drive: string;
  verdict: string;
  files_seen: number;
  copied: number;
  preserved: number;
  started_at: string;
  finished_at: string | null;
  /** days since finish — drives the UI ambers on */
  ageDays: number | null;
}

export class ShelfSweepReader {
  private db: Database | null = null;
  private tried = false;

  constructor(private readonly path: string) {}

  private open(): Database | null {
    if (this.tried) return this.db;
    this.tried = true;
    try {
      this.db = new Database(this.path, { readonly: true, create: false });
    } catch (e) {
      console.error(
        `shelf-sweeps: archive DB unavailable at ${this.path}`,
        e instanceof Error ? e.message : e,
      );
      this.db = null;
    }
    return this.db;
  }

  /** Latest sweep per drive name. Empty map when the ledger is unavailable. */
  latestPerDrive(): Map<string, ShelfSweepSummary> {
    const db = this.open();
    const out = new Map<string, ShelfSweepSummary>();
    if (!db) return out;
    try {
      const rows = db
        .query(
          `SELECT s.drive, s.verdict, s.files_seen, s.copied, s.preserved,
                  s.started_at, s.finished_at
           FROM shelf_sweeps s
           JOIN (SELECT drive, MAX(id) AS id FROM shelf_sweeps GROUP BY drive) m
             ON s.drive = m.drive AND s.id = m.id`,
        )
        .all() as Array<Omit<ShelfSweepSummary, "ageDays">>;
      for (const r of rows) {
        out.set(r.drive.toUpperCase(), {
          ...r,
          ageDays: r.finished_at
            ? (Date.now() - Date.parse(r.finished_at)) / 86_400_000
            : null,
        });
      }
    } catch (e) {
      // missing table (older archive DB) = "no data", logged, not fatal
      console.error(
        "shelf-sweeps: ledger query failed",
        e instanceof Error ? e.message : e,
      );
    }
    return out;
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.tried = false;
  }
}
