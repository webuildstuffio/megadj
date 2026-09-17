/**
 * megadj rb-comment-sync — backfill the rekordbox Comment column from the
 * tags ALREADY stamped on the files (TXXX CAMELOT/ENERGY/MOOD — the
 * fulltags pipeline's output) with the archive.db mood ledger as fallback.
 *
 * Why this exists: intake imports happened BEFORE comments were written,
 * so 87% of master.db rows show an empty Comment even though the files
 * carry `11A · E8.8 · Dance+Party`-shaped data. This is the sync half of
 * fulltags → rekordbox (the missing "redo that one" from the Sep 12–14
 * marathon).
 *
 * Safety: report default; --apply --yes writes; RB-quit gate + dated
 * backup via guard.ts; one transaction; exact delayed re-read; compensating
 * DB-family restore on every post-backup failure.
 */

import { existsSync } from "node:fs";
import {
  isNonNegativeInteger,
  isRecord,
  isUnknownArray,
} from "../../cratedeck/shared/guards";
import {
  applyConfirmed,
  applyConfirmationRefusal,
  compensateRestore,
  DECIMAL_ID_RE,
  isStringPair,
  isStringTriple,
  parseJsonBoundary,
  printResult,
  pyUvFileArgv,
  rbCommandRuntime,
  type RbCommandResult,
  type RbCommandRuntime,
} from "./rb-command-kit.js";
import { masterDbPath } from "./master-path.js";
import { errorText } from "../shared/error-text";
import { openLedger } from "../shared/sqlite-ledger";
import {
  formatAge,
  ledgerFreshness,
} from "../../cratedeck/shared/ledger-freshness";

/** The `T | null` narrows a stamp column value: string-and-non-empty
 *  passes, everything else (absent table, wrong type) degrades to null.
 *  Module-level so `ledgerFreshnessOf` doesn't rebuild it per call. */
const stampOf = (v: unknown): string | null =>
  typeof v === "string" && v ? v : null;

/** Ledger freshness for the sync result (#174): MAX(analyzed_at) per
 *  analysis ledger, straight from the archive DB — never file mtimes.
 *  Null stamps mean an empty/missing ledger and render as "no analysis
 *  yet" upstream, the honest gap. Read through the ONE SQLite seam
 *  (openLedger); any failure degrades to null stamps — freshness is
 *  display metadata and must never fail the sync. */
export function ledgerFreshnessOf(ledgerPath: string): {
  beatsAt: string | null;
  moodAt: string | null;
} {
  if (!existsSync(ledgerPath)) return { beatsAt: null, moodAt: null };
  try {
    const db = openLedger(ledgerPath);
    try {
      const row = db
        .query<Record<string, unknown>, []>(
          `SELECT
             (SELECT MAX(analyzed_at) FROM beats) AS beats_at,
             (SELECT MAX(analyzed_at) FROM mood) AS mood_at`,
        )
        .get();
      return {
        beatsAt: stampOf(row?.beats_at),
        moodAt: stampOf(row?.mood_at),
      };
    } finally {
      db.close();
    }
  } catch {
    // absent tables (schema drift / fresh ledger) → honest null stamps
    return { beatsAt: null, moodAt: null };
  }
}

export interface RbCommentSyncOptions {
  mount: string;
  /** Only sync rows whose FolderPath contains this token (batch scope). */
  batch?: string | undefined;
  apply?: boolean | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
  limit?: number | undefined;
  log?: (s: string) => void;
}

export interface RbCommentSyncResult {
  command: "rb-comment-sync";
  db: string;
  /** rows scanned */
  scanned: number;
  /** rows whose file carries tag data (or ledger fallback) */
  eligible: number;
  /** comments written (0 in dry-run) */
  written: number;
  /** rows skipped: file missing or no tag data found */
  skipped: { path: string; reason: string }[];
  /** rows that already had a non-empty comment (never clobbered) */
  alreadyHad: number;
  /** Ledger freshness (#174): the archive-ledger stamps this run's
   *  fallback data rides on (MAX(analyzed_at) per ledger, null = empty
   *  ledger). Surfaced so a comparison/sync against week-old analysis
   *  reads as stale, not current — the AGENTS freshness rule. */
  freshness: { beatsAt: string | null; moodAt: string | null };
  appliedMode: boolean;
  backedUpTo: string | null;
  verify: { ok: boolean; detail: string };
  ok: boolean;
  error?: string;
}

