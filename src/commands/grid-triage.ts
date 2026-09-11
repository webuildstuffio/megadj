/**
 * megadj rb-grid-triage — GA-03 triage + GA-04 completion (the full
 * grid audit against the ANLZ grid rekordbox actually wrote).
 *
 * Two questions, answered in the plan's priority order:
 *
 * 1. SYNC or ANALYSIS? (--compare <stick>) Byte-compare each track's
 *    collection ANLZ sidecar against the stick's sidecar at the
 *    anlz_paths.py hash path. Differ → SYNC issue: re-export the
 *    playlist, done — NEVER re-analyze. Identical → the grid is
 *    genuinely wrong; continue to 2.
 * 2. How wrong? Decode the collection ANLZ's PQTZ beat grid and run
 *    `gridAuditFull` against the beats ledger — anchor delta, phase,
 *    and the SHIFT/PHASE buckets the ledger-only pass could not assign.
 *
 * Read-only (the rb-fix-paths posture: reads don't need the pgrep
 * guard; only writes do). Rows whose ANLZ can't be found are counted
 * `noAnlz` and sampled — never a fake pass.
 *
 * Ledger join: the shelf mirrors the archive layout (Contents/<rel>,
 * per shelf-sync), so the join key is the NFC+casefold rel path; a
 * unique casefold basename is the fallback.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ArchiveState } from "../state";
import { commandLog } from "../progress";
import { gridAuditFull } from "../../fulltags/src/analysis";
import { parseAnlzGrid } from "../../fulltags/src/anlz";
import { MUSIC_DIR } from "../cli-env";

/** The plan A3 bucket names (subset of GridAuditVerdict["bucket"]). */
export type BucketName =
  "A-OK" | "SHIFT" | "PHASE" | "TEMPO" | "DRIFT" | "CHAOS";

export interface GridTriageOptions {
  /** Shelf mount (master DB at <mount>/PIONEER/Master/master.db, or
   * MEGADJ_RB_MASTER). */
  mount: string;
  /** Stick volume name/mount for the GA-03 byte-compare (optional). */
  compareDrive?: string;
  state: ArchiveState;
  limit?: number;
  json?: boolean;
  onProgress?: (msg: string) => void;
  /** Plain log sink (non-json mode); default silent. */
  log?: (msg: string) => void;
  /** Test seam: inject master-DB rows, skipping the python spawn. */
  rows?: MasterRow[];
}

/** One content row from the master DB (python seam). */
export interface MasterRow {
  id: number;
  /** Shelf audio path (/Contents/...). */
  path: string;
  /** djmdContent.AnalysisDataPath (collection ANLZ, shape varies). */
  anlz: string;
  /** anlz_paths.py hash dir (PXXX/HHHHHHHH) for the stick sidecar. */
  hashDir: string;
}

export type TriageCls =
  BucketName | "SYNC" | "DRIVE-MISSING" | "NO-ANLZ" | "NO-LEDGER" | "NO-GRID";

export interface TriageRow {
  id: number;
  path: string;
  cls: TriageCls;
  /** Anchor / phase numbers when audited (ms; phaseBeats whole beats). */
  anchorDeltaMs?: number;
  phaseMs?: number;
  phaseBeats?: number;
  detail?: string;
}

export interface GridTriageResult {
  command: "rb-grid-triage";
  mount: string;
  db: string;
  compareDrive: string | null;
  total: number;
  audited: number;
  buckets: Record<BucketName, number>;
  /** Only when --compare is active: byte-identical sidecar count. */
  synced: number | null;
  syncIssues: number | null;
  noAnlz: number;
  noLedger: number;
  noGrid: number;
  /** Worst-first sample (SYNC issues, then non-A-OK buckets), capped. */
  offenders: TriageRow[];
  ok: boolean;
  error?: string;
}

const BUCKETS: BucketName[] = [
  "A-OK",
  "SHIFT",
  "PHASE",
  "TEMPO",
  "DRIFT",
  "CHAOS",
];

