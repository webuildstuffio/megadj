// storage.ts — the storage + ledger-freshness probe behind
// `megadj status` (#251): state-dir growth and sync staleness visible
// in one command, derived from the filesystem AT CALL TIME (no cached
// twins, no ledgers-swept-under-the-rug numbers).
//
// Read-only by contract: sweeping stays in `tmp-purge`; this module
// never deletes, moves, or writes anything.
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ArchiveState } from "../core/state";
import { resolveShelfVolume } from "./volume";

export interface StorageFreshness {
  stateDirBytes: number;
  archiveDbBytes: number | null;
  backupCount: number;
  oldestBackupAgeDays: number | null;
  tmpFixtureDirs: number;
  shelfMounted: boolean;
  shelfVolume: string;
}

export interface SourceFreshness {
  source: string;
  lastSyncAt: string | null;
  ageDays: number | null;
  stale: boolean;
}

export interface StorageReport {
  storage: StorageFreshness;
  ledgerFreshness: SourceFreshness[];
  anyStale: boolean;
  shelfWarning: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** >7d without a sync for a cohort = stale (the LL 27-day freeze class). */
const STALE_AFTER_DAYS = 7;
/** Same fixture prefixes tmp-purge sweeps (one definition — imported). */
import { FIXTURE_PREFIXES } from "../shelf/tmp-purge";

/** Recursive byte size — the same walk tmp-purge uses for its report. */
function treeBytes(path: string): number {
  let total = 0;
  try {
    const st = statSync(path);
    if (!st.isDirectory()) return st.size;
    for (const entry of readdirSync(path)) {
      total += treeBytes(join(path, entry));
    }
  } catch {
    return total;
  }
  return total;
}

function ageDaysOf(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / DAY_MS;
}

/** Count fixture-prefixed dirs at ONE tmp root. */
function countPrefixed(root: string): number {
  let n = 0;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (FIXTURE_PREFIXES.some((p) => name.startsWith(p))) n++;
  }
  return n;
}

/**
 * The whole storage + freshness block, measured live.
 *
 * - `dbPath` comes from the state itself (its construction path) — the
 *   probe reads the ledger location from the state, never re-derives an
 *   env/config twin that could diverge.
 * - `shelfMounted` is a real volume probe; an unmounted shelf is the
 *   human report's warning line, not a silent false.
 */
export function storageReport(
  state: ArchiveState,
  opts: { tmpdirFn?: () => string; fallbackTmp?: string } = {},
): StorageReport {
  const dbPath = state.dbPath;
  const dbDir = dbPath.substring(0, dbPath.lastIndexOf("/")) || ".";

  // ---- state dir tier ----
  let stateDirBytes = 0;
  let archiveDbBytes: number | null = null;
  let backupCount = 0;
  let oldestBackupMtime = Number.POSITIVE_INFINITY;
  let haveBackup = false;
  if (existsSync(dbDir)) {
    stateDirBytes = treeBytes(dbDir);
    try {
      const dbStat = statSync(dbPath);
      archiveDbBytes = dbStat.size;
    } catch {
      archiveDbBytes = null;
    }
    let names: string[] = [];
    try {
      names = readdirSync(dbDir);
    } catch {
      names = [];
    }
    for (const name of names) {
      // Backup classes mirror tmp-purge's backupClass family shapes
      // (dated backups beside the live DB).
      const isBackup =
        /^archive\.db\.(bak-\d{8}-\d{6})/.test(name) ||
        /^archive\.db\.pre-restore-\d{8}-\d{6}\.bak/.test(name) ||
        /^archive_bak_[\d-]+T[\d-]+Z\.db/.test(name) ||
        /^archive-db-before-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.db$/.test(name);
      if (!isBackup) continue;
      backupCount++;
      try {
        const m = statSync(join(dbDir, name)).mtimeMs;
        if (m < oldestBackupMtime) {
          oldestBackupMtime = m;
          haveBackup = true;
        }
      } catch {
        // raced away between readdir and stat — skip
      }
    }
  }

  // ---- tmp fixture tier (both roots, like tmp-purge #254) ----
  const tmpdirFn = opts.tmpdirFn ?? (() => "/Users/nick/.tmp");
  const fallbackTmp = opts.fallbackTmp ?? "/tmp";
  let tmpFixtureDirs: number;
  try {
    tmpFixtureDirs = countPrefixed(tmpdirFn());
    if (fallbackTmp !== tmpdirFn()) {
      tmpFixtureDirs += countPrefixed(fallbackTmp);
    }
  } catch {
    tmpFixtureDirs = 0;
  }

  // ---- shelf mount probe ----
  const shelfVolume = resolveShelfVolume();
  const shelfMounted = existsSync(shelfVolume);

  // ---- ledger freshness per source cohort ----
  const bySource = state.lastSyncAtBySource();
  const ledgerFreshness: SourceFreshness[] = Object.entries(bySource)
    .map(([source, lastSyncAt]) => {
      const ageDays = ageDaysOf(lastSyncAt);
      return {
        source,
        lastSyncAt,
        ageDays: ageDays === null ? null : Math.floor(ageDays),
        stale: ageDays === null ? false : ageDays > STALE_AFTER_DAYS,
      };
    })
    .toSorted((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));

  const anyStale = ledgerFreshness.some((f) => f.stale);
  const shelfWarning = shelfMounted
    ? null
    : `shelf volume not mounted: ${shelfVolume}`;

  return {
    storage: {
      stateDirBytes,
      archiveDbBytes,
      backupCount,
      oldestBackupAgeDays: haveBackup
        ? Math.floor((Date.now() - oldestBackupMtime) / DAY_MS)
        : null,
      tmpFixtureDirs,
      shelfMounted,
      shelfVolume,
    },
    ledgerFreshness,
    anyStale,
    shelfWarning,
  };
}

/** Bytes → MB at module scope (the lint seam: a closure recreated per
 *  call was flagged consistent-function-scoping). */
const mb = (n: number | null): string =>
  n === null ? "n/a" : `${(n / 1e6).toFixed(1)} MB`;

/** Human renderer — mirrors the JSON keys so the surfaces cannot drift. */
export function printStorageReport(
  r: StorageReport,
  log: (message: string) => void,
): void {
  log("storage:");
  log(`  state dir:            ${mb(r.storage.stateDirBytes)}`);
  log(`  archive.db:           ${mb(r.storage.archiveDbBytes)}`);
  log(
    `  backups:              ${r.storage.backupCount}${
      r.storage.oldestBackupAgeDays !== null
        ? ` (oldest ${r.storage.oldestBackupAgeDays}d)`
        : ""
    }`,
  );
  log(`  tmp fixture dirs:     ${r.storage.tmpFixtureDirs}`);
  log(
    `  shelf (${r.storage.shelfVolume}): ${r.storage.shelfMounted ? "mounted" : "NOT MOUNTED"}`,
  );
  if (r.ledgerFreshness.length > 0) {
    log("ledger freshness (per source, stale > 7d):");
    for (const f of r.ledgerFreshness) {
      const age = f.ageDays === null ? "never" : `${f.ageDays}d`;
      log(
        `  ${f.source.padEnd(20)} ${age.padStart(8)}${f.stale ? "  STALE" : ""}`,
      );
    }
  }
  if (r.shelfWarning) log(`! ${r.shelfWarning}`);
}