interface SyncOutput {
  scanned: number;
  eligible: number;
  written: number;
  alreadyHad: number;
  skipped: [string, string][];
  samples: [string, string][];
  writes: [string, string][];
  errors: [string, string][];
}

interface CommentVerifyOutput {
  total: number;
  matched: number;
  missing: string[];
  mismatched: [string, string, string][];
}

type SyncCommandResult = RbCommandResult;

interface RbCommentSyncRuntime extends RbCommandRuntime {
  exists: (path: string) => boolean;
  spawn: (
    command: string[],
    timeoutMs: number,
    input?: string,
  ) => SyncCommandResult;
}

const runtime: RbCommentSyncRuntime = {
  exists: existsSync,
  ...rbCommandRuntime,
};

const nonNegativeInteger = isNonNegativeInteger;

/** `Array<[string, string]>` wire guard (skip/sample/write/error rows). */
function isStringPairArray(v: unknown): v is [string, string][] {
  return isUnknownArray(v) && v.every(isStringPair);
}

/** Shape gate for the sync subprocess payload: counters are non-negative
 *  integers, pair rows are [string, string]. Throws on the first drift. */
function requireSyncShape(value: Record<string, unknown>): SyncOutput {
  if (
    !nonNegativeInteger(value.scanned) ||
    !nonNegativeInteger(value.eligible) ||
    !nonNegativeInteger(value.written) ||
    !nonNegativeInteger(value.alreadyHad) ||
    !isStringPairArray(value.skipped) ||
    !isStringPairArray(value.samples) ||
    !isStringPairArray(value.writes) ||
    !isStringPairArray(value.errors)
  ) {
    throw new Error("rb-comment-sync returned an invalid result payload");
  }
  return {
    scanned: value.scanned,
    eligible: value.eligible,
    written: value.written,
    alreadyHad: value.alreadyHad,
    skipped: value.skipped,
    samples: value.samples,
    writes: value.writes,
    errors: value.errors,
  };
}

/** Decimal ids, unique — the write-acknowledgement rule. */
function isUniqueDecimalIdList(ids: string[]): boolean {
  return (
    ids.every((id) => DECIMAL_ID_RE.test(id)) &&
    new Set(ids).size === ids.length
  );
}

/** Cross-field consistency checks over a shape-valid payload — the first
 *  failure wins, in the original throw order. Returns the full error
 *  message to throw, or null when every check holds. */
function syncConsistencyError(out: SyncOutput, apply: boolean): string | null {
  if (out.scanned !== out.eligible + out.alreadyHad + out.skipped.length)
    return "rb-comment-sync returned inconsistent scan counters";
  if (out.errors.length > 0) {
    const joined = out.errors
      .map(([id, detail]) => `${id}: ${detail}`)
      .join("; ");
    return `rb-comment-sync transaction failed: ${joined}`;
  }
  if (apply && out.written !== out.eligible)
    return `rb-comment-sync wrote ${out.written}/${out.eligible} eligible rows`;
  if (out.writes.length !== out.written)
    return "rb-comment-sync write acknowledgements are incomplete";
  if (!apply && out.written !== 0)
    return "rb-comment-sync report mode unexpectedly wrote rows";
  if (!isUniqueDecimalIdList(out.writes.map(([id]) => id)))
    return "rb-comment-sync returned invalid or duplicate content ids";
  return null;
}

function parseSyncOutput(raw: string, apply: boolean): SyncOutput {
  const value = parseJsonBoundary(raw, "rb-comment-sync");
  if (!isRecord(value)) {
    throw new Error("rb-comment-sync returned an invalid result payload");
  }
  const out = requireSyncShape(value);
  const error = syncConsistencyError(out, apply);
  if (error) throw new Error(error);
  return out;
}

