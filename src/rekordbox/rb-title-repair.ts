/**
 * rb-title-repair — fix truncated + contaminated titles in master.db
 * by reading the correct title from each audio file's embedded tags.
 *
 * Three classes of defect:
 *   1. Truncated: 44-char filename stem wall from legacy downloads
 *   2. Contaminated: "Artist - Title" stuck in the Title field
 *   3. Paren-mismatch: unbalanced parens from truncation
 *
 * Safety: report-only by default, RB-closed gate, dated backup, WAL
 * checkpoint. Delegates to title-repair.kit.py via rbPythonFile.
 */

import { DB_PATH } from "../cli-env";
import { masterDbPath } from "./master-path.js";
import {
  applyConfirmationRefusal,
  applyConfirmed,
  compensateRestore,
  isStringTriple,
  kitErrorReason,
  parseJsonBoundary,
  printResult,
  pyUvFileArgv,
  rbCommandRuntime,
  type RbCommandRuntime,
} from "./rb-command-kit.js";
import { errMessage as errorText } from "../shared/leaf/fmt";
import { isRecord, isUnknownArray } from "../shared/leaf/guards";

export interface RbTitleRepairOptions {
  mount: string;
  apply?: boolean | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
  log?: (s: string) => void;
}

export interface RbTitleRepairResult {
  command: "rb-title-repair";
  db: string;
  scanned: number;
  truncatedFixed: number;
  contaminationFixed: number;
  parenFixed: number;
  skippedMissing: number;
  skippedNoTag: number;
  alreadyGood: number;
  applied: boolean;
  samples: [string, string, string][];
  errors: string[];
  error?: string;
  ok: boolean;
}

export async function rbTitleRepair(
  opts: RbTitleRepairOptions,
  deps: RbCommandRuntime = rbCommandRuntime,
): Promise<RbTitleRepairResult> {
  const dbPath = masterDbPath(opts.mount);
  const log = opts.log ?? console.log;

  const mk = (
    msg: string,
    partial: Partial<RbTitleRepairResult> = {},
  ): RbTitleRepairResult => ({
    command: "rb-title-repair",
    db: dbPath,
    scanned: 0,
    truncatedFixed: 0,
    contaminationFixed: 0,
    parenFixed: 0,
    skippedMissing: 0,
    skippedNoTag: 0,
    alreadyGood: 0,
    applied: false,
    samples: [],
    errors: [msg],
    error: msg,
    ok: false,
    ...partial,
  });

  const refusal = applyConfirmationRefusal(opts);
  if (refusal !== null) return mk(refusal);
  if (!deps.fileExists(dbPath)) return mk(`no master DB at ${dbPath}`);
  try {
    deps.assertClosed("rb-title-repair");
  } catch (e) {
    return mk((e as Error).message);
  }

  const apply = applyConfirmed(opts);

  let backedUpTo: string | undefined;
  if (apply) {
    backedUpTo = deps.backup(dbPath);
    log(`backup: ${backedUpTo}`);
  }

  try {
    const result = deps.spawn(
      pyUvFileArgv({
        file: "title-repair.kit.py",
        args: [dbPath, DB_PATH, apply ? "apply" : "report"],
        withPkg: "pyrekordbox,mutagen",
      }),
      300_000,
    );

    if (result.status !== 0) {
      if (backedUpTo)
        compensateRestore(deps, dbPath, backedUpTo, result.stderr);
      // the guard's refusal reason rides stdout as {"error": ...} JSON;
      // stderr alone would report an empty `title-repair failed (exit 1):`
      const reason =
        kitErrorReason(result.stdout) ?? result.stderr.slice(0, 300);
      return mk(`title-repair failed (exit ${result.status}): ${reason}`);
    }

    const value = parseJsonBoundary(result.stdout, "rb-title-repair");
    if (!isRecord(value)) {
      if (backedUpTo) compensateRestore(deps, dbPath, backedUpTo, "bad json");
      return mk("title-repair returned invalid payload");
    }

    const samples: [string, string, string][] = [];
    if (isUnknownArray(value["samples"])) {
      for (const s of value["samples"]) {
        if (isStringTriple(s)) samples.push(s);
      }
    }

    const n = (k: string): number => {
      const v = value[k];
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    };

    // The kit payload carries no errors key (#514): a failure exits
    // nonzero with {"error": ...} on stdout, handled above — exit 0 with
    // valid JSON is a clean run.
    const r: RbTitleRepairResult = {
      command: "rb-title-repair",
      db: dbPath,
      scanned: n("scanned"),
      truncatedFixed: n("truncated_fixed"),
      contaminationFixed: n("contamination_fixed"),
      parenFixed: n("paren_fixed"),
      skippedMissing: n("skipped_missing"),
      skippedNoTag: n("skipped_no_tag"),
      alreadyGood: n("already_good"),
      applied: apply,
      samples,
      errors: [],
      ok: true,
    };

    if (apply) {
      deps.sleep(500);
      log(
        `title-repair: ${r.truncatedFixed} truncated, ${r.contaminationFixed} contamination, ${r.parenFixed} paren → fixed`,
      );
    }

    return r;
  } catch (e) {
    if (backedUpTo) compensateRestore(deps, dbPath, backedUpTo, e);
    return mk(errorText(e));
  }
}

export function printRbTitleRepairReport(
  r: RbTitleRepairResult,
  rLog: (s: string) => void = console.log,
): void {
  const total = r.truncatedFixed + r.contaminationFixed + r.parenFixed;
  printResult(rLog, r, (body) => {
    rLog(
      `${body.scanned} scanned · ${body.truncatedFixed} truncated · ${body.contaminationFixed} contamination · ${body.parenFixed} paren`,
    );
    rLog(
      `skipped: ${body.skippedMissing} missing file, ${body.skippedNoTag} no tag · ${body.alreadyGood} already good`,
    );
    rLog(
      body.applied
        ? `applied: ${total} titles fixed`
        : `${total} fixable (dry run — add --apply --yes)`,
    );
    if (body.samples.length > 0) {
      rLog("\nsamples:");
      for (const [cls, old, fixed] of body.samples) {
        rLog(`  [${cls}] "${old}" → "${fixed}"`);
      }
    }
  });
}
