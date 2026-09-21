/**
 * megadj rb-fix-paths — repair stale djmdContent paths in a rekordbox
 * master DB after folders move/merge on the drive (the shelf migration and
 * every folder-merge pass leave stale rows behind).
 *
 * Reads the drive's PIONEER/Master/master.db (or a local master DB via
 * MEGADJ_RB_MASTER), checks EVERY content row's FolderPath against the
 * disk, and proposes rewrites via a matching ladder (the ladder + live
 * index live in rb-fix-paths-index.ts, the row shapes in
 * rb-fix-paths-types.ts — #42 item 2 split):
 *   exact → NFC+casefold → unique basename → strip repeated -N copy
 *   suffixes → 20-char prefix (exFAT truncation) → largest twin
 * Rows with no confident live match are REPORTED, never touched —
 * deleting rows is rekordbox's job (Missing File Manager), not ours.
 *
 * Dry-run by default; --apply --yes rewrites rows (rekordbox must be
 * quit — it holds a live WAL) after backing the DB up next to itself.
 * Hard rules this encodes (AGENTS.md / the repair skill):
 *   - verify EVERY row post-write, never a prefix-scoped subset
 *   - never write while rekordbox runs (pgrep guard)
 *   - corrupt/missing DB is a visible failure, never a fake pass
 *
 * Split per concern (#232): the parsers, read seam, preflight/scan, and
 * the rbFixPaths sequencer live here; the write/verify/rollback arm
 * (FixCtx, applyRewrites, verifyRewrite) lives in
 * rb-fix-paths-apply.ts.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { commandLog } from "../shared/progress";
import { isUnknownArray } from "../shared/leaf/guards";
import {
  assertRbClosed,
  backupMaster,
  restoreMasterBackup,
  sleepSync,
} from "./guard.js";
import { rbPythonFile } from "./rb-python-file.js";
import {
  applyConfirmationRefusal,
  DECIMAL_ID_RE,
  lastJsonLine,
  makeFail,
  parseJsonBoundary,
  printResult,
} from "./rb-command-kit.js";
import { masterDbPath, normalizeMount } from "./master-path.js";
import { errMessage as errorText } from "../shared/leaf/fmt";
import {
  buildIndex,
  matchLadder,
  stripCopySuffix,
  emptyIndex,
} from "./rb-fix-paths-index.js";
import {
  applyRewrites,
  fixResultOf,
  verifyRewrite,
  type FixCtx,
} from "./rb-fix-paths-apply";
import type {
  RbFixPathsOptions,
  RbFixPathsRuntime,
  RbFixResult,
  RbFixRow,
} from "./rb-fix-paths-types.js";

export type {
  RbFixPathsOptions,
  RbFixPathsRuntime,
  RbFixResult,
  RbFixRow,
} from "./rb-fix-paths-types.js";
export { buildIndex } from "./rb-fix-paths-index.js";

function parseJsonResult(raw: string, operation: "read" | "rewrite"): unknown {
  return parseJsonBoundary(raw, `pyrekordbox ${operation}`);
}

const DECIMAL_ID = DECIMAL_ID_RE;

function parseReadRows(raw: string): [string, string][] {
  const value = parseJsonResult(raw, "read");
  if (
    !isUnknownArray(value) ||
    !value.every(
      (row): row is [string, string] =>
        isUnknownArray(row) &&
        row.length === 2 &&
        typeof row[0] === "string" &&
        DECIMAL_ID.test(row[0]) &&
        typeof row[1] === "string",
    )
  ) {
    throw new Error(
      "pyrekordbox read returned invalid rows: expected [decimal string id, path][]",
    );
  }
  return value;
}

function parseRewriteResult(raw: string): number {
  const value = parseJsonResult(raw, "rewrite");
  if (
    typeof value !== "object" ||
    value === null ||
    !("applied" in value) ||
    typeof value.applied !== "number" ||
    !Number.isFinite(value.applied) ||
    !Number.isInteger(value.applied) ||
    value.applied < 0
  ) {
    throw new Error(
      "pyrekordbox rewrite returned invalid applied count: expected a non-negative finite integer",
    );
  }
  return value.applied;
}

/** Read (ID, FolderPath) for every content row via pyrekordbox. Shared
 *  with rb-unmatched (read-only reuse — one DB reader, two consumers). */
export function readRows(dbPath: string): [string, string][] {
  const r = rbPythonFile({
    file: "fix-paths-read.py",
    args: [dbPath],
    timeoutMs: 120_000,
  });
  if (r.status !== 0 || !r.stdout) {
    throw new Error(
      `pyrekordbox read failed (exit ${String(r.status)}): ${r.stderr.slice(0, 300)}`,
    );
  }
  return parseReadRows(lastJsonLine(r.stdout));
}

/** Preflight + scan phase: confirmation/mount guards, then the read-only
 *  classification of every content row against the live index. Either a
 *  refusal reason or the full scan state — no mutation here. */
