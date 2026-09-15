/**
 * rb-command-kit — the shared plumbing of the rb-* master.db commands
 * (rb-cues, rb-comment-sync; rb-dedup's richer variant may migrate later).
 *
 * One runtime seam (the DI object every command test suite injects), one
 * guarded JSON boundary parser, and the pair/triple guards both commands'
 * output validators need. Extracted from byte-identical twins that jscpd
 * flagged across rb-cues.ts / rb-comment-sync.ts — a fix to the spawn
 * contract or the parse guard must land everywhere at once, never in one
 * command only.
 */
import { spawnSync } from "node:child_process";
import { isUnknownArray } from "../../cratedeck/shared/guards";
import {
  assertRbClosed,
  backupMaster,
  fileExistsSafe,
  restoreMasterBackup,
  sleepSync,
} from "./guard.js";
import { errorText } from "../shared/error-text";

/** One subprocess result — the raw spawn boundary every command inspects. */
export interface RbCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** The dependency seam rb-* commands hand to tests: stub any member and the
 *  command runs filesystem/subprocess-free. Shapes are load-bearing — three
 *  test suites inject this object. */
export interface RbCommandRuntime {
  fileExists: (path: string) => boolean;
  assertClosed: (what: string) => void;
  backup: (path: string) => string;
  restore: (dbPath: string, backupPath: string) => void;
  sleep: (ms: number) => void;
  spawn: (
    command: string[],
    timeoutMs: number,
    input?: string,
  ) => RbCommandResult;
}

/** The production runtime: guard.ts seams + one spawnSync body. */
export const rbCommandRuntime: RbCommandRuntime = {
  fileExists: fileExistsSafe,
  assertClosed: assertRbClosed,
  backup: backupMaster,
  restore: restoreMasterBackup,
  sleep: sleepSync,
  spawn(command, timeoutMs, input) {
    const executable = command[0];
    if (executable === undefined) throw new Error("empty subprocess command");
    const result = spawnSync(executable, command.slice(1), {
      encoding: "utf8",
      timeout: timeoutMs,
      input,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  },
};

/** Guarded subprocess-JSON boundary: malformed success output throws with
 *  the calling context — it can never become a false success (the census
 *  guards JSON.parse by this catch-and-rethrow shape). */
export function parseJsonBoundary(raw: string, context: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${context} returned malformed JSON`, { cause: error });
  }
}

/** A pyrekordbox content/playlist id crosses the subprocess boundary as a
 *  decimal STRING (64-bit ids would lose precision as JS numbers). Null is
 *  the script's "absent" value, not a parse failure. */
export function isDecimalIdOrNull(value: unknown): value is string | null {
  return (
    value === null || (typeof value === "string" && DECIMAL_ID_RE.test(value))
  );
}

/** /^(?:0|[1-9]\d*)$/u — shared by every rb-* writer's id fields. */
export const DECIMAL_ID_RE = /^(?:0|[1-9]\d*)$/u;

/** [string, string] pair guard (error/skip/write rows). */
export function isStringPair(value: unknown): value is [string, string] {
  return (
    isUnknownArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === "string")
  );
}

/** [string, string, string] triple guard (mismatch rows). */
export function isStringTriple(
  value: unknown,
): value is [string, string, string] {
  return (
    isUnknownArray(value) &&
    value.length === 3 &&
    value.every((part) => typeof part === "string")
  );
}

/** [string, number] pair guard where the number is a count/Kind — it must
 *  be a finite non-negative INTEGER, not merely a number (rb-cues cue
 *  Kind mismatch rows; weakened guards would admit fractional/negative
 *  junk from a subprocess payload). */
export function isStringNumberPair(value: unknown): value is [string, number] {
  return (
    isUnknownArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]) &&
    Number.isInteger(value[1]) &&
    value[1] >= 0
  );
}

/** Human message for an unknown throw value (kit-wide convention). */
export function errorMessage(error: unknown): string {
  return errorText(error);
}

/** The pre-commit rekordbox re-check, interpolated into every generated
 *  python script immediately before `db.session.commit()`. Python-side
 *  twin of `assertRbClosed` (guard.ts): the TS gate runs at command start,
 *  this one shrinks the check-to-write window to ~nothing. ONE constant so
 *  the two gates can never drift apart (process list, flags, semantics). */
export const RB_CLOSED_PY_GUARD =
  'if subprocess.run(["pgrep", "-x", "rekordbox"], capture_output=True).returncode == 0:';

/** Compensating restore: put the backup family back after a post-backup
 *  failure. Returns the failure detail either way — a failed RESTORE is
 *  surfaced as "restoring backup … also failed", never swallowed. Both
 *  rb-cues and rb-comment-sync compensate identically; one implementation
 *  so the restore contract cannot drift between them. */
export function compensateRestore(
  deps: Pick<RbCommandRuntime, "restore">,
  dbPath: string,
  backedUpTo: string,
  error: unknown,
): string {
  const original = errorMessage(error);
  try {
    deps.restore(dbPath, backedUpTo);
    return `${original}; restored backup ${backedUpTo}`;
  } catch (restoreError) {
    return `${original}; restoring backup ${backedUpTo} also failed: ${errorMessage(restoreError)}`;
  }
}

/** Options subset every two-step gate reads. */
export interface ApplyOptions {
  apply?: boolean | undefined;
  yes?: boolean | undefined;
  /** Mutating flag name for the refusal wording — `--apply` for most
   *  verbs, `--quarantine` for rb-unmatched/shelf-dupescan. */
  flag?: "--apply" | "--quarantine" | undefined;
}

/** THE two-step gate (issue #79): mutating verbs run dry-run unless BOTH
 *  the apply flag and --yes are present. Returns null when the apply is
 *  confirmed; otherwise the refusal message for the caller to project
 *  through its own fail() builder — the RULE lives here, the wording
 *  projection stays with each command's result shape. Semantics:
 *  flag present + yes missing is the refusal case; --yes without the flag
 *  is a harmless dry-run. Flag validation must precede any I/O (guard
 *  order, per the hygiene precedent). */
export function applyConfirmationRefusal(opts: ApplyOptions): string | null {
  const flag = opts.flag ?? "--apply";
  if (opts.apply && !opts.yes)
    return `${flag} requires --yes (two-step safety — dry-run first, ALWAYS)`;
  return null;
}

/** Positive form of the same rule: the mutation is confirmed to run —
 *  the flag is present AND --yes backs it. One definition so `applied`
 *  computations and refusal gates can never disagree about what
 *  "confirmed" means. A dry-run (no flag) is NOT confirmed. */
export function applyConfirmed(opts: ApplyOptions): boolean {
  return opts.apply === true && opts.yes === true;
}

/** THE human-mode report preamble (issue #75): every `print*Report`
 *  opened with the same 4 lines — error short-circuit, then the body.
 *  One helper; the body callback keeps each command's layout. The
 *  `--json` path is untouched (these are human-mode printers only).
 *  Output bytes are identical to the inlined form. */
export function printResult<T extends { error?: string }>(
  log: (s: string) => void,
  r: T,
  body: (r: T) => void,
): void {
  if (r.error) {
    log(`error: ${r.error}`);
    return;
  }
  body(r);
}
