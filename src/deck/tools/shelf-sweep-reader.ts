// shelf_sweep_reader.ts — read-only window into the megadj archive DB's
// `shelf_sweeps` ledger (drive → shelf sweep verdicts). Lifecycle, the
// readonly-per-ledger choice (no ATTACH — SQLCipher-free plain sqlite
// attach in bun is per-connection), and the degrade-to-empty guarantee
// live in ArchiveLedgerReader; this subclass adds only the sweep query
// and its ageDays projection.
import { ArchiveLedgerReader } from "../db/ledger-reader";

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
        ageDays: r.finished_at
          ? (Date.now() - Date.parse(r.finished_at)) / 86_400_000
          : null,
      });
    }
    return out;
  }
}
