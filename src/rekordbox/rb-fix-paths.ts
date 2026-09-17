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
 */

import { existsSync } from "node:fs";
import { commandLog } from "../progress";
import { isUnknownArray } from "../../cratedeck/shared/guards";
import {
  assertRbClosed,
  backupMaster,
  restoreMasterBackup,
  sleepSync,
} from "./guard.js";
import {
  applyConfirmationRefusal,
  DECIMAL_ID_RE,
  lastJsonLine,
  makeFail,
  parseJsonBoundary,
  printResult,
  rbPythonRun,
} from "./rb-command-kit.js";
import { masterDbPath, normalizeMount } from "./master-path.js";
import { errorText } from "../shared/error-text";
import {
  buildIndex,
  matchLadder,
  stripCopySuffix,
  emptyIndex,
} from "./rb-fix-paths-index.js";
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

const PY =
  "import sys, json;from pyrekordbox import Rekordbox6Database as R\n" +
  "db=R(sys.argv[1])\n" +
  'rows=[(str(c.ID),c.FolderPath or "") for c in db.get_content()]\n' +
  "print(json.dumps(rows));db.close()";

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
  const r = rbPythonRun({ script: PY, args: [dbPath], timeoutMs: 120_000 });
  if (r.status !== 0 || !r.stdout) {
    throw new Error(
      `pyrekordbox read failed (exit ${String(r.status)}): ${r.stderr.slice(0, 300)}`,
    );
  }
  return parseReadRows(lastJsonLine(r.stdout));
}

/** Shared apply/verify context: the scan facts plus the mutable counters
 *  the result builder reads at call time (same semantics as the old
 *  closure-captured `applied`/`backedUpTo`/`stillBroken`/`appliedList`). */
interface FixCtx {
  opts: RbFixPathsOptions;
  runtime: RbFixPathsRuntime;
  log: (s: string) => void;
  dbPath: string;
  rows: [string, string][];
  brokenRows: RbFixRow[];
  fixable: RbFixRow[];
  dead: RbFixRow[];
  applied: number;
  appliedList: string[];
  backedUpTo: string | null;
  stillBroken: number;
}

/** Success-shaped result built from the ctx counters (the old `result()`
 *  closure, made a function of its inputs). */
