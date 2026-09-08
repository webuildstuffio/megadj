// db_ledger.ts — D30 archive-integrity ledger helpers (extracted from
// db.ts at the file-length guard). Thin queries over the CrateDeck-side
// `archive_ledger` table (known-good blake2b hashes, mirroring the
// drive-side checksum ledger pattern); the table itself is created by
// db.ts's migrations.

import type Database from "bun:sqlite";
import type { LedgerRow } from "./archive_sweep";

/** v5 migration (D30 corruption memory): archive_ledger rows must survive
 *  a hash divergence with their reference intact — `flagged_at` marks the
 *  divergence, `known_good_blake2b`/`known_good_size_bytes` preserve the
 *  last trusted fingerprint so later sweeps keep re-reporting the file
 *  AND can detect "restored" when the trusted bytes come back. Lives here
 *  (not db.ts) so the ledger schema and its queries stay one module. */
export function migrateArchiveLedger(sqlite: Database): void {
  const cols = sqlite
    .query<{ name: string }, []>("PRAGMA table_info(archive_ledger)")
    .all()
    .map((c) => c.name);
  if (!cols.length) return; // fresh DB — SCHEMA_V1 already has the columns
  for (const [c, t] of [
    ["flagged_at", "INTEGER"],
    ["known_good_blake2b", "TEXT"],
    ["known_good_size_bytes", "INTEGER"],
  ] as const) {
    if (!cols.includes(c))
      sqlite.exec(`ALTER TABLE archive_ledger ADD COLUMN ${c} ${t}`);
  }
}

export class LedgerQueries {
  constructor(private sqlite: Database) {}

  /** All known-good archive hashes (file_path → row). */
  all(): Map<string, LedgerRow> {
    const rows = this.sqlite
      .query<
        {
          file_path: string;
          size_bytes: number | null;
          blake2b: string;
          checked_at: number;
          flagged_at: number | null;
          known_good_blake2b: string | null;
          known_good_size_bytes: number | null;
        },
        []
      >(
        `SELECT file_path, size_bytes, blake2b, checked_at, flagged_at,
                known_good_blake2b, known_good_size_bytes
         FROM archive_ledger`,
      )
      .all();
    return new Map(
      rows.map((r) => [
        r.file_path,
        {
          file_path: r.file_path,
          size_bytes: r.size_bytes,
          blake2b: r.blake2b,
          checked_at: r.checked_at,
          flagged_at: r.flagged_at,
          known_good_blake2b: r.known_good_blake2b,
          known_good_size_bytes: r.known_good_size_bytes,
        },
      ]),
    );
  }

  /** Record/refresh one fingerprint (upsert). Straight set: the sweep
   *  computes the row's full desired state each run (it preserves the
   *  flag timestamp + known-good pair in JS), so there is nothing to
   *  COALESCE — divergence re-records flag + trusted pair, restore
   *  clears them, first sighting baselines with NULLs. */
  upsert(row: LedgerRow): void {
    this.sqlite
      .query(
        `INSERT INTO archive_ledger (file_path, size_bytes, blake2b, checked_at,
                                     flagged_at, known_good_blake2b, known_good_size_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET
           size_bytes = excluded.size_bytes,
           blake2b = excluded.blake2b,
           checked_at = excluded.checked_at,
           flagged_at = excluded.flagged_at,
           known_good_blake2b = excluded.known_good_blake2b,
           known_good_size_bytes = excluded.known_good_size_bytes`,
      )
      .run(
        row.file_path,
        row.size_bytes,
        row.blake2b,
        row.checked_at,
        row.flagged_at,
        row.known_good_blake2b,
        row.known_good_size_bytes,
      );
  }
}
