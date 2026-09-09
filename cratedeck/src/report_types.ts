// report_types.ts — the leaf under report.ts: the ReportInput contract both
// halves of the report stack depend on. This file imports NOTHING (only
// shared/types.ts, itself a leaf) — it exists so report_checks.ts can type
// its builder argument without a back-edge into report.ts; a type-only
// import of ReportInput from report.ts made
// `report.ts → report_checks.ts → report.ts` a real cycle in madge
// (Sep 9 sweep).
import type { Drive, SnapshotData } from "../shared/types";

/** Everything a check builder / aggregator needs to judge one drive. */
export interface ReportInput {
  drive: Drive;
  snapshot: SnapshotData | null;
  latestVerify: { ran_at: number; ok: boolean } | null;
  bench: { ran_at: number; seq_mbps: number }[];
  ledgerFiles: number;
  ledgerStaleDays: number | null;
  masterSnapshot: SnapshotData | null;
  masterName: string;
  isMirror: boolean;
  /** Newest checksum job verdict. null = never run (≠ a clean 0). */
  latestChecksum: { ran_at: number; changed: number } | null;
}
