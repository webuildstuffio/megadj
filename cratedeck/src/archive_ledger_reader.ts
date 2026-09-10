// archive_ledger_reader.ts — the shared base for read-only windows into
// the megadj archive DB's ledgers (shelf_sweeps, hygiene_findings, …).
// A dedicated readonly Database per ledger (not ATTACH — SQLCipher-free
// plain sqlite attach in bun is per-connection) is simpler and can never
// write the archive. Guarded once, here: a missing/corrupt/old-schema
// archive DB degrades to empty results — never throws, never 500s the
// API route the subclass feeds (regression-covered by each subclass).
import { Database } from "bun:sqlite";

export abstract class ArchiveLedgerReader {
  private db: Database | null = null;
  private tried = false;

  constructor(private readonly path: string) {}

  /** Subclass tag for the logged boundary (e.g. "shelf-sweeps"). */
  protected abstract readonly label: string;

  private open(): Database | null {
    if (this.tried) return this.db;
    this.tried = true;
    try {
      this.db = new Database(this.path, { readonly: true, create: false });
    } catch (e) {
      // missing/corrupt archive DB: a logged boundary + empty answers —
      // the route this feeds must answer, not fail
      console.error(
        `${this.label}: archive DB unavailable at ${this.path}`,
        e instanceof Error ? e.message : e,
      );
      this.db = null;
    }
    return this.db;
  }

  /** Run a read against the ledger; [] on unavailable DB or missing table
   *  (both are "no data yet", logged, never fatal). */
  protected query<T>(sql: string, ...params: string[]): T[] {
    const db = this.open();
    if (!db) return [];
    try {
      return db.query(sql).all(...params) as T[];
    } catch (e) {
      console.error(
        `${this.label}: ledger query failed`,
        e instanceof Error ? e.message : e,
      );
      return [];
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.tried = false;
  }
}
