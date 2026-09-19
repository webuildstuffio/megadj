// rb-dedup-apply.ts — the apply-phase legs of rbDedup (#88 item 1):
// row deletion, quarantine moves, post-write verification, receipt, and
// compensation on failure. rbDedup (rb-dedup.ts) stays the scan +
// gate + result assembly; each leg here is a function under the #198
// census ceiling. All file/DB mutations stay behind the deps seam.
import { join } from "node:path";
import {
  parseDeleteResult,
  parseVerifyRows,
  type DeleteResult,
  type VerifyRow,
} from "./rb-dedup-parse.js";
import { errMessage as errorText } from "../shared/leaf/fmt";
import { pyUvFileArgv } from "./rb-command-kit.js";
import { quarantineDest } from "../archive/hygiene/apply";
import type { DupePair } from "./rb-dedup-graph.js";
import type { RbDedupDeps, RbDedupOptions } from "./rb-dedup.js";

export interface ApplyPhase {
  removed: number;
  quarantined: string[];
  missingFiles: string[];
  backedUpTo: string | null;
  errors: string[];
}

export interface QuarantineOutcome {
  moves: { source: string; destination: string }[];
  qdir: string;
  stamp: string;
}

/** Leg 1: merge associations + delete loser rows via dedup-delete.kit.py.
 *  Returns null when the spawn itself failed (already recorded in errors). */
export function deleteLoserRows(
  deps: RbDedupDeps,
  dbPath: string,
  unique: DupePair[],
  errors: string[],
): DeleteResult | null {
  // The report/fingerprinting pass can take minutes. Close the race by
  // checking again at the last possible moment before the write spawn.
  try {
    deps.assertClosed("rb-dedup --apply delete");
  } catch (error) {
    errors.push(errorText(error));
    return null;
  }
  const rd = deps.spawn(
    "uv",
    pyUvFileArgv({
      file: "dedup-delete.kit.py",
      args: [
        dbPath,
        JSON.stringify(unique.map((pair) => [pair.loseId, pair.keepId])),
      ],
    }),
    { encoding: "utf8", timeout: 300_000 },
  );
  if (rd.status !== 0 || !rd.stdout) {
    errors.push(
      `row deletion process failed (exit ${String(rd.status)}): ${(rd.stderr ?? "").slice(-300)}`,
    );
    return null;
  }
  try {
    return parseDeleteResult(
      rd.stdout.trim().split("\n").pop() ?? "",
      unique.map((p) => p.loseId),
    );
  } catch (error) {
    errors.push(errorText(error));
    return null;
  }
}

/** Association-proof check: every deleted loser's keeper must match the
 *  requested pair. Mismatches land in errors (they trigger compensation). */
export function verifyAssociationProofs(
  unique: DupePair[],
  del: DeleteResult,
  errors: string[],
): void {
  const pairByLoser = new Map(unique.map((pair) => [pair.loseId, pair]));
  for (const [index, loserId] of del.removedIds.entries()) {
    const expectedKeeper = pairByLoser.get(loserId)?.keepId;
    const actualKeeper = del.associations[index]?.keepId;
    if (expectedKeeper === undefined || actualKeeper !== expectedKeeper) {
      errors.push(
        `association proof mismatch for loser ${loserId}: expected keeper ${expectedKeeper ?? "unknown"}, got ${actualKeeper ?? "missing"}`,
      );
    }
  }
}

/** Leg 2: quarantine loser files (never delete) — EXCEPT same-path pairs
 *  and shared-path losers, where keeper and loser are ONE physical file. */
export function quarantineLosers(
  deps: RbDedupDeps,
  opts: RbDedupOptions,
  unique: DupePair[],
  removedIds: Set<string>,
  sharedLoserIds: Set<string>,
  errors: string[],
  missingFiles: string[],
  quarantined: string[],
): QuarantineOutcome {
  const stamp = deps.now().toISOString().slice(0, 10);
  const qdir = join(
    opts.mount.replace(/\/+$/u, ""),
    "Quarantine",
    `rb-dedup-${stamp}`,
  );
  const moves: { source: string; destination: string }[] = [];
  for (const p of errors.length === 0 ? unique : []) {
    // Never move a file when its loser row was not confirmed deleted.
    if (!removedIds.has(p.loseId)) continue;
    // Exact/NFC+casefold path twins and equal resolved realpaths are one
    // physical file on the target macOS/ExFAT shelf. Only retire the extra
    // DB row; moving that path would also move the keeper's bytes.
    if (sharedLoserIds.has(p.loseId)) continue;
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
      errors.push(`quarantine failed for ${p.losePath}: ${errorText(error)}`);
      break;
    }
  }
  return { moves, qdir, stamp };
}

/** Leg 3: the fresh-DB verification — the subprocess acknowledgement is
 *  not proof. Returns the parsed rows; the caller recomputes `removed`
 *  from them (the fresh DB is the source of truth even when the delete
 *  process exited badly or returned malformed acknowledgements). */
export function verifyRowsFresh(
  deps: RbDedupDeps,
  dbPath: string,
  unique: DupePair[],
  del: DeleteResult,
  errors: string[],
): VerifyRow[] | null {
  let rows: VerifyRow[] | null = null;
  try {
    deps.assertClosed("rb-dedup post-write verification");
    const ids = [
      ...new Set(unique.flatMap((pair) => [pair.keepId, pair.loseId])),
    ];
    const verification = deps.spawn(
      "uv",
      pyUvFileArgv({
        file: "dedup-verify.kit.py",
        args: [dbPath, JSON.stringify(ids)],
      }),
      { encoding: "utf8", timeout: 120_000 },
    );
    if (verification.status !== 0 || !verification.stdout) {
      errors.push(
        `verification read failed (exit ${String(verification.status)}): ${(verification.stderr ?? "").slice(-300)}`,
      );
    } else {
      rows = parseVerifyRows(
        verification.stdout.trim().split("\n").pop() ?? "",
      );
    }
  } catch (error) {
    errors.push(`verification failed: ${errorText(error)}`);
  }
  if (!rows) return null;
  auditFreshRows(deps, unique, del, rows, errors);
  return rows;
}

