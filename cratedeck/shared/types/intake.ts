// shared/types/intake.ts — the archive-intake wire domain (#196): the
// IntakeRun params, the #159 counter-key SSOT, the IntakeResult payload,
// and the intake folder browser shapes. Split out of the 846-line
// types.ts monolith.

/** Params of one archive-intake run (the `ingest` job kind). `folder` is
 *  the source dump the user picked (or the watcher caught); it rides the
 *  job row's mount_point slot (drive jobs carry a volume there). */
export interface IntakeRun {
  /** absolute source folder the files ingest FROM */
  folder: string;
}

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

/** One dump unit (#20): a dated batch folder with its run tallies.
 *  Mirrors src/archive/dump-ledger.ts (the writer) — derived consumers
 *  on the wire import THIS side (shared/intake.ts), never a hand twin. */
export interface DumpRecord {
  /** the dated batch folder name ("2026-09-09 new dump") — the key */
  folder: string;
  sourceFolder: string;
  status: "partial" | "done";
  ingested: number;
  duplicates: number;
  /** broken/tag-write/skip tail — a re-run resumes these */
  pending: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Wire shape of GET /api/intake/dumps — the dumps strip's census. */
export interface IntakeDumpsResponse {
  dumps: DumpRecord[];
  counts: { total: number; partial: number; done: number; pending: number };
}