function preflightAndScan(
  opts: RbFixPathsOptions,
  runtime: RbFixPathsRuntime,
  dbPath: string,
  log: (s: string) => void,
):
  | { ok: false; error: string }
  | {
      ok: true;
      rows: [string, string][];
      brokenRows: RbFixRow[];
      fixable: RbFixRow[];
      dead: RbFixRow[];
    } {
  const refusal = applyConfirmationRefusal(opts);
  if (refusal !== null) return { ok: false, error: refusal };
  if (!runtime.fileExists(dbPath)) {
    return { ok: false, error: `no master DB at ${dbPath}` };
  }
  if (opts.apply) {
    try {
      runtime.assertClosed("rb-fix-paths --apply preflight");
    } catch (error) {
      return { ok: false, error: errorText(error) };
    }
  }

  log(`rb-fix-paths: reading ${dbPath}`);
  let rows: [string, string][];
  try {
    rows = runtime.readRows(dbPath);
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
  const idx = runtime.buildIndex(normalizeMount(opts.mount));
  log(
    `rb-fix-paths: ${rows.length} content rows · ${idx.byNorm.size} live audio files indexed`,
  );

  const brokenRows: RbFixRow[] = [];
  for (const [id, p] of rows) {
    if (p && !runtime.fileExists(p)) {
      const row = matchLadder(p, idx);
      row.id = id;
      brokenRows.push(row);
    }
  }
  return {
    ok: true,
    rows,
    brokenRows,
    fixable: brokenRows.filter((r) => r.fixPath),
    dead: brokenRows.filter((r) => !r.fixPath),
  };
}

export async function rbFixPaths(
  opts: RbFixPathsOptions,
  overrides: Partial<RbFixPathsRuntime> = {},
): Promise<RbFixResult> {
  const log = opts.log ?? commandLog({ json: opts.json });
  const dbPath = masterDbPath(normalizeMount(opts.mount));
  const runtime: RbFixPathsRuntime = {
    fileExists: existsSync,
    assertClosed: assertRbClosed,
    backup: backupMaster,
    readRows,
    buildIndex,
    rewrite: rewriteRows,
    sleep: sleepSync,
    restore: restoreMasterBackup,
    ...overrides,
  };

  const fail = makeFail((msg: string): RbFixResult => ({
    command: "rb-fix-paths",
    mount: normalizeMount(opts.mount),
    db: dbPath,
    total: 0,
    broken: 0,
    fixable: 0,
    dead: 0,
    applied: 0,
    appliedList: [],
    deadList: [],
    stillBroken: 0,
    appliedMode: Boolean(opts.apply),
    backedUpTo: null,
    ok: false,
    error: msg,
  }));

  const scan = preflightAndScan(opts, runtime, dbPath, log);
  if (!scan.ok) {
    const r = fail(scan.error);
    log(r.error ?? "unknown failure");
    return r;
  }

  const ctx: FixCtx = {
    opts,
    runtime,
    log,
    dbPath,
    rows: scan.rows,
    brokenRows: scan.brokenRows,
    fixable: scan.fixable,
    dead: scan.dead,
    applied: 0,
    appliedList: [],
    backedUpTo: null,
    stillBroken: 0,
  };

  const applyFailure = await applyRewrites(ctx);
  if (applyFailure) {
    log(applyFailure.error ?? "unknown failure");
    return applyFailure;
  }
  const verifyFailure = verifyRewrite(ctx);
  if (verifyFailure) {
    log(verifyFailure.error ?? "unknown failure");
    return verifyFailure;
  }
  return fixResultOf(ctx);
}

async function rewriteRows(
  dbPath: string,
  rows: RbFixRow[],
  log: (s: string) => void,
): Promise<number> {
  const payload = JSON.stringify(rows.map((r) => [r.id, r.fixPath]));
  const r = rbPythonFile({
    file: "fix-paths-rewrite.py",
    args: [dbPath, payload],
    timeoutMs: 180_000,
  });
  if (r.status !== 0) {
    const detail = r.stderr.slice(0, 300);
    log(`rb-fix-paths: rewrite failed: ${detail}`);
    throw new Error(
      `pyrekordbox rewrite failed (exit ${String(r.status)}): ${detail}`,
    );
  }
  const line = lastJsonLine(r.stdout ?? "", "{}");
  return parseRewriteResult(line);
}

/** Test seam: the matching ladder against a live index (no DB needed). */
export const __test = {
  matchLadder: (broken: string, mount: string): RbFixRow =>
    matchLadder(broken, buildIndex(mount)),
  stripCopySuffix,
  parseReadRows,
  parseRewriteResult,
  readScriptFile: "rb-scripts/fix-paths-read.py",
  rewriteScript: (): string =>
    readFileSync(
      join(import.meta.dir, "rb-scripts", "fix-paths-rewrite.py"),
      "utf8",
    ),
  emptyIndex,
};
/** Emit the human report (non-json mode). */
export function printRbFixReport(
  r: RbFixResult,
  log: (s: string) => void,
): void {
  printResult(log, r, (body) => {
    log(
      `${body.total} content rows · ${body.broken} broken · ${body.fixable} fixable · ${body.dead} dead (truly gone)`,
    );
    for (const f of body.appliedList) log(`  fixed: ${f}`);
    for (const d of body.deadList)
      log(`  dead (use Missing File Manager to remove): ${d}`);
    if (body.appliedMode)
      log(
        body.stillBroken === body.dead
          ? `post-verify: only the ${body.dead} dead rows remain — clean`
          : `post-verify: ${body.stillBroken - body.dead} UNEXPECTED still-broken rows — investigate`,
      );
    else
      log(
        `dry-run — re-run with --apply --yes (rekordbox quit) to rewrite ${body.fixable} rows`,
      );
  });
}
