/**
 * megadj rb-fix-paths — repair stale djmdContent paths in a rekordbox
 * master DB after folders move/merge on the drive (the shelf migration and
 * every folder-merge pass leave stale rows behind).
 *
 * Reads the drive's PIONEER/Master/master.db (or a local master DB via
 * MEGADJ_RB_MASTER), checks EVERY content row's FolderPath against the
 * disk, and proposes rewrites via a matching ladder:
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

import { existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { commandLog } from "../progress";
import { isUnknownArray } from "../../cratedeck/shared/guards";
import { nameKey } from "../shared/name-key";
import { walkAudioDir } from "../shared/audio-walk";
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

export interface RbFixPathsOptions {
  /** Drive mount root, e.g. /Volumes/SHELF1 — master DB lives at
   *  <mount>/PIONEER/Master/master.db. */
  mount: string;
  apply?: boolean;
  yes?: boolean;
  json?: boolean;
  log?: (s: string) => void;
}

export interface RbFixRow {
  /** Decimal text preserves Rekordbox's 64-bit ID exactly across JSON. */
  id: string;
  brokenPath: string;
  /** Proposed fix — null when no live match was found (reported only). */
  fixPath: string | null;
  /** Which ladder step produced the match. */
  via: string;
}

export interface RbFixResult {
  command: "rb-fix-paths";
  mount: string;
  db: string;
  /** Total content rows in the DB. */
  total: number;
  /** Rows whose FolderPath does not exist on disk. */
  broken: number;
  /** Broken rows with a confident fix. */
  fixable: number;
  /** Broken rows with no live match (left for Missing File Manager). */
  dead: number;
  /** Rows actually rewritten (0 in dry-run). */
  applied: number;
  appliedList: string[];
  deadList: string[];
  /** Post-apply full-table re-check: rows still broken (must be 0
   *  plus the dead rows) — the whole-table check that caught the
   *  prefix-scoped verification lie. */
  stillBroken: number;
  appliedMode: boolean;
  backedUpTo: string | null;
  ok: boolean;
  /** Present only when ok is false — the visible failure reason. */
  error?: string;
}

export interface RbFixPathsRuntime {
  fileExists: (path: string) => boolean;
  assertClosed: (what: string) => void;
  backup: (dbPath: string) => string;
  readRows: (dbPath: string) => [string, string][];
  buildIndex: (mount: string) => LiveIndex;
  rewrite: (
    dbPath: string,
    rows: RbFixRow[],
    log: (s: string) => void,
  ) => Promise<number>;
  sleep: (ms: number) => void;
  restore: (dbPath: string, backupPath: string) => void;
}

const PY =
  "import sys, json;from pyrekordbox import Rekordbox6Database as R\n" +
  "db=R(sys.argv[1])\n" +
  'rows=[(str(c.ID),c.FolderPath or "") for c in db.get_content()]\n' +
  "print(json.dumps(rows));db.close()";

/** The unique-path index: every audio file under <mount>/Contents (and
 *  PIONEER REC, the walked roots), keyed by the ladder's match keys. */
export interface LiveIndex {
  byNorm: Map<string, string>; // NFC+casefold abs path
  byBasename: Map<string, string[]>; // casefold basename → paths
  byStripped: Map<string, string[]>; // stripped-copy-suffix name → paths
  byPrefix20: Map<string, string[]>; // 20-char prefix → paths
}

/** One empty LiveIndex — was duplicated in buildIndex and the test seam. */
function emptyIndex(): LiveIndex {
  return {
    byNorm: new Map(),
    byBasename: new Map(),
    byStripped: new Map(),
    byPrefix20: new Map(),
  };
}

function nfkc(s: string): string {  return nameKey(s);
}

/** "track - 1.mp3", "track - 1 2.mp3" → "track.mp3" — auto-relocate
 *  renumbers copies; merges scatter them. Strip trailing " - N"/" N"
 *  before the extension, repeatedly. */
function stripCopySuffix(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return stem.replace(/(\s*-\s*|\s+)\d+$/u, "").trimEnd() + ext;
}

function walkAudio(root: string, out: string[]): void {
  // shared walker (#142): soft-fail, dotfile/`._` skip, AUDIO_EXTS SSOT
  out.push(...walkAudioDir(root));
}

/** Shared with rb-unmatched: the live-audio index (same roots, same junk
 *  rules) and the pyrekordbox row reader. Exported, not duplicated — one
 *  walker, one DB reader, two consumers. */
