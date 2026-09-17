/**
 * megadj rb-dedup — fingerprint-based duplicate sweep over the master DB
 * (postmortem F2 / BUG-2). Reports pairs of content rows pointing at
 * distinct files whose audio is the same (normalized title + ±2s duration
 * as the cheap classifier, fpcalc fingerprint as the judge), keeps the
 * canonical row (file under Contents/<Artist>/ preferred), and in apply
 * mode retires loser rows + quarantines loser files.
 *
 * Default is --report (rows-only triage); --apply --yes performs DB row
 * deletion + file quarantine. File deletion is NEVER automatic — losers
 * move to <mount>/Quarantine/rb-dedup-<date>/ with a receipt.
 */

import {
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { buildDupePairs, type DupePair } from "./rb-dedup-graph.js";
import { parseScanResult, type ScanResult } from "./rb-dedup-parse.js";
import { fingerprintFileLength } from "../fulltags/fingerprint";
import { inspectMutationPaths } from "./rb-dedup-support.js";
import {
  applyConfirmed,
  applyConfirmationRefusal,
  makeFail,
  pyUvFileArgv,
} from "./rb-command-kit.js";
import { masterDbPath } from "./master-path.js";
export { pickKeeper, printRbDedupReport } from "./rb-dedup-support.js";
import {
  deleteLoserRows,
  verifyAssociationProofs,
  quarantineLosers,
  verifyRowsFresh,
  writeReceipt,
  compensate,
  type ApplyPhase,
} from "./rb-dedup-apply";
import {
  assertRbClosed,
  backupMaster,
  fileExistsSafe,
  restoreMasterBackup,
} from "./guard.js";
import { errorText } from "../shared/error-text";

export interface RbDedupOptions {
  mount: string;
  report?: boolean | undefined;
  apply?: boolean | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
  log?: (s: string) => void;
}

interface CommandResult {
  status: number | null;
  stdout: string | null;
  stderr: string | null;
}

export interface RbDedupDeps {
  assertClosed: (what: string) => void;
  backup: (dbPath: string) => string;
  spawn: (
    command: string,
    args: string[],
    options: { encoding: "utf8"; timeout: number },
  ) => CommandResult;
  fingerprint: (path: string) => string | null;
  fileExists: (path: string) => boolean;
  realpath: (path: string) => string;
  mkdir: (path: string) => void;
  rename: (from: string, to: string) => void;
  writeFile: (path: string, data: string) => void;
  remove: (path: string) => void;
  restore: (dbPath: string, backupPath: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

const defaultDeps: RbDedupDeps = {
  assertClosed: assertRbClosed,
  backup: backupMaster,
  spawn: (command, args, options) => spawnSync(command, args, options),
  fingerprint: fingerprintFileLength,
  fileExists: fileExistsSafe,
  realpath: realpathSync,
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  rename: renameSync,
  writeFile: writeFileSync,
  remove: (path) => rmSync(path, { force: true }),
  restore: restoreMasterBackup,
  sleep: Bun.sleep,
  now: () => new Date(),
};

export interface RbDedupResult {
  command: "rb-dedup";
  db: string;
  /** content rows scanned */
  scanned: number;
  /** dupe pairs found */
  pairs: DupePair[];
  /** rows deleted in apply mode */
  removed: number;
  /** files quarantined in apply mode */
  quarantined: string[];
  /** files whose loser row was deleted but file was already gone */
  missingFiles: string[];
  appliedMode: boolean;
  backedUpTo: string | null;
  ok: boolean;
  error?: string;
}

export { buildDupePairs, type DupePair } from "./rb-dedup-graph.js";
export {
  parseDeleteResult,
  parseScanResult,
  type ScanPair,
} from "./rb-dedup-parse.js";

export async function rbDedup(
  opts: RbDedupOptions,
  dependencyOverrides: Partial<RbDedupDeps> = {},
): Promise<RbDedupResult> {
  const deps: RbDedupDeps = { ...defaultDeps, ...dependencyOverrides };
  const dbPath = masterDbPath(opts.mount);
  const apply = applyConfirmed(opts);

  const fail = makeFail((msg: string): RbDedupResult => ({
    command: "rb-dedup",
    db: dbPath,
    scanned: 0,
    pairs: [],
    removed: 0,
    quarantined: [],
    missingFiles: [],
    appliedMode: apply,
    backedUpTo: null,
    ok: false,
    error: msg,
  }));

  if (applyConfirmationRefusal(opts) !== null)
    return fail(applyConfirmationRefusal(opts) ?? "unreachable");
  try {
    deps.assertClosed("rb-dedup");
  } catch (e) {
    return fail((e as Error).message);
  }

  const r = deps.spawn(
    "uv",
    pyUvFileArgv({ file: "dedup-scan.py", args: [dbPath] }),
    { encoding: "utf8", timeout: 300_000 },
  );
  if (r.status !== 0 || !r.stdout)
    return fail(
      `scan failed (exit ${String(r.status)}): ${(r.stderr ?? "").slice(-300)}`,
    );
  let out: ScanResult;
  try {
    out = parseScanResult(r.stdout.trim().split("\n").pop() ?? "");
  } catch (error) {
    return fail(errorText(error));
  }
  const unique = buildDupePairs(out.pairs, deps.fingerprint);

  const mutationErrors: string[] = [];
  const applyPhase: ApplyPhase = {
    removed: 0,
    quarantined: [],
    missingFiles: [],
    backedUpTo: null,
    errors: [],
  };
  if (apply && unique.length) {
    const pathInspection = inspectMutationPaths(
      opts.mount,
      unique,
      deps.realpath,
    );
    if (pathInspection.errors.length)
      return fail(`unsafe mutation paths: ${pathInspection.errors.join("; ")}`);
    try {
      deps.assertClosed("rb-dedup --apply backup");
    } catch (error) {
      return fail(errorText(error));
    }
    try {
      applyPhase.backedUpTo = deps.backup(dbPath);
    } catch (error) {
      return fail(`backup failed: ${errorText(error)}`);
    }

    // 1. merge associations, then delete loser rows (one transaction/pair).
    const del = deleteLoserRows(deps, dbPath, unique, mutationErrors);
    if (del) {
      verifyAssociationProofs(unique, del, mutationErrors);
      const removedIds = new Set(del.removedIds);
      applyPhase.removed = removedIds.size;
      if (del.errors.length)
        mutationErrors.push(
          `row deletion errors: ${del.errors.map(([i, e]) => `${i}: ${e}`).join(", ")}`,
        );

      // 2. quarantine loser files (never delete) — EXCEPT same-path pairs,
      // where both rows point at ONE file the keeper still uses.
      const { moves, qdir, stamp } = quarantineLosers(
        deps,
        opts,
        unique,
        removedIds,
        pathInspection.sharedLoserIds,
        mutationErrors,
        applyPhase.missingFiles,
        applyPhase.quarantined,
      );

      // 3. post-write verification: a successful subprocess is not proof.
      // Wait briefly, then read the affected content rows from a new
      // pyrekordbox process and compare the complete requested loser/keeper
      // set against disk reality.
      await deps.sleep(250);
      const verifyRows = verifyRowsFresh(
        deps,
        dbPath,
        unique,
        del,
        mutationErrors,
      );
      if (verifyRows) {
        const rowById = new Map(verifyRows.map((row) => [row.id, row]));
        applyPhase.removed = unique.filter(
          (pair) => !rowById.has(pair.loseId),
        ).length;
      }

      // 4. receipt — part of the successful mutation contract.
      const { receipt, attempted } = writeReceipt(
        deps,
        unique,
        removedIds,
        applyPhase.removed,
        applyPhase.quarantined,
        stamp,
        qdir,
        mutationErrors,
      );

      // 5. compensation on any mutation error.
      if (mutationErrors.length > 0) {
        const undone = compensate(
          deps,
          dbPath,
          applyPhase.backedUpTo,
          moves,
          applyPhase.quarantined,
          receipt,
          attempted,
          applyPhase.removed,
          mutationErrors,
        );
        applyPhase.removed = undone.removed;
        applyPhase.quarantined = undone.quarantined;
      }
    }
  }

  const result: RbDedupResult = {
    command: "rb-dedup",
    db: dbPath,
    scanned: out.scanned,
    pairs: unique,
    removed: applyPhase.removed,
    quarantined: applyPhase.quarantined,
    missingFiles: applyPhase.missingFiles,
    appliedMode: apply,
    backedUpTo: applyPhase.backedUpTo,
    ok: mutationErrors.length === 0,
  };
  if (mutationErrors.length) result.error = mutationErrors.join("; ");
  return result;
}
