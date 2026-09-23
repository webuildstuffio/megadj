// dump_reader.ts — read-only window into the megadj archive DB's
// `intake_dumps` ledger (#20: one dump = one dated batch folder, written
// by ingest itself). Same lifecycle/degrade contract as the hygiene and
// shelf-sweeps readers: missing DB → empty answers, never a 500. The
// wire types come from shared/dump.ts (the leaf both trees import).
import type { DumpRecord, DumpCensus } from "../shared/dump";
import { ArchiveLedgerReader } from "../db/ledger-reader";
import { hydrateDumpRow } from "../../core/dump-ledger";

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
    const counts = { total: dumps.length, partial: 0, done: 0, pending: 0 };
    for (const d of dumps) {
      if (d.status === "partial") counts.partial++;
      else counts.done++;
      counts.pending += d.pending;
    }
    return { dumps, counts };
  }
}
