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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord, isUnknownArray } from "../../cratedeck/shared/guards";
import {
  assertRbClosed,
  backupMaster,
  fileExistsSafe,
  restoreMasterBackup,
  sleepSync,
} from "./guard.js";
import { incidentCuePredicatePython } from "./cue-incident.js";
import {
  PY_CUE_SIG_BLOCK,
  PY_FIND_PLAYLIST_FN,
  PY_MATCH_TRACK_STEP,
  PY_RID_FN,
  pyAddSongPlaylist,
  pyContentMatchPreamble,
  pyDbOpen,
  pyDbOpenBlock,
  pyDbOpenImports,
  pyEnsurePlaylistLadder,
  pyPathKeyFn,
} from "./rb-script-kit.js";
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

/** The ONE guarded subprocess-payload parser factory (#202): every rb-*
 *  parseWriteOutput/parseVerifyOutput was the same hand-rolled skeleton —
 *  parseJsonBoundary, isRecord, per-field predicates, typed assembly.
 *  Bind once per payload shape; the returned parser throws
 *  invalidMessage for a non-record payload or any failed field guard.
 *  Guards must cover EVERY key of T (enforced by the mapped type) so a
 *  new field cannot skip the boundary check. */
export function makePayloadParser<T extends object>(
  context: string,
  invalidMessage: string,
  guards: { [K in keyof T]-?: (v: unknown) => v is T[K] },
): (raw: string) => T {
  return (raw) => {
    const value: unknown = parseJsonBoundary(raw, context);
    if (!isRecord(value)) throw new Error(invalidMessage);
    for (const [field, guard] of Object.entries(guards)) {
      if (!(guard as (v: unknown) => boolean)(value[field]))
        throw new Error(invalidMessage);
    }
    return value as T;
  };
}

/** THE python-subprocess argv (#68): `["run","--with",pkg,"python","-c",
 *  script, …args]` — every rb-* python spawn (direct rbPythonRun, DI
 *  deps.spawn sites, runPyScript) assembles its command line HERE. The
 *  `--with` package defaults to plain "pyrekordbox"; the pinned PYRK_TAG
 *  fork spec rides as an explicit `withPkg`. A pyrekordbox API change is
 *  a one-line edit, not a seven-site hunt. */
export function pyUvArgv(opts: {
  script: string;
  args?: string[];
  withPkg?: string;
}): string[] {
  return [
    "run",
    "--with",
    opts.withPkg ?? "pyrekordbox",
    "python",
    "-c",
    opts.script,
    ...(opts.args ?? []),
  ];
}

/** DI-runtime variant of rbPythonFile (#194): renders a corpus file's
 *  kit markers and returns the same argv shape pyUvArgv produces, so
 *  deps.spawn sites run the corpus without a second spawn contract. */
export function pyUvFileArgv(opts: {
  file: string;
  args?: string[];
  withPkg?: string;
}): string[] {
  const script = renderKitMarkers(
    readFileSync(join(import.meta.dir, "rb-scripts", opts.file), "utf8"),
  );
  return pyUvArgv({
    script,
    ...(opts.args === undefined ? {} : { args: opts.args }),
    ...(opts.withPkg === undefined ? {} : { withPkg: opts.withPkg }),
  });
}

/** The corpus twin of rbPythonRun (#194): `uv run --with <pkg> python
 *  <file> [argv…]` where <file> lives in src/rekordbox/rb-scripts/. The
 *  python corpus is mypy/ruff-gated (pyproject files list) exactly like
 *  cratedeck/python — an inline -c string cannot be. New scripts go in
 *  the corpus, not into another template literal.
 *
 *  Composed programs (#194 acceptance): a corpus file may embed
 *  `#@kit(NAME)` marker lines where an rb-script-kit fragment belongs
 *  (`#@kit(pyPathKeyFn)`, `#@kit(pyEnsurePlaylistLadder reuse)`, …).
 *  Markers are rendered by `renderKitMarkers` immediately before the
 *  spawn — the kit fragment stays the single SSOT, the corpus file stays
 *  a real lintable python program. */
