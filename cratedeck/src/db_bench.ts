// db_bench.ts — benchmark + checksum-ledger queries. Split from db.ts for
// the file-length guard; DB delegates so every call site is unchanged.
import type { Database } from "bun:sqlite";

/** Benchmarks + checksum-ledger query surface (owned by DB via delegation). */
export class BenchLedger {
  constructor(private readonly sqlite: Database) {}

  addBenchmark(driveId: string, seq: number, rand4k: number): void {
    this.sqlite
      .query(
        "INSERT OR REPLACE INTO benchmarks (drive_id, ran_at, seq_mbps, rand4k_mbps) VALUES (?,?,?,?)",
      )
      .run(driveId, Date.now(), seq, rand4k);
  }

  benchmarks(
    driveId: string,
  ): { ran_at: number; seq_mbps: number; rand4k_mbps: number }[] {
    return this.sqlite
      .query("SELECT * FROM benchmarks WHERE drive_id=? ORDER BY ran_at")
      .all(driveId) as {
      ran_at: number;
      seq_mbps: number;
      rand4k_mbps: number;
    }[];
  }

  ledgerPut(
    driveId: string,
    path: string,
    size: number,
    mtime: number,
    hash: string,
  ): void {
    this.sqlite
      .query(
        `INSERT INTO ledger (drive_id, path, size, mtime, hash, last_ok)
         VALUES (?,?,?,?,?,?) ON CONFLICT(drive_id, path)
         DO UPDATE SET size=excluded.size, mtime=excluded.mtime,
           hash=excluded.hash, last_ok=excluded.last_ok`,
      )
      .run(driveId, path, size, mtime, hash, Date.now());
  }

  ledgerGet(
    driveId: string,
    path: string,
  ): { hash: string; size: number; mtime: number } | null {
    return (
      (this.sqlite
        .query(
          "SELECT hash, size, mtime FROM ledger WHERE drive_id=? AND path=?",
        )
        .get(driveId, path) as {
        hash: string;
        size: number;
        mtime: number;
      } | null) ?? null
    );
  }

  ledgerCount(driveId: string): number {
    const r = this.sqlite
      .query("SELECT COUNT(*) AS n FROM ledger WHERE drive_id=?")
      .get(driveId) as { n: number } | null;
    return r?.n ?? 0;
  }

  /** Days since the newest ledger entry (how fresh corruption tracking is). */
  ledgerAgeDays(driveId: string): number | null {
    const r = this.sqlite
      .query("SELECT MAX(last_ok) AS t FROM ledger WHERE drive_id=?")
      .get(driveId) as { t: number | null } | null;
    return r?.t ? (Date.now() - r.t) / 86_400_000 : null;
  }
}
