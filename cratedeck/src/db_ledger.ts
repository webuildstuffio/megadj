// db_ledger.ts — D30 archive-integrity ledger helpers (extracted from
// db.ts at the file-length guard). Thin queries over the CrateDeck-side
// `archive_ledger` table (known-good blake2b hashes, mirroring the
// drive-side checksum ledger pattern); the table itself is created by
// db.ts's migrations.

import type Database from "bun:sqlite";
import type { LedgerRow } from "./archive_sweep";

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
        },
        []
      >(`SELECT file_path, size_bytes, blake2b, checked_at FROM archive_ledger`)
      .all();
    return new Map(
      rows.map((r) => [
        r.file_path,
        {
          file_path: r.file_path,
          size_bytes: r.size_bytes,
          blake2b: r.blake2b,
          checked_at: r.checked_at,
        },
      ]),
    );
  }

  /** Record/refresh one known-good hash (upsert; sweep findings only). */
  upsert(row: LedgerRow): void {
    this.sqlite
      .query(
        `INSERT INTO archive_ledger (file_path, size_bytes, blake2b, checked_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET
           size_bytes = excluded.size_bytes,
           blake2b = excluded.blake2b,
           checked_at = excluded.checked_at`,
      )
      .run(row.file_path, row.size_bytes, row.blake2b, row.checked_at);
  }
}
