// dupescan-shared.ts — the shared plumbing behind the archive dedupe
// commands (dedupe-archive + shelf-dupescan). The FpCache twin (same
// class, two table names) and the group-by-fingerprint loop were
// byte-identical across both commands until jscpd flagged them; both now
// parameterize the table name / policy through this module instead.
import { statSync, existsSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import type { Database } from "bun:sqlite";

/** Persistent fp cache — one row per file path (re-runs only decode
 *  new/changed files). Table name is the caller's concern so each
 *  command keeps its own cache namespace. */
export class DupFpCache {
  constructor(
    private db: Database,
    private table: string,
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${table} (
        path TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        fingerprint TEXT,
        computed_at TEXT NOT NULL
      )
    `);
  }
  get(path: string, size: number): string | null | undefined {
    const row = this.db
      .query(
        `SELECT fingerprint FROM ${this.table} WHERE path = ? AND size = ?`,
      )
      .get(path, size) as { fingerprint: string | null } | null;
    return row ? row.fingerprint : undefined; // undefined = not cached
  }
  put(path: string, size: number, fp: string | null): void {
    this.db
      .query(
        `INSERT INTO ${this.table} (path, size, fingerprint, computed_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(path) DO UPDATE SET size=excluded.size, fingerprint=excluded.fingerprint, computed_at=excluded.computed_at`,
      )
      .run(path, size, fp);
  }
}

/** One same-fingerprint file entry (path + size for the keeper sort). */
export interface DupFile {
  path: string;
  bytes: number;
}

/** One duplicate group: keeper = largest (caller sorts), rest = losers. */
export interface DupGroup {
  fingerprint: string;
  files: DupFile[];
  keep: string;
  reason: string;
}

/** Move one loser into quarantine. Returns true when the file moved.
 *  Quarantine collisions abort THAT file, never the run. */
export function moveLoser(
  path: string,
  qDir: string,
  errors: string[],
): boolean {
  const dest = join(qDir, basename(path));
  try {
    if (existsSync(dest)) {
      errors.push(`quarantine already has ${basename(path)} — skipped`);
      return false;
    }
    renameSync(path, dest);
    return true;
  } catch (e) {
    errors.push(`${path}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/** Group walked files by cached fingerprint (unfingerprintable → null →
 *  skipped). The >=2 "is it a dup group?" cut stays with the caller —
 *  the commands report singletons differently. */
export function groupByFingerprint(
  files: readonly string[],
  cache: DupFpCache,
): Map<string, DupFile[]> {
  const groups = new Map<string, DupFile[]>();
  for (const f of files) {
    let size = 0;
    try {
      size = statSync(f).size;
    } catch {
      continue; // vanished mid-scan
    }
    const fp = cache.get(f, size);
    if (!fp) continue;
    const arr = groups.get(fp) ?? [];
    arr.push({ path: f, bytes: size });
    groups.set(fp, arr);
  }
  return groups;
}
