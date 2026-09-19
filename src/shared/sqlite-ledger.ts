/**
 * sqlite-ledger — THE ledger-open seam (issue #72). Every SQLite ledger
 * in the repo opens through here so WAL + busy_timeout are applied in
 * exactly ONE place (state_core included). Bare `new Database(...)` opens
 * turned concurrent ledger access into spurious SQLITE_BUSY failures
 * under bun test --parallel=16 (the same resource-pressure class that
 * put retries into md5-cli), and blocked readers-during-write (hygiene
 * scans while dupescan writes fingerprints).
 *
 * WAL + busy_timeout = 5000 + synchronous = NORMAL, nothing else — no
 * schema, no migrations.
 */
import { Database } from "bun:sqlite";

export function openLedger(
  path: string,
  opts?: { create?: boolean },
): Database {
  // bun:sqlite quirk: create:false alone is an invalid flag combo
  // (SQLITE_MISUSE — flags must include READONLY or READWRITE). The bare
  // `new Database(path)` these sites replace auto-created, so default true.
  const db = new Database(path, { create: opts?.create ?? true });
  // Pragma set mirrors cratedeck/src/db/core.ts DBCore (#87 ride-along):
  // alignment by convention, NEVER a cross-package import (cratedeck/
  // shared/types.ts is the import-leaf rule). synchronous=NORMAL matches
  // DBCore's durability stance for ledger DBs; WAL + busy_timeout keep
  // parallel-suite concurrency honest.
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA synchronous = NORMAL;");
  return db;
}