const PY_ROWS =
  "import sys, json\n" +
  "sys.path.insert(0, sys.argv[2])\n" +
  "from pyrekordbox import Rekordbox6Database as R\n" +
  "from anlz_paths import compute_anlz_folder\n" +
  "db = R(sys.argv[1])\n" +
  "rows = []\n" +
  "for c in db.get_content():\n" +
  '    p = compute_anlz_folder(c.FolderPath or "")\n' +
  '    rows.append({"id": c.ID, "path": c.FolderPath or "",\n' +
  '                 "anlz": getattr(c, "AnalysisDataPath", "") or "",\n' +
  '                 "hashDir": "P%03X/%08X" % p})\n' +
  "print(json.dumps(rows))\n" +
  "db.close()\n";

/** Read every content row + its hash path (the python SSOT seam). */
export function readMasterRows(
  dbPath: string,
  skillScriptsDir: string,
): MasterRow[] {
  const r = spawnSync(
    "uv",
    [
      "run",
      "--with",
      "pyrekordbox",
      "python",
      "-c",
      PY_ROWS,
      dbPath,
      skillScriptsDir,
    ],
    { encoding: "utf8", timeout: 180_000 },
  );
  if (r.status !== 0) {
    throw new Error(
      `pyrekordbox read failed (exit ${String(r.status)}): ${(r.stderr ?? "").slice(0, 300)}`,
    );
  }
  return JSON.parse(r.stdout.trim().split("\n").pop() ?? "[]") as MasterRow[];
}

const norm = (s: string): string => s.normalize("NFC").toLowerCase();

/** Resolve the collection ANLZ absolute path from the row's value
 * (shape varies across rekordbox versions: absolute, DB-relative, or
 * share-dir-relative). First existing candidate wins; null otherwise. */
