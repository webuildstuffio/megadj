/**
 * megadj rb-unmatched — the disk→DB half of the reconcile pair.
 * (`rb-fix-paths` repairs rows whose files moved; this one finds files
 * NO row references at all — the import backlog.)
 *
 * Reads every djmdContent.FolderPath from the shelf master DB (read-only,
 * pyrekordbox), walks the shelf's live audio (Contents/ + PIONEER REC per
 * coverage rules, ._ * junk excluded by name), and classifies each disk
 * file:
 *   matched    — a row points exactly here (NFC+casefold) — the library
 *   twinNamed  — no row points here, but some row references the same
 *                basename elsewhere (renamed/moved copy) — left for
 *                shelf-dupescan's fingerprint judgment, never auto-moved
 *   unknown    — no row points here AND no row carries the basename —
 *                the true never-imported set
 *
 * `--quarantine --yes` moves ONLY the unknown set into the shelf
 * quarantine (`.hygiene-quarantine/unmatched/`, same root rule and
 * collision-suffixing as hygiene apply), writing a dated manifest JSONL
 * beside them so every move is reversible. NOTHING is ever deleted.
 * Safe while rekordbox runs by construction: only row-less files move,
 * so no DB row can dangle — but the DB is never written here regardless.
 *
 * Gate semantics (audit parity): dry-run exits 1 while unknown > 0 — the
 * backlog is a visible unresolved state, not a quiet pass.
 *
 * --json obeys the agent-first contract: one summary object on stdout.
 */

import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { QUARANTINE_DIR, quarantineDest } from "../hygiene/apply";
import { buildIndex, readRows } from "./rb-fix-paths";

export interface RbUnmatchedOptions {
  /** Drive mount root, e.g. /Volumes/SHELF1. */
  mount: string;
  /** Restrict the disk census to these extensions ("mp3" or ".mp3").
   * Default: every audio extension the shelf walk knows. */
  ext?: string[];
  quarantine?: boolean;
  yes?: boolean;
  json?: boolean;
  log?: (s: string) => void;
}

export interface RbUnmatchedResult {
  command: "rb-unmatched";
  mount: string;
  db: string;
  /** Audio files on disk under the walked roots (after --ext filter). */
  diskFiles: number;
  /** djmdContent rows in the master DB. */
  dbRows: number;
  /** Disk files a row points at exactly — the library. */
  matched: number;
  /** Row-less files whose basename exists on some row — dupescan's queue. */
  twinNamed: number;
  /** Row-less files with no basename anywhere in the DB — the backlog. */
  unknown: number;
  /** unknown census by top-level folder under Contents (worst first). */
  unknownByDir: Record<string, number>;
  /** Full unknown list in --json mode; capped preview in human mode. */
  unknownList: string[];
  /** Rows actually quarantined (0 in dry-run). */
  quarantined: number;
  /** from → dest receipts for everything this run moved. */
  quarantineLog: Array<{ from: string; dest: string }>;
  /** Manifest file written for this run (reversibility receipt). */
  manifestPath: string | null;
  appliedMode: boolean;
  ok: boolean;
  /** Present only when ok is false — the visible failure reason. */
  error?: string;
}

const HUMAN_LIST_CAP = 30;

function fail(mount: string, dbPath: string, msg: string): RbUnmatchedResult {
  return {
    command: "rb-unmatched",
    mount,
    db: dbPath,
    diskFiles: 0,
    dbRows: 0,
    matched: 0,
    twinNamed: 0,
    unknown: 0,
    unknownByDir: {},
    unknownList: [],
    quarantined: 0,
    quarantineLog: [],
    manifestPath: null,
    appliedMode: false,
    ok: false,
    error: msg,
  };
}

/** Normalize a CLI --ext value ("mp3", ".MP3") to ".mp3". */
function normExt(e: string): string {
  const t = e.trim().toLowerCase();
  return t.startsWith(".") ? t : `.${t}`;
}

/** Top-level folder of a shelf path for the census ("Contents/<dir>/…").
 *  Files directly inside Contents count as "(root)". */
function topDir(p: string): string {
  const m = p.split("/Contents/")[1];
  if (m === undefined) return "(outside Contents)";
  const slash = m.indexOf("/");
  return slash === -1 ? "(root)" : m.slice(0, slash);
}

/** The pure core, split out for tests: classify disk paths against the
 *  set of paths some DB row references. Order-stable; never throws. */
export function classifyUnmatched(
  disk: string[],
  rowPaths: string[],
): {
  matched: string[];
  twinNamed: string[];
  unknown: string[];
} {
  const rowSet = new Set(rowPaths.map((p) => p.normalize("NFC").toLowerCase()));
  const rowBase = new Set(rowPaths.map((p) => basename(p).toLowerCase()));
  const matched: string[] = [];
  const twinNamed: string[] = [];
  const unknown: string[] = [];
  for (const f of disk) {
    const key = f.normalize("NFC").toLowerCase();
    if (rowSet.has(key)) matched.push(f);
    else if (rowBase.has(basename(f).toLowerCase())) twinNamed.push(f);
    else unknown.push(f);
  }
  return { matched, twinNamed, unknown };
}

/** Move the unknown set into the shelf quarantine's unmatched/ subdir —
 *  same-volume renames, collision-suffixed, never overwritten, with a
 *  dated manifest JSONL written BEFORE the first move so even a crash
 *  mid-batch leaves a complete intended-move receipt. */
