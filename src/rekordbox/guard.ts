/**
 * One seam for every rekordbox master-DB mutation (AGENTS.md: "Every
 * master.db write must hard-gate on rekordbox being closed … verify with a
 * delayed re-read, not just a successful commit").
 *
 * Extracted from the hand-rolled copies in rb-import / rb-fix-paths /
 * rb-playlist (the postmortem F6 ticket): assertRbClosed, backupMaster,
 * verifyReRead. New rb-* commands import these — never re-roll pgrep/backup
 * logic locally.
 *
 * DB opening rule (from the Sep 13 F4 spike): an RB7 master.db is
 * SQLCipher-encrypted; open it with pyrekordbox using either
 * `Rekordbox6Database(path=<db>, key=deobfuscate(BLOB))` or let the lib
 * read the key itself. Never sqlite3 a master.db directly.
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { rbPythonFile } from "./rb-command-kit.js";

/** True while the rekordbox app is running (its live WAL silently
 *  overwrites external DB edits on quit — never write while open). */
export function rekordboxRunning(): boolean {
  return spawnSync("pgrep", ["-x", "rekordbox"]).status === 0;
}

/** Hard gate: throw unless rekordbox is quit. Every DB mutation calls this
 *  immediately before its write spawn (not just at command start) so the
 *  window between check and write stays small. */
export function assertRbClosed(what: string): void {
  if (rekordboxRunning())
    throw new Error(
      `rekordbox is running — quit it before ${what} (live WAL overwrites external edits on quit)`,
    );
}

/** Shared backup timestamp: `YYYYMMDDTHHMMSS` UTC, sortable, filename-safe.
 *  One stamp format for EVERY dated backup of the master DB family —
 *  guard.ts and rb-adopt.ts used to stamp with two different formats (#83). */
export function backupStamp(at: Date = new Date()): string {
  return at.toISOString().replaceAll(/[-:]/gu, "").slice(0, 15);
}

/** Dated backup of the master DB (+ WAL/SHM siblings) next to the original.
 *  Returns the backup path. Throws if the DB is missing. */
export function backupMaster(dbPath: string): string {
  if (!existsSync(dbPath)) throw new Error(`no master DB at ${dbPath}`);
  const dest = `${dbPath}.bak-${backupStamp()}`;
  copyFileSync(dbPath, dest);
  for (const side of ["-wal", "-shm"]) {
    if (existsSync(dbPath + side)) copyFileSync(dbPath + side, dest + side);
  }
  return dest;
}

function restoreFileAtomic(source: string, destination: string): void {
  const temporary = `${destination}.restore-${process.pid}-${crypto.randomUUID()}`;
  try {
    copyFileSync(source, temporary);
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Atomically restore a master DB and its WAL/SHM family from backup. */
export function restoreMasterBackup(
  dbPath: string,
  backupPath: string,
  what = "restoring the master DB backup",
): void {
  assertRbClosed(what);
  if (!existsSync(backupPath))
    throw new Error(`master DB backup not found at ${backupPath}`);
  restoreFileAtomic(backupPath, dbPath);
  for (const side of ["-wal", "-shm"]) {
    const destination = dbPath + side;
    rmSync(destination, { force: true });
    if (existsSync(backupPath + side))
      restoreFileAtomic(backupPath + side, destination);
  }
}

export interface ReReadVerify {
  /** Rows re-read successfully (DB opened a second time, fresh process). */
  total: number;
  /** Rows failing the caller's per-row predicate — must be 0. */
  failures: string[];
}

/**
 * Delayed re-read verification: open the DB in a fresh python process and
 * apply `predicate` (a python boolean expression over the row dict `r`) to
 * every row of `table`. A successful COMMIT is not proof — the re-read is.
 *
 * `predicate` example (cue kind gate): `r["Kind"] == 1`.
 */
export function verifyReRead(
  dbPath: string,
  table: string,
  predicate: string,
  timeoutMs = 120_000,
): ReReadVerify {
  const r = rbPythonFile({
    file: "verify-reread.py",
    args: [dbPath, table, predicate],
    timeoutMs,
  });
  if (r.status !== 0 || !r.stdout)
    throw new Error(
      `re-read verify failed (exit ${String(r.status)}): ${(r.stderr ?? "").slice(-300)}`,
    );
  const line = r.stdout.trim().split("\n").pop() ?? "{}";
  const parsed = JSON.parse(line) as ReReadVerify;
  return { total: parsed.total, failures: parsed.failures };
}
void verifyReRead;

/** stat helper that never throws — for row-exists checks in verify passes. */
export function fileExistsSafe(p: string | null | undefined): boolean {
  if (!p) return false;
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Wait for the delayed re-read window (RB writes settle asynchronously on
 *  ExFAT); sleep helper so callers don't hand-roll timers. */
export function sleepSync(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)]);
}

/** Standard pre-write sequence used by every rb-* command: closed-check +
 *  backup + tiny settle delay. Returns the backup path. Kept internal for
 *  now — rb-cues/rb-dedup/rb-playlist-reconcile call the pieces directly
 *  because each interleaves its own probe spawns between the gates. */
function prepareMasterWrite(dbPath: string, what: string): string {
  assertRbClosed(what);
  const backup = backupMaster(dbPath);
  sleepSync(250);
  return backup;
}
void prepareMasterWrite;
