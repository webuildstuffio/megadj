/**
 * megadj rb-cues — THE seam between the megadj cue ledger and the
 * rekordbox master DB (postmortem F1/F3; doc:
 * docs/fulltags/intake-cue-postmortem.md). Every djmdCue write goes through here —
 * never hand-roll DjmdCue(...) in a script again (that's how pads got
 * Kind=0 non-clickable cues on Sep 12).
 *
 * DB-side truth (pinned by the Sep 13 F4 spike, RB7-written evidence):
 *   - Kind: 0 = memory cue, 1 = hot cue (pad-clickable), 2 = loop cue.
 *     The broken Sep 12 intake writer used 0 for intended hot cues; repair
 *     only those provenance-pinned rows, never arbitrary memory cues.
 *   - ColorTableIndex=0 and Color=255 are what RB itself writes; label
 *     text rides `Comment` (RB writes e.g. '1.1Bars').
 *   - XML POSITION_MARK is the OPPOSITE convention (Num 0..7 = hot,
 *     -1 = memory). Never copy XML semantics here.
 *
 * Surfaces:
 *   - restampKind(): one-shot repair — flip intake-written hot cues
 *     Kind 0 → 1 (BUG-1 fix), gated + backed up + re-read verified.
 *   - writeFromLedger(): plan §AC-05 semantic layout writer (F3): ledger
 *     cues in, ≤8 hot cues out, dry-run default, gates per §AC-06.
 */

import {
  isNonNegativeInteger,
  isRecord,
  isUnknownArray,
} from "../../cratedeck/shared/guards";
import { incidentCuePredicatePython } from "./cue-incident.js";
import {
  applyConfirmed,
  applyConfirmationRefusal,
  compensateRestore,
  DECIMAL_ID_RE,
  isStringNumberPair,
  isStringPair,
  lastJsonLine,
  makeFail,
  parseJsonBoundary,
  printResult,
  pyUvArgv,
  RB_CLOSED_PY_GUARD,
  rbCommandRuntime,
  type RbCommandResult,
  type RbCommandRuntime,
} from "./rb-command-kit.js";
import { pyDbOpen, pyDbOpenImports } from "./rb-script-kit.js";
import { commandLog } from "../progress";
import { masterDbPath } from "./master-path.js";
import { errorText } from "../shared/error-text";

/** DB-side hot cue Kind — pinned by F4 (RB7-written rows: 1 only). */
export const HOT_CUE_KIND = 1;
/** DB-side loop cue Kind (seen 6× in the wild). */
export const LOOP_CUE_KIND = 2;
/** Pads address hot cues 1..8; anything beyond is unreachable. */
export const MAX_HOT_CUES = 8;

export type RbCuesMode = "restamp" | "ledger";

export interface RbCuesOptions {
  /** Drive mount root (master DB at <mount>/PIONEER/Master/master.db)
   *  or explicit DB path via MEGADJ_RB_MASTER. */
  mount: string;
  /** Repair mode: flip intake-written hot cues Kind 0 → 1 (BUG-1). */
  restamp?: boolean | undefined;
  /** Write semantic cues from the ledger (F3). */
  fromLedger?: boolean | undefined;
  /** Replace existing hot cues per track (ledger write mode). */
  force?: boolean | undefined;
  apply?: boolean | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
  log?: (s: string) => void;
}

export interface RbCuesResult {
  command: "rb-cues";
  db: string;
  mode: RbCuesMode;
  /** Cue rows inspected (restamp: incident-matching rows; ledger: tracks). */
  found: number;
  /** Rows written / re-stamped (0 in dry-run). */
  written: number;
  /** Tracks skipped by gates (ledger mode) — with reasons. */
  gated: { track: string; reason: string }[];
  /** Re-read verification failures — must be 0 to be ok. */
  verifyFailures: string[];
  appliedMode: boolean;
  backedUpTo: string | null;
  ok: boolean;
  error?: string;
}

interface RestampOutput {
  found: number;
  written: number;
  protected: number;
  writtenIds: string[];
  errors: [string, string][];
}

interface CueVerifyOutput {
  total: number;
  matched: number;
  remaining: number;
  missing: string[];
  mismatched: [string, number][];
}

type CueCommandResult = RbCommandResult;

type RbCuesRuntime = RbCommandRuntime;