function parseVerifyOutput(raw: string): CommentVerifyOutput {
  const value = parseJsonBoundary(raw, "rb-comment-sync verification");
  if (
    !isRecord(value) ||
    !nonNegativeInteger(value.total) ||
    !nonNegativeInteger(value.matched) ||
    !isUnknownArray(value.missing) ||
    !value.missing.every((id) => typeof id === "string") ||
    !isUnknownArray(value.mismatched) ||
    !value.mismatched.every(isStringTriple)
  ) {
    throw new Error("rb-comment-sync verification returned an invalid payload");
  }
  return {
    total: value.total,
    matched: value.matched,
    missing: value.missing,
    mismatched: value.mismatched,
  };
}

function validateVerification(
  expected: readonly (readonly [string, string])[],
  result: CommentVerifyOutput,
): void {
  if (result.total !== expected.length)
    throw new Error(
      `comment verification read ${result.total}/${expected.length} intended rows`,
    );
  if (result.missing.length > 0)
    throw new Error(
      `comment verification missing ids: ${result.missing.join(", ")}`,
    );
  if (result.mismatched.length > 0)
    throw new Error(
      `comment verification mismatched ids: ${result.mismatched.map(([id]) => id).join(", ")}`,
    );
  if (result.matched !== expected.length)
    throw new Error(
      `comment verification matched ${result.matched}/${expected.length} intended rows`,
    );
}

export async function rbCommentSync(
  opts: RbCommentSyncOptions,
): Promise<RbCommentSyncResult> {
  return rbCommentSyncWithRuntime(opts, runtime);
}

async function rbCommentSyncWithRuntime(
  opts: RbCommentSyncOptions,
  deps: RbCommentSyncRuntime,
): Promise<RbCommentSyncResult> {
  const dbPath = masterDbPath(opts.mount);
  const apply = applyConfirmed(opts);
  const ledger = `${process.env.HOME}/.local/state/megadj/archive.db`;
  const mk = (
    msg: string,
    details: Partial<RbCommentSyncResult> = {},
  ): RbCommentSyncResult => ({
    command: "rb-comment-sync",
    db: dbPath,
    scanned: 0,
    eligible: 0,
    written: 0,
    skipped: [],
    alreadyHad: 0,
    freshness: deps.exists(ledger)
      ? ledgerFreshnessOf(ledger)
      : { beatsAt: null, moodAt: null },
    appliedMode: apply,
    backedUpTo: null,
    verify: { ok: false, detail: "not run" },
    ok: false,
    error: msg,
    ...details,
  });
  /** Success result from one parsed sync output (applied/report modes). */
  const synced = (
    out: SyncOutput,
    over: {
      appliedMode: boolean;
      backedUpTo: string | null;
      verify: { ok: boolean; detail: string };
    },
  ): RbCommentSyncResult => ({
    command: "rb-comment-sync",
    db: dbPath,
    scanned: out.scanned,
    eligible: out.eligible,
    written: out.written,
    skipped: out.skipped.map(([path, reason]) => ({ path, reason })),
    alreadyHad: out.alreadyHad,
    freshness: deps.exists(ledger)
      ? ledgerFreshnessOf(ledger)
      : { beatsAt: null, moodAt: null },
    ...over,
    ok: true,
  });

  if (applyConfirmationRefusal(opts) !== null)
    return mk(applyConfirmationRefusal(opts) ?? "unreachable");
  if (!deps.fileExists(dbPath)) return mk(`no master DB at ${dbPath}`);
  if (!deps.exists(ledger)) return mk(`no archive ledger at ${ledger}`);
  try {
    deps.assertClosed("rb-comment-sync");
  } catch (e) {
    return mk((e as Error).message);
  }

  /** ONE sync spawn + parse (the apply path and the report path were
   *  token-identical 8-line twins; the mode only changes the CLI arg and
   *  the apply flag handed to parseSyncOutput). Throws on spawn/parse
   *  failure — apply wraps it in compensate(), report projects to mk(). */
  const spawnSyncRun = (mode: "apply" | "report"): SyncOutput => {
    const r = deps.spawn(
      pyUvFileArgv({
        file: "comment-sync.kit.py",
        args: [dbPath, ledger, mode, opts.batch ?? "", String(opts.limit ?? 0)],
        withPkg: "pyrekordbox,mutagen",
      }),
      600_000,
    );
    if (r.status !== 0 || !r.stdout)
      throw new Error(
        `sync failed (exit ${String(r.status)}): ${r.stderr.slice(-300)}`,
      );
    return parseSyncOutput(
      r.stdout.trim().split("\n").pop() ?? "",
      mode === "apply",
    );
  };

  if (apply) {
    return syncApplyLeg(deps, dbPath, mk, synced, spawnSyncRun);
  }

  let out: SyncOutput;
  try {
    out = spawnSyncRun("report");
  } catch (error) {
    return mk(errorText(error));
  }
  return synced(out, {
    appliedMode: false,
    backedUpTo: null,
    verify: { ok: true, detail: "report mode — no write to verify" },
  });
}