export function resolveCollectionAnlz(
  mount: string,
  anlzValue: string,
): string | null {
  if (!anlzValue) return null;
  const dbRoot = join(mount, "PIONEER", "Master");
  const candidates = anlzValue.startsWith("/")
    ? [mount + anlzValue, join(dbRoot, anlzValue)]
    : [
        join(dbRoot, anlzValue),
        join(dbRoot, "share", "ANLZ", basename(anlzValue)),
        join(mount, anlzValue),
      ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** The beats ledger indexed for the shelf join: exact NFC+casefold rel,
 * with a unique-casefold-basename fallback. */
export function buildLedgerIndex(state: ArchiveState): {
  byRel: Map<string, { beats: number[] }>;
  byBasename: Map<string, { beats: number[] }>;
} {
  const byRel = new Map<string, { beats: number[] }>();
  const byBasename = new Map<string, { beats: number[] }>();
  const musicDir = MUSIC_DIR.replace(/\/+$/u, "");
  for (const row of state.beatAnalyzedTracks()) {
    const fp = row.track.file_path ?? "";
    const rel = fp.startsWith(musicDir + "/")
      ? norm(fp.slice(musicDir.length + 1))
      : norm(basename(fp));
    const entry = { beats: row.beats };
    byRel.set(rel, entry);
    const bn = norm(basename(fp));
    // only unique basenames are safe fallback keys — a collision poisons
    // the key so it can never produce a false join
    byBasename.set(bn, byBasename.has(bn) ? { beats: [] } : entry);
  }
  return { byRel, byBasename };
}

/** Join one shelf path to ledger beats (exact rel, then unique base). */
export function ledgerBeatsFor(
  shelfPath: string,
  idx: ReturnType<typeof buildLedgerIndex>,
): number[] | null {
  const rel = norm(shelfPath.replace(/^\/Contents\//u, ""));
  const hit = idx.byRel.get(rel) ?? idx.byBasename.get(norm(basename(rel)));
  return hit && hit.beats.length > 0 ? hit.beats : null;
}

/** Median of the ANLZ tempo column (bpmx100) — the BPM rekordbox's grid
 * actually enforces (per-beat tempo can step; the median is the clock). */
export function anlzBpm(beats: { bpmx100: number }[]): number | null {
  if (beats.length === 0) return null;
  const xs = beats.map((b) => b.bpmx100).sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  const med =
    xs.length % 2
      ? xs[mid]!
      : Math.round(((xs[mid - 1]! + xs[mid]!) as number) / 2);
  return med / 100;
}

/** Classify one row — the pure core (bytes in, verdict out). */
export function triageRow(input: {
  row: MasterRow;
  shelfAnlzBytes: Uint8Array | null;
  stickAnlzBytes: Uint8Array | null;
  compareActive: boolean;
  ledgerBeats: number[] | null;
}): TriageRow {
  const { row, shelfAnlzBytes, stickAnlzBytes, compareActive, ledgerBeats } =
    input;
  if (shelfAnlzBytes === null)
    return { id: row.id, path: row.path, cls: "NO-ANLZ" };
  // GA-03 priority 1: sync-vs-analysis. A differing sidecar is a SYNC
  // issue regardless of grid content — the fix is a re-export, and
  // auditing it would mislabel the problem class.
  if (compareActive) {
    if (stickAnlzBytes === null)
      return { id: row.id, path: row.path, cls: "DRIVE-MISSING" };
    if (!bytesEqual(shelfAnlzBytes, stickAnlzBytes))
      return {
        id: row.id,
        path: row.path,
        cls: "SYNC",
        detail:
          "drive sidecar differs from the collection — re-export, don't re-analyze",
      };
  }
  const grid = parseAnlzGrid(shelfAnlzBytes);
  if (!grid || grid.beats.length < 2)
    return {
      id: row.id,
      path: row.path,
      cls: "NO-GRID",
      detail: "sidecar has no decodable PQTZ beat grid",
    };
  if (!ledgerBeats) return { id: row.id, path: row.path, cls: "NO-LEDGER" };
  const rbBpm = anlzBpm(grid.beats);
  const v = rbBpm ? gridAuditFull(ledgerBeats, grid.beats, rbBpm) : null;
  if (!v)
    return {
      id: row.id,
      path: row.path,
      cls: "NO-GRID",
      detail: "grid too short to audit",
    };
  return {
    id: row.id,
    path: row.path,
    cls: v.bucket,
    anchorDeltaMs: v.anchorDeltaMs,
    phaseMs: v.phaseMs,
    phaseBeats: v.phaseBeats,
    detail: v.reason,
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function gridTriage(
  opts: GridTriageOptions,
): Promise<GridTriageResult> {
  const log = opts.log ?? commandLog(opts);
  const mount = opts.mount.replace(/\/+$/u, "");
  const dbPath =
    process.env.MEGADJ_RB_MASTER ??
    join(mount, "PIONEER", "Master", "master.db");
  const compareDrive = opts.compareDrive ?? null;
  const stickMount = compareDrive
    ? compareDrive.startsWith("/Volumes/") || compareDrive.startsWith("/tmp/")
      ? compareDrive
      : `/Volumes/${compareDrive}`
    : null;

  const fail = (msg: string): GridTriageResult => ({
    command: "rb-grid-triage",
    mount,
    db: dbPath,
    compareDrive,
    total: 0,
    audited: 0,
    buckets: Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<
      BucketName,
      number
    >,
    synced: null,
    syncIssues: null,
    noAnlz: 0,
    noLedger: 0,
    noGrid: 0,
    offenders: [],
    ok: false,
    error: msg,
  });

  if (!existsSync(dbPath)) {
    const r = fail(`no master DB at ${dbPath}`);
    log(r.error ?? "unknown failure");
    return r;
  }
  if (stickMount && !existsSync(stickMount)) {
    const r = fail(`compare drive not mounted: ${stickMount}`);
    log(r.error ?? "unknown failure");
    return r;
  }

  log(`rb-grid-triage: reading ${dbPath}`);
  let rows: MasterRow[];
  try {
    rows = opts.rows ?? readMasterRows(dbPath, skillScriptsDir());
  } catch (e) {
    const r = fail(e instanceof Error ? e.message : String(e));
    log(r.error ?? "unknown failure");
    return r;
  }
  const todo =
    opts.limit === undefined ? rows : rows.slice(0, Math.max(0, opts.limit));
  const idx = buildLedgerIndex(opts.state);
  log(
    `rb-grid-triage: ${todo.length} rows · ${idx.byRel.size} ledger entries · compare=${compareDrive ?? "off"}`,
  );

  const result = fail(""); // reused as the accumulator
  result.ok = true;
  result.error = undefined;
  result.total = todo.length;
  result.synced = stickMount ? 0 : null;
  result.syncIssues = stickMount ? 0 : null;

  const offenderRows: TriageRow[] = [];
  for (const row of todo) {
    const shelfAnlz = resolveCollectionAnlz(mount, row.anlz);
    const shelfBytes = shelfAnlz
      ? new Uint8Array(readFileSync(shelfAnlz))
      : null;
    let stickBytes: Uint8Array | null = null;
    if (stickMount) {
      const p = join(
        stickMount,
        "PIONEER",
        "USBANLZ",
        row.hashDir,
        "ANLZ0000.DAT",
      );
      stickBytes = existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
    }
    const beats = ledgerBeatsFor(row.path, idx);
    const t = triageRow({
      row,
      shelfAnlzBytes: shelfBytes,
      stickAnlzBytes: stickBytes,
      compareActive: !!stickMount,
      ledgerBeats: beats,
    });
    if (t.cls in result.buckets) {
      result.buckets[t.cls as BucketName]++;
      result.audited++;
      if (t.cls !== "A-OK") offenderRows.push(t);
    } else if (t.cls === "SYNC" || t.cls === "DRIVE-MISSING") {
      result.syncIssues!++; // a missing stick sidecar IS out of sync
      offenderRows.push(t);
    } else {
      result.synced!++;
    }
    if (t.cls === "NO-ANLZ") result.noAnlz++;
    if (t.cls === "NO-LEDGER") result.noLedger++;
    if (t.cls === "NO-GRID") result.noGrid++;
  }

  // Worst-first sample: SYNC issues, then non-A-OK buckets; cap 50.
  result.offenders = offenderRows.slice(0, 50);
  return result;
}

function skillScriptsDir(): string {
  return join(
    import.meta.dir,
    "..",
    "..",
    ".claude",
    "skills",
    "rekordbox-usb-sync",
    "scripts",
  );
}

/** Emit the human report (non-json mode). */
export function printGridTriageReport(
  r: GridTriageResult,
  log: (s: string) => void,
): void {
  if (r.error) {
    log(`error: ${r.error}`);
    return;
  }
  const b = r.buckets;
  log(
    `${r.total} rows · ${r.audited} audited` +
      (r.compareDrive ? ` · vs ${r.compareDrive}` : ""),
  );
  if (r.compareDrive)
    log(
      `sync: ${r.synced} identical · ${r.syncIssues} out-of-sync (SYNC issues get a re-export, NOT a re-analysis)`,
    );
  log(
    `grids: ${b["A-OK"]} ok · ${b.SHIFT} shift · ${b.PHASE} phase · ${b.TEMPO} tempo · ${b.DRIFT} drift · ${b.CHAOS} chaos`,
  );
  if (r.noAnlz || r.noLedger || r.noGrid)
    log(
      `gaps: ${r.noAnlz} no sidecar · ${r.noGrid} undecodable grid · ${r.noLedger} not in beats ledger`,
    );
  for (const o of r.offenders.slice(0, 10)) {
    const nums =
      o.anchorDeltaMs !== undefined
        ? ` anchor ${o.anchorDeltaMs} ms · phase ${o.phaseBeats ?? 0} beat(s)`
        : "";
    log(`  ${o.cls}: ${o.path}${nums}`);
  }
  if (r.offenders.length > 10)
    log(`  … and ${r.offenders.length - 10} more (--json for the full sample)`);
}