const runtime: RbCuesRuntime = rbCommandRuntime;

const nonNegativeInteger = isNonNegativeInteger;

const isKindPair = isStringNumberPair;

/** Shorthand: `written_ids: string[]` with every entry a string. */
const isStringList = (v: unknown): v is string[] =>
  isUnknownArray(v) && v.every((id) => typeof id === "string");

/** Decimal ids, unique — the write-acknowledgement rule. */
function isUniqueDecimalIdList(ids: string[]): boolean {
  return (
    ids.every((id) => DECIMAL_ID_RE.test(id)) &&
    new Set(ids).size === ids.length
  );
}

/** Cross-field consistency checks over an already shape-valid payload —
 *  the first failure wins, in the original throw order. Returns the
 *  full error message to throw, or null when every check holds. */
function restampConsistencyError(
  output: RestampOutput,
  apply: boolean,
): string | null {
  if (output.errors.length > 0) {
    const detail = output.errors.map(([id, err]) => `${id}: ${err}`).join("; ");
    return `rb-cues restamp transaction failed: ${detail}`;
  }
  if (apply && output.written !== output.found)
    return `rb-cues restamped ${output.written}/${output.found} rows`;
  if (output.writtenIds.length !== output.written)
    return "rb-cues write acknowledgements are incomplete";
  if (!apply && output.written !== 0)
    return "rb-cues census mode unexpectedly wrote rows";
  if (!isUniqueDecimalIdList(output.writtenIds))
    return "rb-cues returned invalid or duplicate cue ids";
  return null;
}

function parseRestampOutput(raw: string, apply: boolean): RestampOutput {
  const value = parseJsonBoundary(raw, "rb-cues restamp");
  if (
    !isRecord(value) ||
    !nonNegativeInteger(value.found) ||
    !nonNegativeInteger(value.written) ||
    !nonNegativeInteger(value.protected) ||
    !isStringList(value.written_ids) ||
    !isUnknownArray(value.errors) ||
    !value.errors.every(isStringPair)
  ) {
    throw new Error("rb-cues restamp returned an invalid result payload");
  }
  const output: RestampOutput = {
    found: value.found,
    written: value.written,
    protected: value.protected,
    writtenIds: value.written_ids,
    errors: value.errors,
  };
  const error = restampConsistencyError(output, apply);
  if (error) throw new Error(error);
  return output;
}

function parseVerifyOutput(raw: string): CueVerifyOutput {
  const value = parseJsonBoundary(raw, "rb-cues verification");
  if (
    !isRecord(value) ||
    !nonNegativeInteger(value.total) ||
    !nonNegativeInteger(value.matched) ||
    !nonNegativeInteger(value.remaining) ||
    !isUnknownArray(value.missing) ||
    !value.missing.every((id) => typeof id === "string") ||
    !isUnknownArray(value.mismatched) ||
    !value.mismatched.every(isKindPair)
  ) {
    throw new Error("rb-cues verification returned an invalid payload");
  }
  return {
    total: value.total,
    matched: value.matched,
    remaining: value.remaining,
    missing: value.missing,
    mismatched: value.mismatched,
  };
}

function validateVerification(
  expectedIds: readonly string[],
  result: CueVerifyOutput,
): void {
  if (result.total !== expectedIds.length)
    throw new Error(
      `cue verification read ${result.total}/${expectedIds.length} intended rows`,
    );
  if (result.missing.length > 0)
    throw new Error(
      `cue verification missing ids: ${result.missing.join(", ")}`,
    );
  if (result.mismatched.length > 0)
    throw new Error(
      `cue verification found non-hot ids: ${result.mismatched.map(([id]) => id).join(", ")}`,
    );
  if (result.matched !== expectedIds.length)
    throw new Error(
      `cue verification matched ${result.matched}/${expectedIds.length} intended rows`,
    );
  if (result.remaining !== 0)
    throw new Error(`${result.remaining} Kind=0 rows survived the re-read`);
}

