// rb-fix-paths-apply.ts — the write/verify/rollback arm of rb-fix-paths
// (#232 split, the rb-dedup pattern): the FixCtx carrier, the apply
// phase (guard → backup → rewrite), the FULL-TABLE delayed re-read
// verification, and the failure path with byte-verified rollback.
// rb-fix-paths.ts keeps the parsers, the read seam, the preflight/scan,
// and the rbFixPaths sequencer; this module owns everything that runs
// AFTER the scan says there is something to rewrite.
import { errMessage as errorText } from "../shared/leaf/fmt";
import type {
  RbFixPathsOptions,
  RbFixPathsRuntime,
  RbFixResult,
  RbFixRow,
} from "./rb-fix-paths-types.js";

/** Shared apply/verify context: the scan facts plus the mutable counters
 *  the result builder reads at call time (same semantics as the old
 *  closure-captured `applied`/`backedUpTo`/`stillBroken`/`appliedList`). */
export interface FixCtx {
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

function sameRows(
  expected: [string, string][],
  actual: [string, string][],
): boolean {
  if (actual.length !== expected.length) return false;
  const actualById = new Map(actual);
  return expected.every(([id, path]) => actualById.get(id) === path);
}

/** Success-shaped result built from the ctx counters (the old `result()`
 *  closure, made a function of its inputs). */
function resultOf(ctx: FixCtx, values: Partial<RbFixResult> = {}): RbFixResult {
  return {
    command: "rb-fix-paths",
    mount: ctx.opts.mount,
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
export function applyRewrites(ctx: FixCtx): Promise<RbFixResult | null> {
  if (!ctx.opts.apply || ctx.fixable.length === 0) return Promise.resolve(null);
  try {
    ctx.runtime.assertClosed("rb-fix-paths --apply backup");
    ctx.backedUpTo = ctx.runtime.backup(ctx.dbPath);
    ctx.log(`rb-fix-paths: DB backed up to ${ctx.backedUpTo}`);
    ctx.runtime.assertClosed("rb-fix-paths --apply mutation");
    const rewrite = ctx.runtime.rewrite(ctx.dbPath, ctx.fixable, ctx.log);
    return Promise.resolve(rewrite)
      .then((applied) => {
        ctx.applied = applied;
        if (applied !== ctx.fixable.length) {
          return restoreAfterFailure(
            ctx,
            `partial rewrite: applied ${applied}/${ctx.fixable.length}`,
            applied,
            ctx.brokenRows.length,
          );
        }
        return null;
      })
      .catch((error: unknown) =>
        restoreAfterFailure(
          ctx,
          `rewrite failed: ${errorText(error)}`,
          ctx.applied,
          ctx.brokenRows.length,
        ),
      );
  } catch (error) {
    const detail = errorText(error);
    return Promise.resolve(
      restoreAfterFailure(
        ctx,
        `rewrite failed: ${detail}`,
        ctx.applied,
        ctx.brokenRows.length,
      ),
    );
  }
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
export function verifyRewrite(ctx: FixCtx): RbFixResult | null {
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

/** The post-apply success envelope (scan + counters → result). */
export function fixResultOf(ctx: FixCtx): RbFixResult {
  return resultOf(ctx);
}
