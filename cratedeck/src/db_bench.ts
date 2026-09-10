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

  /** Record a minimal speed probe. Stored in the same benchmarks table with
   *  rand4k_mbps = NULL so history/average treat it as seq-only — one store,
   *  no parallel table to keep in sync. */
  addSpeedProbe(driveId: string, mbps: number, bytesRead: number): void {
    this.sqlite
      .query(
        "INSERT INTO benchmarks (drive_id, ran_at, seq_mbps, rand4k_mbps) VALUES (?,?,?,NULL)",
      )
      .run(driveId, Date.now(), mbps);
    void bytesRead; // kept in the job result_json; table stays 4-column
  }

  /** Speed-probe history (seq-only rows): for the Health tab average + trend. */
  speedProbes(driveId: string): { ran_at: number; mbps: number }[] {
    return this.sqlite
      .query(
        "SELECT ran_at, seq_mbps AS mbps FROM benchmarks WHERE drive_id=? AND rand4k_mbps IS NULL ORDER BY ran_at",
      )
      .all(driveId) as { ran_at: number; mbps: number }[];
  }

  /** Biggest known file paths for a drive, from the checksum ledger (sizes
   *  are exact — recorded at hash time). Lets the speed probe read a real
   *  file WITHOUT walking the volume first: on a 4TB exFAT shelf the walk
   *  dominates a minimal probe by orders of magnitude. */
  ledgerBiggest(driveId: string, limit: number): string[] {
    return (
      this.sqlite
        .query<{ path: string }, [string, number]>(
          `SELECT path FROM ledger WHERE drive_id=? AND size IS NOT NULL
           ORDER BY size DESC LIMIT ?`,
        )
        .all(driveId, limit) ?? []
    ).map((r) => r.path);
  }

  /** Same idea against the fleet manifest (populated by every scan — wider
   *  coverage than the checksum ledger, which only a checksum job fills). */
  manifestBiggest(driveId: string, limit: number): string[] {
    return (
      this.sqlite
        .query<{ path: string }, [string, number]>(
          `SELECT path FROM fleet_manifest WHERE drive_id=?
           ORDER BY bytes DESC LIMIT ?`,
        )
        .all(driveId, limit) ?? []
    ).map((r) => r.path);
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
