// db/ledger-reader.ts — the shared base for read-only windows into
// the megadj archive DB's ledgers (shelf_sweeps, hygiene_findings, …),
// plus the two single-query concrete readers (DumpReader, ShelfSweepReader)
// that were previously separate files (#320 fold — 3 files → 1).
//
// A dedicated readonly Database per ledger (not ATTACH — SQLCipher-free
// plain sqlite attach in bun is per-connection) is simpler and can never
// write the archive. Guarded once, here: a missing/corrupt/old-schema
// archive DB degrades to empty results — never throws, never 500s the
// API route the subclass feeds (regression-covered by each subclass).
import { Database } from "bun:sqlite";
import { errMessage } from "../../shared/leaf/fmt";
import type { DumpRecord, DumpCensus } from "../shared/dump";
import { computeDumpCensus, hydrateDumpRow } from "../../core/dump-ledger";

export abstract class ArchiveLedgerReader {
  private db: Database | null = null;
  private tried = false;

  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

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
      console.error(`${this.label}: archive DB unavailable at ${this.path}`, errMessage(e));
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
      console.error(`${this.label}: ledger query failed`, errMessage(e));
      return [];
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.tried = false;
  }
}

// ---------- DumpReader (was tools/dump-reader.ts) ----------------------------

interface DumpRow {
  folder: string;
  source_folder: string;
  status: string;
  ingested: number;
  duplicates: number;
  pending: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export class DumpReader extends ArchiveLedgerReader {
  protected readonly label = "intake-dumps";

  census(limit = 50): DumpCensus {
    const rows = this.query<DumpRow>(
      "SELECT * FROM intake_dumps ORDER BY updated_at DESC LIMIT ?",
      String(limit),
    );
    const dumps: DumpRecord[] = rows.map(hydrateDumpRow);
    return { dumps, counts: computeDumpCensus(dumps) };
  }
}

// ---------- ShelfSweepReader (was tools/shelf-sweep-reader.ts) ---------------

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

export class ShelfSweepReader extends ArchiveLedgerReader {
  protected readonly label = "shelf-sweeps";

  /** Latest sweep per drive name. Empty map when the ledger is unavailable. */
  latestPerDrive(): Map<string, ShelfSweepSummary> {
    const out = new Map<string, ShelfSweepSummary>();
    const rows = this.query<Omit<ShelfSweepSummary, "ageDays">>(
      `SELECT s.drive, s.verdict, s.files_seen, s.copied, s.preserved,
              s.started_at, s.finished_at
       FROM shelf_sweeps s
       JOIN (SELECT drive, MAX(id) AS id FROM shelf_sweeps GROUP BY drive) m
         ON s.drive = m.drive AND s.id = m.id`,
    );
    for (const r of rows) {
      out.set(r.drive.toUpperCase(), {
        ...r,
        ageDays: r.finished_at ? (Date.now() - Date.parse(r.finished_at)) / 86_400_000 : null,
      });
    }
    return out;
  }
}
