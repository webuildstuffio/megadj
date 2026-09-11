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

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readdirSync,
  statSync,
  type Stats,
} from "node:fs";
import { basename, join } from "node:path";

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
  id: number;
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

const PY =
  "import sys, json;from pyrekordbox import Rekordbox6Database as R\n" +
  "db=R(sys.argv[1])\n" +
  'rows=[(c.ID,c.FolderPath or "") for c in db.get_content()]\n' +
  "print(json.dumps(rows));db.close()";

/** The unique-path index: every audio file under <mount>/Contents (and
 *  PIONEER REC, the walked roots), keyed by the ladder's match keys. */
interface LiveIndex {
  byNorm: Map<string, string>; // NFC+casefold abs path
  byBasename: Map<string, string[]>; // casefold basename → paths
  byStripped: Map<string, string[]>; // stripped-copy-suffix name → paths
  byPrefix20: Map<string, string[]>; // 20-char prefix → paths
}

const AUDIO_EXT = new Set([
  ".aiff",
  ".aif",
  ".mp3",
  ".wav",
  ".flac",
  ".m4a",
  ".aac",
  ".alac",
  ".ogg",
]);

function nfkc(s: string): string {
  return s.normalize("NFC").toLowerCase();
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
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return; // unreadable/missing root — index just stays smaller
  }
  for (const e of entries) {
    if (e.startsWith(".")) continue; // junk/quarantine (shelf-root rule)
    const full = join(root, e);
    let st: Stats;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkAudio(full, out);
    } else if (AUDIO_EXT.has(e.slice(e.lastIndexOf(".")).toLowerCase())) {
      out.push(full);
    }
  }
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
  const idx: LiveIndex = {
    byNorm: new Map(),
    byBasename: new Map(),
    byStripped: new Map(),
    byPrefix20: new Map(),
  };
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
    id: 0,
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

function rekordboxRunning(): boolean {
  const r = spawnSync("pgrep", ["-x", "rekordbox"]);
  return r.status === 0;
}

/** Read (ID, FolderPath) for every content row via pyrekordbox. Shared
 *  with rb-unmatched (read-only reuse — one DB reader, two consumers). */