export async function quarantineUnmatched(
  files: string[],
  volume: string,
  log: (s: string) => void,
): Promise<{
  moved: Array<{ from: string; dest: string }>;
  manifestPath: string;
}> {
  const qDir = join(volume, QUARANTINE_DIR, "unmatched");
  mkdirSync(qDir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T.]/gu, "")
    .slice(0, 14);
  const manifestPath = join(qDir, `manifest-${stamp}.jsonl`);
  const planned = files.map((from) => ({
    from,
    dest: quarantineDest(qDir, from),
  }));
  await Bun.write(
    manifestPath,
    planned.map((p) => JSON.stringify(p)).join("\n") + "\n",
  );
  const moved: Array<{ from: string; dest: string }> = [];
  for (const p of planned) {
    try {
      // per-file moves with destination verification are the proven
      // exFAT pattern — never bulk directory moves
      statSync(p.from);
      mkdirSync(dirname(p.dest), { recursive: true });
      renameSync(p.from, p.dest);
      if (!existsSync(p.dest))
        throw new Error(`dest missing after move: ${p.dest}`);
      moved.push(p);
    } catch (e) {
      log(
        `rb-unmatched: move FAILED (${e instanceof Error ? e.message : String(e)}) — ${p.from}`,
      );
    }
  }
  return { moved, manifestPath };
}

export async function rbUnmatched(
  opts: RbUnmatchedOptions,
): Promise<RbUnmatchedResult> {
  const log = opts.log ?? (() => {});
  const mount = opts.mount.replace(/\/+$/u, "");
  const dbPath =
    process.env.MEGADJ_RB_MASTER ??
    join(mount, "PIONEER", "Master", "master.db");

  // flag validation precedes any I/O — bad invocation = exit-worthy, zero work
  if (opts.quarantine && !opts.yes)
    return fail(
      mount,
      dbPath,
      "--quarantine requires --yes (two-step apply, dry-run first ALWAYS)",
    );
  if (!existsSync(dbPath))
    return fail(mount, dbPath, `no master DB at ${dbPath}`);

  const exts = opts.ext?.length ? new Set(opts.ext.map(normExt)) : null;
  const idx = buildIndex(mount);
  // buildIndex walks the same roots and applies the same junk rules — its
  // byNorm keys ARE the disk file list; filter by --ext after.
  let disk = [...idx.byNorm.values()];
  if (exts)
    disk = disk.filter((f) =>
      exts.has(f.slice(f.lastIndexOf(".")).toLowerCase()),
    );

  log(`rb-unmatched: reading ${dbPath}`);
  const rows = readRows(dbPath);
  log(
    `rb-unmatched: ${rows.length} content row(s) · ${disk.length} disk audio file(s) in scope`,
  );

  const { matched, twinNamed, unknown } = classifyUnmatched(
    disk,
    rows.map(([, p]) => p),
  );

  const unknownByDir: Record<string, number> = {};
  for (const u of unknown) {
    const d = topDir(u);
    unknownByDir[d] = (unknownByDir[d] ?? 0) + 1;
  }

  let quarantined = 0;
  let manifestPath: string | null = null;
  let quarantineLog: Array<{ from: string; dest: string }> = [];
  if (opts.quarantine && opts.yes && unknown.length > 0) {
    const r = await quarantineUnmatched(unknown, mount, log);
    quarantined = r.moved.length;
    quarantineLog = r.moved;
    manifestPath = r.manifestPath;
    log(
      `rb-unmatched: quarantined ${quarantined}/${unknown.length} → manifest ${manifestPath}`,
    );
  }

  return {
    command: "rb-unmatched",
    mount,
    db: dbPath,
    diskFiles: disk.length,
    dbRows: rows.length,
    matched: matched.length,
    twinNamed: twinNamed.length,
    unknown: unknown.length,
    unknownByDir,
    unknownList: unknown,
    quarantined,
    quarantineLog,
    manifestPath,
    appliedMode: !!opts.quarantine,
    ok: true,
  };
}

/** Emit the human report (non-json mode). */
export function printRbUnmatchedReport(
  r: RbUnmatchedResult,
  log: (s: string) => void,
): void {
  if (r.error) {
    log(`error: ${r.error}`);
    return;
  }
  log(
    `${r.diskFiles} disk file(s) · ${r.dbRows} DB row(s) · ${r.matched} matched · ${r.twinNamed} twin-named (dupescan's queue) · ${r.unknown} unknown to rekordbox`,
  );
  const dirs = Object.entries(r.unknownByDir).toSorted((a, b) => b[1] - a[1]);
  for (const [d, n] of dirs.slice(0, 10))
    log(`  ${String(n).padStart(5)}  Contents/${d}/`);
  if (dirs.length > 10) log(`  … ${dirs.length - 10} more folder(s)`);
  for (const u of r.unknownList.slice(0, HUMAN_LIST_CAP)) log(`    ${u}`);
  if (r.unknownList.length > HUMAN_LIST_CAP)
    log(
      `    … ${r.unknownList.length - HUMAN_LIST_CAP} more (--json for the full list)`,
    );
  if (r.quarantined)
    log(
      `quarantined ${r.quarantined} file(s); manifest: ${r.manifestPath ?? "?"} — nothing deleted, restore = move back`,
    );
  else if (r.unknown > 0)
    log(
      `dry-run — re-run with --quarantine --yes to move the ${r.unknown} unknown file(s) out of Contents/ (reversible, manifest kept)`,
    );
  if (r.twinNamed > 0)
    log(
      `${r.twinNamed} twin-named file(s) left in place — settle them with \`megadj shelf-dupescan\` (fingerprint-verified), never by name alone`,
    );
}

/** Test seam: pure pieces without a DB. */
export const __test = { classifyUnmatched, topDir, normExt };
