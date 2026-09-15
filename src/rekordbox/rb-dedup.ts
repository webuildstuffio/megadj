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
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  dedupDeleteScript,
  dedupScanScript,
  dedupVerifyScript,
} from "./rb-dedup-scripts.js";
import { fingerprintFileLength } from "../../fulltags/src/exports";
import type { DupePair } from "./rb-dedup-graph.js";
import type { DeleteResult, ScanResult, VerifyRow } from "./rb-dedup-parse.js";
import { inspectMutationPaths } from "./rb-dedup-support.js";
import {
  applyConfirmed,
  applyConfirmationRefusal,
  makeFail,
  pyUvArgv,
} from "./rb-command-kit.js";
import { masterDbPath } from "./master-path.js";
export { pickKeeper, printRbDedupReport } from "./rb-dedup-support.js";
import { quarantineDest } from "../archive/hygiene/apply";
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

export {
  buildDupePairs,
  compareStableIds,
  connectGraph,
  graphComponentIds,
  type DupePair,
} from "./rb-dedup-graph.js";
export {
  finiteNonNegative,
  isUnknownArray,
  parseDeleteResult,
  parseScanResult,
  parseVerifyRows,
  type AssociationExpectation,
  type DeleteResult,
  type ScanResult,
  type ScanPair,
  type ScanRow,
  type VerifyRow,
} from "./rb-dedup-parse.js";
import { buildDupePairs } from "./rb-dedup-graph.js";
import {
  parseDeleteResult,
  parseScanResult,
  parseVerifyRows,
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
    pyUvArgv({ script: dedupScanScript(), args: [dbPath] }),
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

  let removed = 0;
  const quarantined: string[] = [];
  const missingFiles: string[] = [];
  let backedUpTo: string | null = null;
  const mutationErrors: string[] = [];

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
      backedUpTo = deps.backup(dbPath);
    } catch (error) {
      return fail(`backup failed: ${errorText(error)}`);
    }
    // 1. merge associations, then delete loser rows (one transaction/pair).
    const loseIds = unique.map((p) => p.loseId);
    const pairByLoser = new Map(unique.map((pair) => [pair.loseId, pair]));
    try {
      // The report/fingerprinting pass can take minutes. Close the race by
      // checking again at the last possible moment before the write spawn.
      deps.assertClosed("rb-dedup --apply delete");
    } catch (error) {
      return {
        ...fail(errorText(error)),
        backedUpTo,
      };
    }
    const rd = deps.spawn(
      "uv",
      pyUvArgv({
        script: dedupDeleteScript(),
        args: [
          dbPath,
          JSON.stringify(unique.map((pair) => [pair.loseId, pair.keepId])),
        ],
      }),
      { encoding: "utf8", timeout: 300_000 },
    );
    let del: DeleteResult = { removedIds: [], errors: [], associations: [] };
    if (rd.status !== 0 || !rd.stdout) {
      mutationErrors.push(
        `row deletion process failed (exit ${String(rd.status)}): ${(rd.stderr ?? "").slice(-300)}`,
      );
    } else {
      try {
        del = parseDeleteResult(
          rd.stdout.trim().split("\n").pop() ?? "",
          loseIds,
        );
      } catch (error) {
        mutationErrors.push(errorText(error));
      }
    }
    const removedIds = new Set(del.removedIds);
    removed = removedIds.size;
    if (del.errors.length)
      mutationErrors.push(
        `row deletion errors: ${del.errors.map(([i, e]) => `${i}: ${e}`).join(", ")}`,
      );
    for (const [index, loserId] of del.removedIds.entries()) {
      const expectedKeeper = pairByLoser.get(loserId)?.keepId;
      const actualKeeper = del.associations[index]?.keepId;
      if (expectedKeeper === undefined || actualKeeper !== expectedKeeper) {
        mutationErrors.push(
          `association proof mismatch for loser ${loserId}: expected keeper ${expectedKeeper ?? "unknown"}, got ${actualKeeper ?? "missing"}`,
        );
      }
    }

    // 2. quarantine loser files (never delete) — EXCEPT same-path pairs,
    // where both rows point at ONE file the keeper still uses.
    const stamp = deps.now().toISOString().slice(0, 10);
    const qdir = join(
      opts.mount.replace(/\/+$/u, ""),
      "Quarantine",
      `rb-dedup-${stamp}`,
    );
    let receipt: string | null = null;
    let receiptAttempted = false;
    const moves: { source: string; destination: string }[] = [];
    for (const p of mutationErrors.length === 0 ? unique : []) {
      // Never move a file when its loser row was not confirmed deleted.
      if (!removedIds.has(p.loseId)) continue;
      // Exact/NFC+casefold path twins and equal resolved realpaths are one
      // physical file on the target macOS/ExFAT shelf. Only retire the extra
      // DB row; moving that path would also move the keeper's bytes.
      if (pathInspection.sharedLoserIds.has(p.loseId)) continue;
      if (!deps.fileExists(p.losePath)) {
        missingFiles.push(p.losePath);
        continue;
      }
      if (p.losePath === p.keepPath) continue; // belt: never move keeper's file
      try {
        deps.mkdir(qdir);
        const dest = quarantineDest(qdir, p.losePath);
        deps.rename(p.losePath, dest);
        quarantined.push(dest);
        moves.push({ source: p.losePath, destination: dest });
      } catch (error) {
        mutationErrors.push(
          `quarantine failed for ${p.losePath}: ${errorText(error)}`,
        );
        break;
      }
    }

    // A successful subprocess is not proof. Wait briefly, then read the
    // affected content rows from a new pyrekordbox process and compare the
    // complete requested loser/keeper set against disk reality.
    let verifyRows: VerifyRow[] | null = null;
    try {
      await deps.sleep(250);
      deps.assertClosed("rb-dedup post-write verification");
      const ids = [
        ...new Set(unique.flatMap((pair) => [pair.keepId, pair.loseId])),
      ];
      const verification = deps.spawn(
        "uv",
        pyUvArgv({
          script: dedupVerifyScript(),
          args: [dbPath, JSON.stringify(ids)],
        }),
        { encoding: "utf8", timeout: 120_000 },
      );
      if (verification.status !== 0 || !verification.stdout) {
        mutationErrors.push(
          `verification read failed (exit ${String(verification.status)}): ${(verification.stderr ?? "").slice(-300)}`,
        );
      } else {
        verifyRows = parseVerifyRows(
          verification.stdout.trim().split("\n").pop() ?? "",
        );
      }
    } catch (error) {
      mutationErrors.push(`verification failed: ${errorText(error)}`);
    }
    if (verifyRows) {
      const rowById = new Map(verifyRows.map((row) => [row.id, row]));
      // The fresh DB is the source of truth even when the delete process
      // exited badly or returned malformed acknowledgements.
      removed = unique.filter((pair) => !rowById.has(pair.loseId)).length;
      const survivingLosers = unique
        .filter((pair) => rowById.has(pair.loseId))
        .map((pair) => pair.loseId);
      if (survivingLosers.length)
        mutationErrors.push(
          `loser rows still present: ${survivingLosers.join(", ")}`,
        );
      const missingKeepers = unique
        .filter((pair) => !rowById.has(pair.keepId))
        .map((pair) => pair.keepId);
      if (missingKeepers.length)
        mutationErrors.push(
          `keeper rows missing: ${missingKeepers.join(", ")}`,
        );
      const mismatchedKeepers = unique
        .filter((pair) => {
          const row = rowById.get(pair.keepId);
          return row !== undefined && row.path !== pair.keepPath;
        })
        .map((pair) => pair.keepId);
      if (mismatchedKeepers.length)
        mutationErrors.push(
          `keeper path mismatch: ${mismatchedKeepers.join(", ")}`,
        );
      const missingKeeperFiles = unique
        .filter((pair) => !deps.fileExists(pair.keepPath))
        .map((pair) => pair.keepId);
      if (missingKeeperFiles.length)
        mutationErrors.push(
          `keeper files missing: ${missingKeeperFiles.join(", ")}`,
        );
      const associationsByKeeper = new Map(
        del.associations.map((association) => [
          association.keepId,
          association,
        ]),
      );
      for (const [keeperId, expected] of associationsByKeeper) {
        const actual = rowById.get(keeperId);
        if (
          actual !== undefined &&
          JSON.stringify(actual.playlists) !==
            JSON.stringify(expected.playlists)
        ) {
          mutationErrors.push(`playlist associations mismatch: ${keeperId}`);
        }
        if (
          actual !== undefined &&
          JSON.stringify(actual.cueSignatures) !==
            JSON.stringify(expected.cueSignatures)
        ) {
          mutationErrors.push(`cue associations mismatch: ${keeperId}`);
        }
        if (actual !== undefined && !actual.cueOwnersValid)
          mutationErrors.push(`cue ownership mismatch: ${keeperId}`);
      }
    }

    // A receipt is part of the successful mutation contract. Give each run
    // a collision-proof receipt and compensate if persisting it fails.
    if (mutationErrors.length === 0 && moves.length > 0) {
      try {
        deps.mkdir(qdir);
        receipt = quarantineDest(qdir, "receipt.json");
        receiptAttempted = true;
        const appliedPairs = unique.filter((pair) =>
          removedIds.has(pair.loseId),
        );
        deps.writeFile(
          receipt,
          JSON.stringify(
            {
              date: stamp,
              pairs: appliedPairs,
              removedRows: removed,
              quarantined,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        mutationErrors.push(`receipt write failed: ${errorText(error)}`);
      }
    }

    if (mutationErrors.length > 0) {
      let restored = false;
      try {
        deps.assertClosed("restoring failed rb-dedup");
        deps.restore(dbPath, backedUpTo);
        restored = true;
        removed = 0;
        mutationErrors.push(`restored from backup ${backedUpTo}`);
      } catch (error) {
        mutationErrors.push(
          `automatic DB restore failed; ${removed} loser row(s) remain absent: ${errorText(error)}`,
        );
      }
      if (restored) {
        for (const move of moves.toReversed()) {
          try {
            deps.rename(move.destination, move.source);
            const index = quarantined.indexOf(move.destination);
            if (index !== -1) quarantined.splice(index, 1);
          } catch (error) {
            mutationErrors.push(
              `quarantine reversal failed; DB row was restored at ${move.source} but file remains at ${move.destination}: ${errorText(error)}`,
            );
          }
        }
      }
      if (receiptAttempted && receipt) {
        try {
          deps.remove(receipt);
        } catch (error) {
          mutationErrors.push(
            `failed to remove compensated receipt ${receipt}: ${errorText(error)}`,
          );
        }
      }
    }
  }

  const result: RbDedupResult = {
    command: "rb-dedup",
    db: dbPath,
    scanned: out.scanned,
    pairs: unique,
    removed,
    quarantined,
    missingFiles,
    appliedMode: apply,
    backedUpTo,
    ok: mutationErrors.length === 0,
  };
  if (mutationErrors.length) result.error = mutationErrors.join("; ");
  return result;
}
