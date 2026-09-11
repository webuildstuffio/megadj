/**
 * Shelf-hygiene types — megadj side. The wire shapes (Finding, Severity,
 * status machine) are DEFINED canonically in cratedeck/shared/hygiene.ts
 * (a leaf of the import graph — web + server + engine must share one
 * contract or they drift), and re-exported here so the engine reads one
 * namespace. Engine-local types (walk token, check context) live below.
 */
export type {
  FindingKind,
  Severity,
  FindingStatus,
  ValidationReceipt,
  Finding,
} from "../../../cratedeck/shared/hygiene";

import type {
  Finding,
  FindingKind,
  Severity,
} from "../../../cratedeck/shared/hygiene";

/** One walked shelf file — the check functions' input unit. */
export interface ShelfFile {
  path: string;
  bytes: number;
  mtimeMs: number;
} /** Volume sentinel: sha1 over the walk census. Apply aborts when the
 *  CURRENT walk token differs from the one stamped on the findings —
 *  a stale apply must never move files the evidence no longer describes
 *  (trap §4.4: fresh walk before every apply). */
export function walkTokenFor(files: ShelfFile[]): string {
  const fileCount = files.length;
  let totalBytes = 0;
  let maxMtime = 0;
  for (const f of files) {
    totalBytes += f.bytes;
    if (f.mtimeMs > maxMtime) maxMtime = f.mtimeMs;
  }
  return Bun.SHA256.hash(
    new TextEncoder().encode(
      JSON.stringify({ fileCount, totalBytes, maxMtime }),
    ),
    "hex",
  ).slice(0, 24);
}

/** Everything a check's detector may read. `fp` is cache-backed
 *  (shelf_fingerprints ledger — re-runs only decode new/changed files). */
export interface CheckCtx {
  volume: string;
  /** the walk token these detections are stamped with */
  walkToken: string;
  md5(path: string): string | null;
  fp(path: string, size: number): string | null;
  /** ISO timestamp factory (injectable clock in tests) */
  now(): string;
}

/** Every check detector implements this one shape. Deterministic, ordered
 *  by priority; dedupe between checks is `paths` bookkeeping at the call
 *  site (a file claimed by byte-twin is not re-reported by acoustic-twin).
 *  Each check in ./checks annotates its export with this — the seam is
 *  compile-verified at the definition sites. */
export interface CheckDef {
  kind: FindingKind;
  defaultSeverity: Severity;
  detect(files: ShelfFile[], ctx: CheckCtx): Finding[];
}

/** The uuid generator for finding ids (crypto.randomUUID at call sites —
 *  injectable in tests via the store). */
export function newFindingId(): string {
  return crypto.randomUUID();
}
