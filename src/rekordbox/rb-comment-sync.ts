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
 *
 * Split per concern (#232): the runtime, gates, and the rbCommentSync
 * sequencer + apply leg live here; the payload parsers, verification
 * contract, and ledger-freshness read live in rb-comment-sync-parse.ts.
 */
import { existsSync } from "node:fs";
import {
  applyConfirmed,
  applyConfirmationRefusal,
  compensateRestore,
  printResult,
  pyUvFileArgv,
  rbCommandRuntime,
  type RbCommandResult,
  type RbCommandRuntime,
} from "./rb-command-kit.js";
import { masterDbPath } from "./master-path.js";
import { errMessage as errorText } from "../shared/leaf/fmt";
import { formatAge, ledgerFreshness } from "../deck/shared/ledger-freshness";
import {
  ledgerFreshnessOf,
  parseSyncOutput,
  parseVerifyOutput,
  validateVerification,
  type SyncOutput,
} from "./rb-comment-sync-parse";

export interface RbCommentSyncOptions {
  mount: string;
  /** Only sync rows whose FolderPath contains this token (batch scope). */
  batch?: string | undefined;
  apply?: boolean | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
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
        args: [dbPath, ledger, mode, opts.batch ?? ""],
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