export function buildIndex(mount: string): LiveIndex {
  const files: string[] = [];
  const contents = join(mount, "Contents");
  if (existsSync(contents)) walkAudio(contents, files);
  // PIONEER REC is walked per coverage rules; PIONEER/ device DBs never
  const rec = join(mount, "PIONEER REC");
  if (existsSync(rec)) walkAudio(rec, files);
  const idx: LiveIndex = emptyIndex();
  for (const f of files) {
    const n = nfkc(f);
    idx.byNorm.set(n, f);
    const b = basename(f).toLowerCase();
    idx.byBasename.set(b, [...(idx.byBasename.get(b) ?? []), f]);
    const s = stripCopySuffix(basename(f)).toLowerCase();
    idx.byStripped.set(s, [...(idx.byStripped.get(s) ?? []), f]);
    const p = n.slice(0, 20);
    idx.byPrefix20.set(p, [...(idx.byPrefix20.get(p) ?? []), f]);
  }
  return idx;
}

/** Quality bias for ambiguous matches: biggest file wins (higher bitrate
 *  is the safer default; quarantine holds the small twins). */
function largest(paths: string[]): string {
  let best = paths[0];
  if (best === undefined) return "";
  let bestSize = -1;
  for (const p of paths) {
    try {
      const sz = statSync(p).size;
      if (sz > bestSize) {
        bestSize = sz;
        best = p;
      }
    } catch {
      continue;
    }
  }
  return best;
}

function matchLadder(broken: string, idx: LiveIndex): RbFixRow {
  const base: RbFixRow = {
    id: "",
    brokenPath: broken,
    fixPath: null,
    via: "unresolved",
  };
  // 1 — exact
  if (existsSync(broken)) return { ...base, via: "exists???" }; // not broken
  // 2 — NFC+casefold
  const norm = idx.byNorm.get(nfkc(broken));
  if (norm) return { ...base, fixPath: norm, via: "nfc-casefold" };
  // 3 — unique basename
  const bns = idx.byBasename.get(basename(broken).toLowerCase());
  if (bns && bns.length === 1 && bns[0] !== undefined)
    return { ...base, fixPath: bns[0], via: "basename" };
  // 4 — strip repeated -N copy suffixes (unique)
  const sts = idx.byStripped.get(
    stripCopySuffix(basename(broken)).toLowerCase(),
  );
  if (sts && sts.length === 1 && sts[0] !== undefined)
    return { ...base, fixPath: sts[0], via: "copy-suffix" };
  // 5 — 20-char prefix (exFAT truncation), unique
  const pfs = idx.byPrefix20.get(nfkc(broken).slice(0, 20));
  if (pfs && pfs.length === 1 && pfs[0] !== undefined)
    return { ...base, fixPath: pfs[0], via: "prefix20" };
  // 6 — multiple stripped matches → largest twin
  if (sts && sts.length > 1)
    return { ...base, fixPath: largest(sts), via: "largest-twin" };
  if (bns && bns.length > 1)
    return { ...base, fixPath: largest(bns), via: "largest-twin" };
  return base; // genuinely dead — reported, never touched
}

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