export function renderKitMarkers(source: string): string {
  const out: string[] = [];
  for (const line of source.split("\n")) {
    const match =
      /^[ \t]*#[ \t]*[@]kit[(](\w+)(?:[ \t]+([^)]*))?(?:;([ \t]*\d+[ \t]*))?[)][ \t]*$/u.exec(
        line,
      );
    if (!match) {
      out.push(line);
      continue;
    }
    const name: string = match[1] ?? "";
    const arg = match[2]?.trim() ?? "";
    const indent = match[3]
      ? " ".repeat(Math.max(0, parseInt(match[3], 10) || 0))
      : "";
    const rendered = renderKitFragment(name, arg);
    if (rendered === null)
      throw new Error(`rb-scripts: unknown #@kit(${name}) marker`);
    const body = rendered.replace(/^\n+|\n+$/g, "");
    // Preserve the fragment's INTERNAL relative indentation: every line
    // shifts by the marker's indent, keeping intra-fragment offsets.
    const bodyLines = body.split("\n");
    const base = Math.min(
      ...bodyLines
        .filter((l) => l.trim() !== "")
        .map((l) => l.length - l.trimStart().length),
    );
    out.push(
      bodyLines
        .map((l) => (l.trim() === "" ? l : indent + l.slice(base)))
        .join("\n"),
    );
  }
  return out.join("\n");
}

/** Marker name → rb-script-kit fragment. One table so a fragment rename
 *  is one edit here plus the corpus file. */
function renderKitFragment(name: string, arg: string): string | null {
  switch (name) {
    case "pyPathKeyFn":
      return pyPathKeyFn();
    case "pyContentMatchPreamble":
      return pyContentMatchPreamble();
    case "PY_MATCH_TRACK_STEP":
      return PY_MATCH_TRACK_STEP;
    case "PY_FIND_PLAYLIST_FN":
      return PY_FIND_PLAYLIST_FN;
    case "PY_RID_FN":
      return PY_RID_FN;
    case "PY_CUE_SIG_BLOCK":
      return PY_CUE_SIG_BLOCK;
    case "pyDbOpenBlock":
      return pyDbOpenBlock(arg || "sys.argv[1]");
    case "pyDbOpenImports":
      return pyDbOpenImports();
    case "pyDbOpen":
      return pyDbOpen(arg || "sys.argv[1]");
    case "RB_CLOSED_PY_GUARD":
      return RB_CLOSED_PY_GUARD;
    case "pyEnsurePlaylistLadder": {
      // arg is "<createMissingGroup>|<onExisting>", e.g. "true|reuse"
      const [group, existing] = arg.split("|").map((p) => p.trim());
      if (group === undefined || existing === undefined) return null;
      if (group !== "true" && group !== "false") return null;
      if (existing !== "refuse" && existing !== "reuse") return null;
      return pyEnsurePlaylistLadder({
        createMissingGroup: group === "true",
        onExisting: existing,
      });
    }
    case "pyAddSongPlaylist":
      return pyAddSongPlaylist("sp", "pl.ID", "cid", "track_no + 1");
    case "incidentCuePredicatePython":
      return incidentCuePredicatePython();
    default:
      return null;
  }
}