function cueVerifyScript(): string {
  return `
import json, sys
${pyDbOpenImports()}
from pyrekordbox.db6.tables import DjmdCue
expected = [str(i) for i in json.load(sys.stdin)]
${pyDbOpen("sys.argv[1]")}
rows = db.query(DjmdCue).filter(DjmdCue.ID.in_([int(i) for i in expected])).all() if expected else []
actual = {str(row.ID): int(row.Kind) for row in rows}
remaining = sum(1 for i in expected if actual.get(i) == 0)
db.close()
missing = sorted(i for i in expected if i not in actual)
mismatched = [[i, actual[i]] for i in expected if i in actual and actual[i] != 1]
matched = sum(1 for i in expected if actual.get(i) == 1)
print(json.dumps({"total": len(actual), "matched": matched, "remaining": remaining, "missing": missing, "mismatched": mismatched}))
`;
}

function dbPathFor(mount: string): string {
  return masterDbPath(mount);
}

/**
 * The one-shot BUG-1 repair. Kind=0 is also the legitimate collection-DB
 * value for memory cues, so a broad Kind=0 rewrite is unsafe. The broken
 * Sep 12 intake writer left a provenance signature pinned from the sacred
 * pre-repair backup: a 14-minute creation window, its semantic label/color
 * vocabulary, NULL RB-authored cue fields, and a content path under this
 * shelf's Contents tree. Only rows matching every part are candidates.
 */
export function restampScript(): string {
  return `
import datetime, json, os, subprocess, sys
${pyDbOpenImports()}
from pyrekordbox.db6.tables import DjmdContent, DjmdCue

db_path = sys.argv[1]
apply = sys.argv[2] == "apply"
mount = os.path.abspath(sys.argv[3])
${pyDbOpen("db_path")}
all_kind_zero = db.query(DjmdCue).filter(DjmdCue.Kind == 0).all()
contents = os.path.normpath(os.path.join(mount, "Contents"))
content_paths = {str(content.ID): content.FolderPath or "" for content in db.query(DjmdContent).all()}
${incidentCuePredicatePython()}

rows = [cue for cue in all_kind_zero if is_incident_cue(cue)]
out = {"found": len(rows), "written": 0, "protected": len(all_kind_zero) - len(rows),
       "written_ids": [], "errors": []}
if apply:
    try:
        for r in rows:
            r.Kind = 1
        ${RB_CLOSED_PY_GUARD}
            raise RuntimeError("rekordbox reopened before cue commit")
        db.session.commit()
        out["written_ids"] = [str(r.ID) for r in rows]
        out["written"] = len(out["written_ids"])
    except Exception as e:
        db.session.rollback()
        out["errors"].append(["transaction", repr(e)[:200]])
print(json.dumps(out))
db.close()
`;
}

export async function rbCues(opts: RbCuesOptions): Promise<RbCuesResult> {
  return rbCuesWithRuntime(opts, runtime);
}

function gatedFor(protectedRows: number): { track: string; reason: string }[] {
  return protectedRows === 0
    ? []
    : [
        {
          track: "collection",
          reason: `${protectedRows} Kind=0 row(s) did not match the Sep 12 intake provenance signature and were preserved`,
        },
      ];
}

async function rbCuesWithRuntime(
  opts: RbCuesOptions,
  deps: RbCuesRuntime,
): Promise<RbCuesResult> {
  const log = opts.log ?? commandLog({ json: opts.json });
  const dbPath = dbPathFor(opts.mount);
  const mode: RbCuesMode = opts.fromLedger ? "ledger" : "restamp";
  const apply = applyConfirmed(opts);

  const fail = makeFail((msg: string): RbCuesResult => ({
    command: "rb-cues",
    db: dbPath,
    mode,
    found: 0,
    written: 0,
    gated: [],
    verifyFailures: [],
    appliedMode: apply,
    backedUpTo: null,
    ok: false,
    error: msg,
  }));

  if (applyConfirmationRefusal(opts) !== null)
    return fail(applyConfirmationRefusal(opts) ?? "unreachable");
  if (mode === "ledger")
    return fail(
      "ledger write mode lands with F3 (semantic engine port) — restamp is today's P0",
    );

  try {
    deps.assertClosed("rb-cues");
  } catch (e) {
    return fail((e as Error).message);
  }
  if (!deps.fileExists(dbPath)) {
    // master.db must exist; backupMaster re-checks
    return fail(`no master DB at ${dbPath} (is the drive mounted?)`);
  }

  if (apply) {
    return restampApplyLeg(opts, deps, dbPath, mode, fail, log);
  }

  // Census (dry-run) leg: read-only probe of the incident signature.
  let result: CueCommandResult;
  try {
    result = deps.spawn(
      pyUvArgv({
        script: restampScript(),
        args: [dbPath, "census", opts.mount],
      }),
      120_000,
    );
  } catch (error) {
    return fail(errorText(error));
  }
  if (result.status !== 0 || !result.stdout)
    return fail(
      `census failed (exit ${String(result.status)}): ${result.stderr.slice(-300)}`,
    );
  let output: RestampOutput;
  try {
    output = parseRestampOutput(lastJsonLine(result.stdout), false);
  } catch (error) {
    return fail(errorText(error));
  }

  return {
    command: "rb-cues",
    db: dbPath,
    mode,
    found: output.found,
    written: 0,
    gated: gatedFor(output.protected),
    verifyFailures: [],
    appliedMode: false,
    backedUpTo: null,
    ok: true,
  };
}