/** The row-level audit against the fresh DB read. */
function auditFreshRows(
  deps: RbDedupDeps,
  unique: DupePair[],
  del: DeleteResult,
  verifyRows: VerifyRow[],
  errors: string[],
): void {
  const rowById = new Map(verifyRows.map((row) => [row.id, row]));
  const survivors = unique.filter((pair) => rowById.has(pair.loseId));
  if (survivors.length)
    errors.push(
      `loser rows still present: ${survivors.map((p) => p.loseId).join(", ")}`,
    );
  const missingKeepers = unique
    .filter((pair) => !rowById.has(pair.keepId))
    .map((pair) => pair.keepId);
  if (missingKeepers.length)
    errors.push(`keeper rows missing: ${missingKeepers.join(", ")}`);
  const mismatchedKeepers = unique
    .filter((pair) => {
      const row = rowById.get(pair.keepId);
      return row !== undefined && row.path !== pair.keepPath;
    })
    .map((pair) => pair.keepId);
  if (mismatchedKeepers.length)
    errors.push(`keeper path mismatch: ${mismatchedKeepers.join(", ")}`);
  const missingKeeperFiles = unique
    .filter((pair) => !deps.fileExists(pair.keepPath))
    .map((pair) => pair.keepId);
  if (missingKeeperFiles.length)
    errors.push(`keeper files missing: ${missingKeeperFiles.join(", ")}`);
  const associationsByKeeper = new Map(
    del.associations.map((association) => [association.keepId, association]),
  );
  for (const [keeperId, expected] of associationsByKeeper) {
    const actual = rowById.get(keeperId);
    if (
      actual !== undefined &&
      JSON.stringify(actual.playlists) !== JSON.stringify(expected.playlists)
    ) {
      errors.push(`playlist associations mismatch: ${keeperId}`);
    }
    if (
      actual !== undefined &&
      JSON.stringify(actual.cueSignatures) !==
        JSON.stringify(expected.cueSignatures)
    ) {
      errors.push(`cue associations mismatch: ${keeperId}`);
    }
    if (actual !== undefined && !actual.cueOwnersValid)
      errors.push(`cue ownership mismatch: ${keeperId}`);
  }
}

/** Leg 4: the run receipt (part of the successful-mutation contract). */
export function writeReceipt(
  deps: RbDedupDeps,
  unique: DupePair[],
  removedIds: Set<string>,
  removed: number,
  quarantined: string[],
  stamp: string,
  qdir: string,
  errors: string[],
): { receipt: string | null; attempted: boolean } {
  if (errors.length > 0 || quarantined.length === 0) {
    return { receipt: null, attempted: false };
  }
  try {
    deps.mkdir(qdir);
    const receipt = quarantineDest(qdir, "receipt.json");
    const appliedPairs = unique.filter((pair) => removedIds.has(pair.loseId));
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
    return { receipt, attempted: true };
  } catch (error) {
    errors.push(`receipt write failed: ${errorText(error)}`);
    return { receipt: null, attempted: false };
  }
}

/** Leg 5: compensation — restore the DB backup, reverse quarantine moves
 *  (newest first), remove the now-invalid receipt. */
export function compensate(
  deps: RbDedupDeps,
  dbPath: string,
  backedUpTo: string | null,
  moves: { source: string; destination: string }[],
  quarantined: string[],
  receipt: string | null,
  receiptAttempted: boolean,
  removed: number,
  errors: string[],
): { removed: number; quarantined: string[]; receipt: string | null } {
  let removedNow = removed;
  const quarantinedNow = quarantined;
  let receiptNow = receipt;
  let restored = false;
  if (backedUpTo === null) {
    errors.push("no backup to restore from; leaving files and rows as-is");
    return {
      removed: removedNow,
      quarantined: quarantinedNow,
      receipt: receiptNow,
    };
  }
  const backupPath: string = backedUpTo;
  try {
    deps.assertClosed("restoring failed rb-dedup");
    deps.restore(dbPath, backupPath);
    restored = true;
    removedNow = 0;
    errors.push(`restored from backup ${backupPath}`);
  } catch (error) {
    errors.push(
      `automatic DB restore failed; ${removedNow} loser row(s) remain absent: ${errorText(error)}`,
    );
  }
  if (restored) {
    for (const move of moves.toReversed()) {
      try {
        deps.rename(move.destination, move.source);
        const index = quarantinedNow.indexOf(move.destination);
        if (index !== -1) quarantinedNow.splice(index, 1);
      } catch (error) {
        errors.push(
          `quarantine reversal failed; DB row was restored at ${move.source} but file remains at ${move.destination}: ${errorText(error)}`,
        );
      }
    }
  }
  if (receiptAttempted && receiptNow) {
    try {
      deps.remove(receiptNow);
    } catch (error) {
      errors.push(
        `failed to remove compensated receipt ${receiptNow}: ${errorText(error)}`,
      );
    }
    receiptNow = null;
  }
  return {
    removed: removedNow,
    quarantined: quarantinedNow,
    receipt: receiptNow,
  };
}