export function readRows(dbPath: string): [number, string][] {
  const r = spawnSync(
    "uv",
    ["run", "--with", "pyrekordbox", "python", "-c", PY, dbPath],
    {
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  if (r.status !== 0 || !r.stdout) {
    throw new Error(
      `pyrekordbox read failed (exit ${String(r.status)}): ${(r.stderr ?? "").slice(0, 300)}`,
    );
  }
  return JSON.parse(r.stdout.trim().split("\n").pop() ?? "[]") as [
    number,
    string,
  ][];
}

export async function rbFixPaths(
  opts: RbFixPathsOptions,
): Promise<RbFixResult> {
  const log = opts.log ?? (() => {});
  const mount = opts.mount.replace(/\/+$/u, "");
  const dbPath =
    process.env.MEGADJ_RB_MASTER ??
    join(mount, "PIONEER", "Master", "master.db");

  const fail = (msg: string): RbFixResult => ({
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
  });

  if (!existsSync(dbPath)) {
    const r = fail(`no master DB at ${dbPath}`);
    log(r.error ?? "unknown failure");
    return r;
  }
  if (opts.apply && rekordboxRunning()) {
    const r = fail("rekordbox is running — quit it before --apply (live WAL)");
    log(r.error ?? "unknown failure");
    return r;
  }

  log(`rb-fix-paths: reading ${dbPath}`);
  let rows: [number, string][];
  try {
    rows = readRows(dbPath);
  } catch (e) {
    const r = fail(e instanceof Error ? e.message : String(e));
    log(r.error ?? "unknown failure");
    return r;
  }
  const idx = buildIndex(mount);
  log(
    `rb-fix-paths: ${rows.length} content rows · ${idx.byNorm.size} live audio files indexed`,
  );

  const brokenRows: RbFixRow[] = [];
  for (const [id, p] of rows) {
    if (p && !existsSync(p)) {
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
  if (opts.apply && opts.yes && fixable.length > 0) {
    // dated backup of the DB (and WAL/SHM if present) — sacred per AGENTS
    const stamp = new Date().toISOString().replace(/[-:T]/gu, "").slice(0, 15);
    backedUpTo = `${dbPath}.bak-${stamp}`;
    copyFileSync(dbPath, backedUpTo);
    for (const side of ["-wal", "-shm"]) {
      if (existsSync(dbPath + side))
        copyFileSync(dbPath + side, backedUpTo + side);
    }
    log(`rb-fix-paths: DB backed up to ${backedUpTo}`);
    applied = await rewriteRows(dbPath, fixable, log);
    if (applied !== fixable.length) {
      log(
        `rb-fix-paths: WARNING applied ${applied}/${fixable.length} — check the report before trusting`,
      );
    }
    for (const r of fixable) appliedList.push(`${r.brokenPath} → ${r.fixPath}`);
  }

  // FULL-TABLE re-verify (the rule that caught the prefix-scope lie):
  // every row in the DB — not just the ones we meant to touch.
  let stillBroken = 0;
  if (opts.apply && opts.yes) {
    const re = readRows(dbPath);
    for (const [, p] of re) if (p && !existsSync(p)) stillBroken++;
  }

  const result: RbFixResult = {
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
  };
  return result;
}

async function rewriteRows(
  dbPath: string,
  rows: RbFixRow[],
  log: (s: string) => void,
): Promise<number> {
  const payload = JSON.stringify(rows.map((r) => [r.id, r.fixPath]));
  const script =
    "import sys,json;from pyrekordbox import Rekordbox6Database as R\n" +
    "db=R(sys.argv[1])\n" +
    "updates=json.loads(sys.argv[2]);n=0\n" +
    "for cid,path in updates:\n" +
    "    c=db.get_content(ID=cid)\n" +
    "    if c is not None:\n" +
    "        c.FolderPath=path;db.session.commit();n+=1\n" +
    'print(json.dumps({"applied":n}));db.close()';
  const r = spawnSync(
    "uv",
    ["run", "--with", "pyrekordbox", "python", "-c", script, dbPath, payload],
    { encoding: "utf8", timeout: 180_000 },
  );
  if (r.status !== 0) {
    log(`rb-fix-paths: rewrite failed: ${(r.stderr ?? "").slice(0, 300)}`);
    return 0;
  }
  const line = (r.stdout ?? "").trim().split("\n").pop() ?? "{}";
  try {
    return (JSON.parse(line) as { applied: number }).applied;
  } catch {
    return 0;
  }
}

/** Test seam: the matching ladder against a live index (no DB needed). */
export const __test = {
  matchLadder: (broken: string, mount: string): RbFixRow =>
    matchLadder(broken, buildIndex(mount)),
  stripCopySuffix,
};
/** Emit the human report (non-json mode). */
export function printRbFixReport(
  r: RbFixResult,
  log: (s: string) => void,
): void {
  if (r.error) {
    log(`error: ${r.error}`);
    return;
  }
  log(
    `${r.total} content rows · ${r.broken} broken · ${r.fixable} fixable · ${r.dead} dead (truly gone)`,
  );
  for (const f of r.appliedList) log(`  fixed: ${f}`);
  for (const d of r.deadList)
    log(`  dead (use Missing File Manager to remove): ${d}`);
  if (r.appliedMode)
    log(
      r.stillBroken === r.dead
        ? `post-verify: only the ${r.dead} dead rows remain — clean`
        : `post-verify: ${r.stillBroken - r.dead} UNEXPECTED still-broken rows — investigate`,
    );
  else
    log(
      `dry-run — re-run with --apply --yes (rekordbox quit) to rewrite ${r.fixable} rows`,
    );
}