function resultOf(ctx: FixCtx, values: Partial<RbFixResult> = {}): RbFixResult {
  return {
    command: "rb-fix-paths",
    mount: normalizeMount(ctx.opts.mount),
    db: ctx.dbPath,
    total: ctx.rows.length,
    broken: ctx.brokenRows.length,
    fixable: ctx.fixable.length,
    dead: ctx.dead.length,
    applied: ctx.applied,
    appliedList: ctx.appliedList,
    deadList: ctx.dead.map((d) => d.brokenPath),
    stillBroken: ctx.stillBroken,
    appliedMode: Boolean(ctx.opts.apply),
    backedUpTo: ctx.backedUpTo,
    ok: true,
    ...values,
  };
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

/** Failure path with rollback: when a backup exists, restore it and
 *  verify the restoration byte-for-byte (row-for-row); report honestly
 *  either way — a failed rollback is the loudest line in the report. */
function restoreAfterFailure(
  ctx: FixCtx,
  reason: string,
  attempted: number,
  measuredStillBroken: number,
): RbFixResult {
  if (ctx.backedUpTo === null) {
    return resultOf(ctx, {
      ok: false,
      error: reason,
      applied: attempted,
      stillBroken: measuredStillBroken,
    });
  }
  try {
    ctx.runtime.assertClosed("rb-fix-paths rollback");
    ctx.runtime.restore(ctx.dbPath, ctx.backedUpTo);
    ctx.runtime.sleep(250);
    ctx.runtime.assertClosed("rb-fix-paths rollback verification");
    const restored = ctx.runtime.readRows(ctx.dbPath);
    if (!sameRows(ctx.rows, restored)) {
      throw new Error("restored database does not match its pre-write rows");
    }
    return resultOf(ctx, {
      ok: false,
      error: `${reason}; backup restored and verified`,
      applied: 0,
      appliedList: [],
      stillBroken: ctx.brokenRows.length,
    });
  } catch (error) {
    const detail = errorText(error);
    return resultOf(ctx, {
      ok: false,
      error: `${reason}; ROLLBACK FAILED: ${detail}`,
      applied: attempted,
      appliedList: [],
      stillBroken: measuredStillBroken,
    });
  }
}

/** Apply phase: re-check the guard immediately before BOTH the sacred
 *  backup and the mutation (rekordbox cannot open unnoticed during the
 *  long volume walk), back up, rewrite. Returns a failure result (after
 *  rollback) or null to proceed to verification. */
async function applyRewrites(ctx: FixCtx): Promise<RbFixResult | null> {
  if (!ctx.opts.apply || ctx.fixable.length === 0) return null;
  try {
    ctx.runtime.assertClosed("rb-fix-paths --apply backup");
    ctx.backedUpTo = ctx.runtime.backup(ctx.dbPath);
    ctx.log(`rb-fix-paths: DB backed up to ${ctx.backedUpTo}`);
    ctx.runtime.assertClosed("rb-fix-paths --apply mutation");
    ctx.applied = await ctx.runtime.rewrite(ctx.dbPath, ctx.fixable, ctx.log);
  } catch (error) {
    const detail = errorText(error);
    return restoreAfterFailure(
      ctx,
      `rewrite failed: ${detail}`,
      ctx.applied,
      ctx.brokenRows.length,
    );
  }
  if (ctx.applied !== ctx.fixable.length) {
    return restoreAfterFailure(
      ctx,
      `partial rewrite: applied ${ctx.applied}/${ctx.fixable.length}`,
      ctx.applied,
      ctx.brokenRows.length,
    );
  }
  return null;
}

/** Classify the post-write re-read: the three independent ways a write
 *  can be wrong (target rows not what we wrote, rows we never touched
 *  going broken, row count drift). Kept separate so the verify function
 *  stays a thin gate over it. */
function verifyRowIntegrity(
  ctx: FixCtx,
  reread: [string, string][],
): { targetFailures: number; unexpectedBroken: number } {
  const byId = new Map(reread);
  const deadIds = new Set(ctx.dead.map((row) => row.id));
  const targetFailures = ctx.fixable.filter(
    (row) =>
      row.fixPath === null ||
      byId.get(row.id) !== row.fixPath ||
      !ctx.runtime.fileExists(row.fixPath),
  );
  const unexpectedBroken = reread.filter(
    ([id, path]) => path && !ctx.runtime.fileExists(path) && !deadIds.has(id),
  );
  return {
    targetFailures: targetFailures.length,
    unexpectedBroken: unexpectedBroken.length,
  };
}

/** FULL-TABLE delayed re-read in a fresh process — every row, not just
 *  the intended updates. A successful commit is not proof that paths
 *  survived. Returns a failure result (after rollback) or null = clean,
 *  with ctx.appliedList filled for the report. */
function verifyRewrite(ctx: FixCtx): RbFixResult | null {
  if (!ctx.opts.apply) return null;
  let reread: [string, string][];
  try {
    ctx.runtime.sleep(250);
    ctx.runtime.assertClosed("rb-fix-paths verification");
    reread = ctx.runtime.readRows(ctx.dbPath);
  } catch (error) {
    const detail = errorText(error);
    return restoreAfterFailure(
      ctx,
      `verification failed: ${detail}`,
      ctx.applied,
      ctx.brokenRows.length,
    );
  }

  ctx.stillBroken = reread.reduce(
    (count, [, path]) =>
      path && !ctx.runtime.fileExists(path) ? count + 1 : count,
    0,
  );
  const failures = verifyRowIntegrity(ctx, reread);
  if (
    reread.length !== ctx.rows.length ||
    failures.targetFailures > 0 ||
    failures.unexpectedBroken > 0
  ) {
    return restoreAfterFailure(
      ctx,
      `verification failed: ${failures.targetFailures} rewritten target(s) invalid, ${failures.unexpectedBroken} unexpected broken row(s), row count ${reread.length}/${ctx.rows.length}`,
      ctx.applied,
      ctx.stillBroken,
    );
  }
  for (const row of ctx.fixable)
    ctx.appliedList.push(`${row.brokenPath} → ${row.fixPath}`);
  return null;
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
  return resultOf(ctx);
}

function sameRows(
  expected: [string, string][],
  actual: [string, string][],
): boolean {
  if (actual.length !== expected.length) return false;
  const actualById = new Map(actual);
  return expected.every(([id, path]) => actualById.get(id) === path);
}

async function rewriteRows(
  dbPath: string,
  rows: RbFixRow[],
  log: (s: string) => void,
): Promise<number> {
  const payload = JSON.stringify(rows.map((r) => [r.id, r.fixPath]));
  const script = rewriteScript();
  const r = rbPythonRun({
    script,
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

function rewriteScript(): string {
  return (
    "import sys,json;from pyrekordbox import Rekordbox6Database as R\n" +
    "db=R(sys.argv[1])\n" +
    "updates=json.loads(sys.argv[2]);n=0\n" +
    "try:\n" +
    "    for cid,path in updates:\n" +
    "        c=db.get_content(ID=int(cid))\n" +
    "        if c is None:\n" +
    '            raise RuntimeError(f"content row {cid} disappeared before rewrite")\n' +
    "        c.FolderPath=path;n+=1\n" +
    "    db.session.commit()\n" +
    "except Exception:\n" +
    "    db.session.rollback()\n" +
    "    raise\n" +
    "finally:\n" +
    "    db.close()\n" +
    'print(json.dumps({"applied":n}))'
  );
}

/** Test seam: the matching ladder against a live index (no DB needed). */
export const __test = {
  matchLadder: (broken: string, mount: string): RbFixRow =>
    matchLadder(broken, buildIndex(mount)),
  stripCopySuffix,
  parseReadRows,
  parseRewriteResult,
  readScript: PY,
  rewriteScript,
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
