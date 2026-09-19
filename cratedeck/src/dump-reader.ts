// dump_reader.ts — read-only window into the megadj archive DB's
// `intake_dumps` ledger (#20: one dump = one dated batch folder, written
// by ingest itself). Same lifecycle/degrade contract as the hygiene and
// shelf-sweeps readers: missing DB → empty answers, never a 500. The
// wire types come from shared/dump.ts (the leaf both trees import).
import type { DumpRecord, DumpCensus } from "../shared/dump";
import { ArchiveLedgerReader } from "./archive/ledger-reader";

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
    const dumps: DumpRecord[] = rows.map((r) => ({
      folder: r.folder,
      sourceFolder: r.source_folder,
      status: r.status === "partial" ? "partial" : "done",
      ingested: r.ingested,
      duplicates: r.duplicates,
      pending: r.pending,
      lastError: r.last_error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    const counts = { total: dumps.length, partial: 0, done: 0, pending: 0 };
    for (const d of dumps) {
      if (d.status === "partial") counts.partial++;
      else counts.done++;
      counts.pending += d.pending;
    }
    return { dumps, counts };
  }
}