export function rbPythonFile(opts: {
  /** Corpus file NAME (not path) — resolved against rb-scripts/. */
  file: string;
  args?: string[];
  timeoutMs: number;
  withPkg?: string;
  maxBuffer?: number;
  input?: string;
}): { status: number | null; stdout: string; stderr: string } {
  const file = join(import.meta.dir, "rb-scripts", opts.file);
  const script = renderKitMarkers(readFileSync(file, "utf8"));
  const result = spawnSync(
    "uv",
    [
      "run",
      "--with",
      opts.withPkg ?? "pyrekordbox",
      "python",
      "-c",
      script,
      ...(opts.args ?? []),
    ],
    {
      encoding: "utf8",
      timeout: opts.timeoutMs,
      ...(opts.maxBuffer === undefined ? {} : { maxBuffer: opts.maxBuffer }),
      ...(opts.input === undefined ? {} : { input: opts.input }),
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
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

/** string[] guard for subprocess payload arrays (#95: one SSOT, the
 *  rb-playlist local twin removed). */
export function isStringArray(value: unknown): value is string[] {
  return isUnknownArray(value) && value.every((v) => typeof v === "string");
}

/** Last stdout line extractor — pyrekordbox scripts print progress noise
 *  and put the JSON payload on the final line. One seam for the 20+
 *  `stdout.trim().split("\n").pop()` call sites (#95). Scope: rb-*
 *  commands only — `shared/doctor-state.ts` keeps its 2 inline sites
 *  (generic→rb-kit would invert layering); `guard.ts` keeps its 1 site
 *  (this kit already imports guard.js — a reverse edge would cycle). */
export function lastJsonLine(stdout: string, fallback = ""): string {
  const last = stdout.trim().split("\n").pop();
  return last === undefined ? fallback : last;
}

/** One pyrekordbox subprocess run (#95): the `uv run --with <tag> python
 *  -c <script> <args…>` spawn plus the shared status/stdout gate — a
 *  non-zero exit or empty stdout throws `<label> failed (exit N)` with
 *  the caller's stderr window. Callers keep their own output parsers
 *  (parseWriteOutput / parseVerifyOutput / …); only the spawn frame is
 *  centralized. `stderrTail` preserves each historical slice window
 *  (−400 / −200 / +300). */
export function runPyScript(opts: {
  script: string;
  dbPath: string;
  args?: (string | null)[];
  timeoutMs: number;
  tag?: string;
  label: string;
  stderrTail?: number;
  stderrHead?: number;
}): RbCommandResult {
  const argv = pyUvArgv({
    script: opts.script,
    args: [opts.dbPath, ...(opts.args ?? [])].map((a) => a ?? ""),
    ...(opts.tag === undefined ? {} : { withPkg: opts.tag }),
  });
  const raw = spawnSync("uv", argv, {
    encoding: "utf8",
    timeout: opts.timeoutMs,
  });
  const result: RbCommandResult = {
    status: raw.status,
    stdout: raw.stdout ?? "",
    stderr: raw.stderr ?? "",
  };
  if (result.status !== 0 || !result.stdout) {
    const detail =
      opts.stderrHead !== undefined
        ? result.stderr.slice(0, opts.stderrHead)
        : result.stderr.slice(opts.stderrTail ?? -400);
    throw new Error(
      `${opts.label} failed (exit ${String(result.status)}): ${detail}`,
    );
  }
  return result;
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

/**
 * THE zero-result builder factory (issue #68): every rb-* command
 * hand-rolled a `fail(msg)` that spreads a typed all-zero result with
 * `ok: false, error: msg` — 8 copies of the same factory shape, each
 * drifting on its own (rb-import/rb-playlist take a details override,
 * rb-adopt post-overrides `backedUpTo`, others are closed). One factory:
 * the command supplies its per-command constant template; `makeFail`
 * returns the closed `(msg) => Result` (or `(msg, details) => Result`
 * for the commands that need the override hatch). `appliedMode` derives
 * from the SAME `applyConfirmed`/opts the command already holds, so the
 * dry-run bit can never contradict the refusal gate.
 */
export function makeFail<T>(template: (msg: string) => T): (msg: string) => T {
  return (msg) => {
    const r = template(msg);
    const withError = r as { ok?: unknown; error?: unknown };
    withError.ok = false;
    withError.error = msg;
    return r;
  };
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
