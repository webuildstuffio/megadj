// rb-fix-paths-types.ts — the result-row types for rb-fix-paths (#42
// item 2 split): a type-only leaf so the index/ladder module and the
// command module can share the shapes without an import cycle.
import type { LiveIndex } from "./rb-fix-paths-index";

export interface RbFixRow {
  /** Decimal text preserves Rekordbox's 64-bit ID exactly across JSON. */
  id: string;
  brokenPath: string;
  /** Proposed fix — null when no live match was found (reported only). */
  fixPath: string | null;
  /** Which ladder step produced the match. */
  via: string;
}

export interface RbFixResult {
  command: "rb-fix-paths";
  mount: string;
  db: string;
  /** Total content rows in the DB. */
  total: number;
  /** Rows whose FolderPath does not exist on disk. */
  broken: number;
  /** Broken rows with a confident fix. */
  fixable: number;
  /** Broken rows with no live match (left for Missing File Manager). */
  dead: number;
  /** Rows actually rewritten (0 in dry-run). */
  applied: number;
  appliedList: string[];
  deadList: string[];
  /** Post-apply full-table re-check: rows still broken (must be 0
   *  plus the dead rows) — the whole-table check that caught the
   *  prefix-scoped verification lie. */
  stillBroken: number;
  appliedMode: boolean;
  backedUpTo: string | null;
  ok: boolean;
  /** Present only when ok is false — the visible failure reason. */
  error?: string;
}

export interface RbFixPathsOptions {
  /** Drive mount root, e.g. /Volumes/SHELF1 — master DB lives at
   *  <mount>/PIONEER/Master/master.db. */
  mount: string;
  apply?: boolean;
  yes?: boolean;
  json?: boolean;
  log?: (s: string) => void;
}

export interface RbFixPathsRuntime {
  fileExists: (path: string) => boolean;
  assertClosed: (what: string) => void;
  backup: (dbPath: string) => string;
  readRows: (dbPath: string) => [string, string][];
  buildIndex: (mount: string) => LiveIndex;
  rewrite: (
    dbPath: string,
    rows: RbFixRow[],
    log: (s: string) => void,
  ) => Promise<number>;
  sleep: (ms: number) => void;
  restore: (dbPath: string, backupPath: string) => void;
}
