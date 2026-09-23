/**
 * DumpLedger — the `intake_dumps` table over the archive DB (#20).
 *
 * Every `megadj ingest` batch is ONE dump unit: the dated batch folder
 * (see src/getdat/commands/intake-folder.ts) is the natural key, so two
 * dumps ingested the same day stay distinct (different folder slugs) and
 * re-running the same dump resumes instead of duplicating. "Process dump
 * X fully" is answerable from the DB — state lives here, never markdown
 * (§4.4; the `shelf_sweeps` precedent).
 *
 * The writer is ingest itself; readers are `megadj intake-status` (CLI),
 * GET /api/intake/dumps (CrateDeck), and the MCP getdat twins — one
 * producer, derived consumers, never a hand-copied twin. The wire shapes
 * (DumpRecord/DumpCensus) live in src/deck/shared/dump.ts and are
 * re-exported here — same split as the hygiene contract.
 */
import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { DumpCensus, DumpRecord, DumpStatus } from "../deck/shared/dump";

export type { DumpCensus } from "../deck/shared/dump";

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

function hydrate(r: DumpRow): DumpRecord {
  return {
    folder: r.folder,
    sourceFolder: r.source_folder,
    status: r.status === "partial" ? "partial" : "done",
    ingested: r.ingested,
    duplicates: r.duplicates,
    pending: r.pending,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Inputs ingest reports per run. `ingested` counts files that LANDED in
 *  the archive (tagged + unchanged + artQueued — anything registered);
 *  the counters derive from the same IngestCounters the --json summary
 *  emits, so the ledger and the CLI report can never disagree. */
export interface DumpOutcome {
  folder: string;
  sourceFolder: string;
  ingested: number;
  duplicates: number;
  pending: number;
  lastError: string | null;
}

export class DumpLedger {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS intake_dumps (
        folder TEXT PRIMARY KEY,
        source_folder TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'partial',
        ingested INTEGER NOT NULL DEFAULT 0,
        duplicates INTEGER NOT NULL DEFAULT 0,
        pending INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  /** Record one ingest run's outcome. INSERT OR REPLACE keyed on the
   *  batch folder: a re-run of the same dump OVERWRITES the tallies
   *  (they are the folder's current truth) but keeps the original
   *  created_at — provenance survives; partial→done flips here. */
  record(o: DumpOutcome): void {
    const now = new Date().toISOString();
    const created = this.db
      .query("SELECT created_at FROM intake_dumps WHERE folder = ?")
      .get(o.folder) as { created_at: string } | null;
    const status: DumpStatus = o.pending > 0 ? "partial" : "done";
    this.db
      .query(
        `INSERT OR REPLACE INTO intake_dumps
         (folder, source_folder, status, ingested, duplicates, pending,
          last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        o.folder,
        o.sourceFolder,
        status,
        o.ingested,
        o.duplicates,
        o.pending,
        o.lastError,
        created?.created_at ?? now,
        now,
      );
  }

  list(limit = 50): DumpRecord[] {
    // rowid tiebreak: two records written in the same ISO millisecond
    // keep insertion order (the in-memory test case; also two dumps
    // ingested within the same second on a real run)
    const rows = this.db
      .query(
        "SELECT * FROM intake_dumps ORDER BY updated_at DESC, rowid DESC LIMIT ?",
      )
      .all(...([limit] as SQLQueryBindings[])) as DumpRow[];
    return rows.map(hydrate);
  }

  /** One dump by batch-folder name — "process dump X fully" reads here. */
  get(folder: string): DumpRecord | null {
    const r = this.db
      .query("SELECT * FROM intake_dumps WHERE folder = ?")
      .get(folder) as DumpRow | null;
    return r ? hydrate(r) : null;
  }

  census(limit = 50): DumpCensus {
    const dumps = this.list(limit);
    const counts = {
      total: dumps.length,
      partial: 0,
      done: 0,
      pending: 0,
    };
    for (const d of dumps) {
      if (d.status === "partial") counts.partial++;
      else counts.done++;
      counts.pending += d.pending;
    }
    return { dumps, counts };
  }
}