export async function rbFixPaths(
  opts: RbFixPathsOptions,
  overrides: Partial<RbFixPathsRuntime> = {},
): Promise<RbFixResult> {
  const log = opts.log ?? commandLog({ json: opts.json });
  const mount = normalizeMount(opts.mount);
  const dbPath = masterDbPath(opts.mount);
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
    mount,
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

  if (applyConfirmationRefusal(opts) !== null) {
    const r = fail(applyConfirmationRefusal(opts) ?? "unreachable");
    log(r.error ?? "unknown failure");
    return r;
  }
  if (!runtime.fileExists(dbPath)) {
    const r = fail(`no master DB at ${dbPath}`);
    log(r.error ?? "unknown failure");
    return r;
  }
  if (opts.apply) {
    try {
      runtime.assertClosed("rb-fix-paths --apply preflight");
    } catch (error) {
      const r = fail(errorText(error));
      log(r.error ?? "unknown failure");
      return r;
    }
  }

  log(`rb-fix-paths: reading ${dbPath}`);
  let rows: [string, string][];
  try {
    rows = runtime.readRows(dbPath);
  } catch (e) {
    const r = fail(errorText(e));
    log(r.error ?? "unknown failure");
    return r;
  }
  const idx = runtime.buildIndex(mount);
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
  const fixable = brokenRows.filter((r) => r.fixPath);
  const dead = brokenRows.filter((r) => !r.fixPath);

  let applied = 0;
  let backedUpTo: string | null = null;
  const appliedList: string[] = [];
  let stillBroken = 0;
  const result = (values: Partial<RbFixResult> = {}): RbFixResult => ({
    command: "rb-fix-paths",
    mount,
    db: dbPath,
    total: rows.length,
    broken: brokenRows.length,
    fixable: fixable.length,
    dead: dead.length,
    applied,
    appliedList,
    deadList: dead.map((d) => d.brokenPath),
    stillBroken,
    appliedMode: Boolean(opts.apply),
    backedUpTo,
    ok: true,
    ...values,
  });

  const restoreAfterFailure = (
    reason: string,
    attempted: number,
    measuredStillBroken: number,
  ): RbFixResult => {
    if (backedUpTo === null) {
      return result({
        ok: false,
        error: reason,
        applied: attempted,
        stillBroken: measuredStillBroken,
      });
    }
    try {
      runtime.assertClosed("rb-fix-paths rollback");
      runtime.restore(dbPath, backedUpTo);
      runtime.sleep(250);
      runtime.assertClosed("rb-fix-paths rollback verification");
      const restored = runtime.readRows(dbPath);
      if (!sameRows(rows, restored)) {
        throw new Error("restored database does not match its pre-write rows");
      }
      return result({
        ok: false,
        error: `${reason}; backup restored and verified`,
        applied: 0,
        appliedList: [],
        stillBroken: brokenRows.length,
      });
    } catch (error) {
      const detail = errorText(error);
      return result({
        ok: false,
        error: `${reason}; ROLLBACK FAILED: ${detail}`,
        applied: attempted,
        appliedList: [],
        stillBroken: measuredStillBroken,
      });
    }
  };

  if (opts.apply && fixable.length > 0) {
    try {
      // The volume walk can be long. Re-check immediately before both the
      // sacred backup and the mutation so rekordbox cannot open unnoticed.
      runtime.assertClosed("rb-fix-paths --apply backup");
      backedUpTo = runtime.backup(dbPath);
      log(`rb-fix-paths: DB backed up to ${backedUpTo}`);
      runtime.assertClosed("rb-fix-paths --apply mutation");
      applied = await runtime.rewrite(dbPath, fixable, log);
    } catch (error) {
      const detail = errorText(error);
      const failed = restoreAfterFailure(
        `rewrite failed: ${detail}`,
        applied,
        brokenRows.length,
      );
      log(failed.error ?? "unknown failure");
      return failed;
    }
    if (applied !== fixable.length) {
      const failed = restoreAfterFailure(
        `partial rewrite: applied ${applied}/${fixable.length}`,
        applied,
        brokenRows.length,
      );
      log(failed.error ?? "unknown failure");
      return failed;
    }
  }

  // FULL-TABLE delayed re-read in a fresh process — every row, not just the
  // intended updates. A successful commit is not proof that paths survived.
  if (opts.apply) {
    let reread: [string, string][];
    try {
      runtime.sleep(250);
      runtime.assertClosed("rb-fix-paths verification");
      reread = runtime.readRows(dbPath);
    } catch (error) {
      const detail = errorText(error);
      const failed = restoreAfterFailure(
        `verification failed: ${detail}`,
        applied,
        brokenRows.length,
      );
      log(failed.error ?? "unknown failure");
      return failed;
    }

    const byId = new Map(reread);
    stillBroken = reread.reduce(
      (count, [, path]) =>
        path && !runtime.fileExists(path) ? count + 1 : count,
      0,
    );
    const deadIds = new Set(dead.map((row) => row.id));
    const unexpectedBroken = reread.filter(
      ([id, path]) => path && !runtime.fileExists(path) && !deadIds.has(id),
    );
    const targetFailures = fixable.filter(
      (row) =>
        row.fixPath === null ||
        byId.get(row.id) !== row.fixPath ||
        !runtime.fileExists(row.fixPath),
    );
    if (
      reread.length !== rows.length ||
      targetFailures.length > 0 ||
      unexpectedBroken.length > 0
    ) {
      const failed = restoreAfterFailure(
        `verification failed: ${targetFailures.length} rewritten target(s) invalid, ${unexpectedBroken.length} unexpected broken row(s), row count ${reread.length}/${rows.length}`,
        applied,
        stillBroken,
      );
      log(failed.error ?? "unknown failure");
      return failed;
    }
    for (const row of fixable)
      appliedList.push(`${row.brokenPath} → ${row.fixPath}`);
  }

  return result();
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