/** The apply leg: dated backup → restamp → delayed re-read verify, with
 *  compensation (restore) on any failure after the backup. Split out of
 *  rbCuesWithRuntime so the mode dispatch stays readable. */
function restampApplyLeg(
  opts: RbCuesOptions,
  deps: RbCuesRuntime,
  dbPath: string,
  mode: RbCuesMode,
  fail: (msg: string) => RbCuesResult,
  log: (s: string) => void,
): RbCuesResult {
  let backedUpTo: string;
  try {
    backedUpTo = deps.backup(dbPath);
  } catch (error) {
    return fail(errorText(error));
  }

  const compensate = (error: unknown): RbCuesResult => {
    const detail = compensateRestore(deps, dbPath, backedUpTo, error);
    return {
      ...fail(detail),
      backedUpTo,
      verifyFailures: [detail],
    };
  };

  try {
    deps.assertClosed("rb-cues --apply");
    const r = deps.spawn(
      pyUvArgv({
        script: restampScript(),
        args: [dbPath, "apply", opts.mount],
      }),
      300_000,
    );
    if (r.status !== 0 || !r.stdout)
      throw new Error(
        `restamp failed (exit ${String(r.status)}): ${r.stderr.slice(-300)}`,
      );
    const output = parseRestampOutput(lastJsonLine(r.stdout), true);
    deps.sleep(250);
    deps.assertClosed("rb-cues verification");
    const zeroCheck = deps.spawn(
      pyUvArgv({ script: cueVerifyScript(), args: [dbPath] }),
      120_000,
      JSON.stringify(output.writtenIds),
    );
    if (zeroCheck.status !== 0 || !zeroCheck.stdout)
      throw new Error(
        `cue verification failed (exit ${String(zeroCheck.status)}): ${zeroCheck.stderr.slice(-300)}`,
      );
    const checked = parseVerifyOutput(lastJsonLine(zeroCheck.stdout));
    validateVerification(output.writtenIds, checked);
    log(
      `re-read: ${checked.matched}/${checked.total} intended cue rows, ${checked.remaining} Kind=0 remaining`,
    );
    return {
      command: "rb-cues",
      db: dbPath,
      mode,
      found: output.found,
      written: output.written,
      gated: gatedFor(output.protected),
      verifyFailures: [],
      appliedMode: true,
      backedUpTo,
      ok: true,
    };
  } catch (error) {
    return compensate(error);
  }
}

export const __test = {
  run: rbCuesWithRuntime,
  parseRestampOutput,
  parseVerifyOutput,
  validateVerification,
  cueVerifyScript,
};

export function printRbCuesReport(
  r: RbCuesResult,
  log: (s: string) => void,
): void {
  printResult(log, r, (body) => {
    if (body.appliedMode) {
      log(
        `restamped ${body.written}/${body.found} cue rows to Kind=1 (hot) · backup: ${body.backedUpTo ?? "none"}`,
      );
      log(
        body.verifyFailures.length
          ? `VERIFY FAILED: ${body.verifyFailures.join("; ")}`
          : `re-read verified: 0 incident Kind=0 rows remain`,
      );
    } else {
      log(
        `dry-run — ${body.found} Sep 12 intake cues match the broken Kind=0 signature · re-run with --apply --yes (rekordbox quit) to fix`,
      );
      for (const gate of body.gated) log(`protected: ${gate.reason}`);
    }
  });
}