/** The apply leg: dated backup → sync → delayed re-read verify, with
 *  compensation (restore) on any failure after the backup. Split out of
 *  rbCommentSyncWithRuntime so the mode dispatch stays readable. */
function syncApplyLeg(
  deps: RbCommentSyncRuntime,
  dbPath: string,
  mk: (
    msg: string,
    over?: Partial<Pick<RbCommentSyncResult, "backedUpTo" | "verify">>,
  ) => RbCommentSyncResult,
  synced: (
    out: SyncOutput,
    over: {
      appliedMode: boolean;
      backedUpTo: string | null;
      verify: { ok: boolean; detail: string };
    },
  ) => RbCommentSyncResult,
  spawnSyncRun: (mode: "apply" | "report") => SyncOutput,
): RbCommentSyncResult {
  let backedUpTo: string;
  try {
    backedUpTo = deps.backup(dbPath);
  } catch (error) {
    return mk(errorText(error));
  }

  const compensate = (error: unknown): RbCommentSyncResult => {
    const detail = compensateRestore(deps, dbPath, backedUpTo, error);
    return mk(detail, {
      backedUpTo,
      verify: { ok: false, detail },
    });
  };

  try {
    deps.assertClosed("rb-comment-sync --apply");
    const out = spawnSyncRun("apply");
    deps.sleep(250);
    deps.assertClosed("rb-comment-sync verification");
    const checked = deps.spawn(
      pyUvFileArgv({ file: "comment-verify.py", args: [dbPath] }),
      120_000,
      JSON.stringify(out.writes),
    );
    if (checked.status !== 0 || !checked.stdout)
      throw new Error(
        `comment verification failed (exit ${String(checked.status)}): ${checked.stderr.slice(-300)}`,
      );
    const verified = parseVerifyOutput(
      checked.stdout.trim().split("\n").pop() ?? "",
    );
    validateVerification(out.writes, verified);
    return synced(out, {
      appliedMode: true,
      backedUpTo,
      verify: {
        ok: true,
        detail: `re-read ${verified.matched}/${verified.total} intended comments exactly`,
      },
    });
  } catch (error) {
    return compensate(error);
  }
}

export const __test = {
  run: rbCommentSyncWithRuntime,
  parseSyncOutput,
  parseVerifyOutput,
  validateVerification,
  ledgerFreshnessOf,
};

export function printRbCommentSyncReport(
  r: RbCommentSyncResult,
  log: (s: string) => void,
): void {
  printResult(log, r, (body) => {
    log(
      `${body.scanned} rows scanned · ${body.eligible} eligible (file carries tag data) · ${body.alreadyHad} already had comments (kept) · ${body.skipped.length} skipped`,
    );
    // #174: the ledger fallback data ages — say how old it is
    const bands = [
      { name: "beats", at: body.freshness.beatsAt },
      { name: "mood", at: body.freshness.moodAt },
    ].map((a) => ({ ...a, f: ledgerFreshness(a.at) }));
    log(
      `ledger freshness — ${bands
        .map(
          (b) =>
            `${b.name}: ${b.f.ageHours === null ? "no analysis yet" : formatAge(b.f)}`,
        )
        .join(" · ")}`,
    );
    if (body.appliedMode) {
      log(
        `wrote ${body.written} comments · backup: ${body.backedUpTo ?? "none"} · ${body.verify.detail}`,
      );
    } else {
      log(
        `dry-run — re-run with --apply --yes (rekordbox quit) to write ${body.eligible} comments`,
      );
    }
  });
}
