// shared/types/intake.ts — the archive-intake wire domain (#196): the
// IntakeRun params, the #159 counter-key SSOT, the IntakeResult payload,
// and the intake folder browser shapes. Split out of the 846-line
// types.ts monolith.

/** THE ingest-counter key list (issue #159) — the runtime SSOT for the
 *  `megadj ingest --json` counter surface, living in this import leaf so
 *  BOTH packages derive from one body (the errorText/fmt.ts precedent):
 *
 *  - megadj's producer (src/getdat/commands/ingest.ts) builds its summary
 *    with `satisfies Record<IntakeCounterKey, number>` — a key added here
 *    fails megadj's typecheck until the producer supplies it;
 *  - cratedeck's parseIngestSummary and the web isIntakeResult guard
 *    iterate this array — no hand-copied key lists anywhere;
 *  - src/json-summary.test.ts pins the emitted keys to it at runtime.
 *
 *  Order is display order (IntakeTab stat cells follow it). `writeFailed`
 *  (tag-write failures, files left in place) predates this list on the
 *  emit side — the parser simply never read it; now it round-trips. */
export const INTAKE_COUNTER_KEYS = [
  "files",
  "tagged",
  "artAdded",
  "artQueued",
  "wavConverted",
  "folderDupes",
  "archiveDupes",
  "upgrades",
  "broken",
  "compatRejected",
  "compatHires",
  "shortSkipped",
  "unchanged",
  "writeFailed",
] as const;

export type IntakeCounterKey = (typeof INTAKE_COUNTER_KEYS)[number];

/** Result payload (job.result_json) of a finished ingest run — mirrors
 *  megadj ingest's --json summary plus the audit verdict leg. */
export interface IntakeResult extends Record<IntakeCounterKey, number> {
  /** post-ingest archive audit totals (the verify leg) */
  audit: { total: number; complete: number } | null;
  auditErrors: { file: string; missing: string }[];
}

/** One folder GET /api/intake/folders offers as a one-click intake source
 *  (the absolute-path allowlist the start route enforces). */
export interface IntakeCandidate {
  path: string;
  exists: boolean;
  /** file count visible at the top level (cheap readdir, not a walk) */
  files: number;
  label: string;
}

/** Wire shape of GET /api/intake/folders. */
export interface IntakeFoldersResponse {
  watch: string;
  candidates: IntakeCandidate[];
}

// The dump wire shapes are DERIVED from the owning leaf (#262): the one
// declaration of DumpRecord + the dump census shape lives in
// src/deck/shared/dump.ts (the contract src/core/dump-ledger.ts
// writes and src/deck/dump-reader.ts reads). This module re-exports
// them for the barrel/web — a second hand-copied interface here would
// compile fine and drift silently the day the ledger adds a field; the
// colocated intake.test.ts census fails the build on any redeclaration.
/** Wire shape of GET /api/intake/dumps — the dumps strip's census. Its
 *  `dumps` rows are the leaf's DumpRecord (the web strip imports that
 *  straight from ../dump — knip-pinned so the re-export can't rot back). */
export type { DumpCensus as IntakeDumpsResponse } from "../dump";
