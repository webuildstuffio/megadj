// tmp-purge.ts — `megadj tmp-purge`: the reusable sweep for stale test
// fixture dirs in the OS tmpdir (#236), plus the state-dir backup tier
// (Sep 18: five superseded archive.db backups ≈118 MB had piled up next
// to the live ledger with nobody owning their retention).
//
// Policy encoded here so the cleanup never needs a one-off script:
//   - only KNOWN fixture prefixes are eligible (never a blind tmp sweep)
//   - age-gated by default (>24h, the AGENTS.md fixture rule) so a
//     concurrently RUNNING suite's live fixtures are never swept
//   - `--all` takes every eligible dir regardless of age (only when the
//     test gate is known-quiet)
//   - `--state` sweeps ~/.local/state/megadj instead: superseded dated
//     backups (newest lineage snapshot per DB stem is KEPT), orphan
//     -shm/-wal sidecars of DBs that are not open (lsof-verified), and
//     age-gated spike/ artifacts. The live DB never matches a backup
//     pattern, so it is unreachable by construction.
//   - per-family counts + bytes in the report; `--json` contract
//
// Read-only by default: pass --apply to delete.
import { readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

/** Dir-name prefixes this repo's test suites create as fixtures. */
export const FIXTURE_PREFIXES = [
  "cratedeck-hashcancel-",
  "cratedeck-config-",
  "cratedeck-event-cap-",
  "cratedeck-kill-9-",
  "cratedeck-ln-",
  "cratedeck-gate-vol-",
  "megadj-",
] as const;

export interface TmpPurgeOptions {
  apply: boolean;
  all: boolean;
  json: boolean;
  /** Sweep the state dir (~/.local/state/megadj) instead of the tmpdir. */
  state?: boolean;
  log: (message: string) => void;
}

export interface TmpPurgeFamily {
  prefix: string;
  dirs: number;
  bytes: number;
}

export interface TmpPurgeResult {
  ok: boolean;
  root: string;
  /** All roots scanned when tmpdir() and /tmp differ (one entry each). */
  roots?: string[];
  scanned: number;
  eligible: number;
  applied: number;
  freedBytes: number;
  families: TmpPurgeFamily[];
  appliedMode: boolean;
  /** Present on --state runs: the newest backup kept per DB stem. */
  kept?: string[];
}

/** Recursive byte size (a dir's own stat is not its content size). */
function treeBytes(path: string): number {
  let total = 0;
  try {
    const st = statSync(path);
    if (!st.isDirectory()) return st.size;
    for (const entry of readdirSync(path)) {
      total += treeBytes(join(path, entry));
    }
  } catch {
    return total;
  }
  return total;
}

export function tmpPurge(opts: TmpPurgeOptions): TmpPurgeResult {
  return opts.state ? statePurge(opts) : tmpPurgeSweep(opts);
}

/** PIDs holding any file under `dir` open (lsof +D), or null on failure.
 *  A nonzero/blocked lsof must never widen the sweep — we treat unknown
 *  as "in use" and skip deletion of sidecars only (backups are still
 *  name-gated). */
function openPathsUnder(dir: string): Set<string> | null {
  try {
    const out = execFileSync("/usr/sbin/lsof", ["+D", dir], {
      encoding: "utf8",
      timeout: 10_000,
    });
    const held = new Set<string>();
    for (const line of out.split("\n")) {
      const path = line.slice(line.lastIndexOf(" ") + 1).trim();
      if (path.startsWith("/")) held.add(path);
    }
    return held;
  } catch {
    return null;
  }
}

/**
 * The --state tier: prune superseded backups + orphan sidecars + stale
 * spike artifacts under ~/.local/state/megadj.
 *
 * Backup name classes recognized (all dated, all superseded by a NEWER
 * backup of the same stem):
 *   archive.db.bak-<ts>          archive.db.pre-restore-<ts>.bak
 *   archive.db.bak-<ts>-shm|-wal archive_bak_<ISO>.db(.bak)
 * The newest member per stem is ALWAYS kept; the live `archive.db`
 * itself matches no class and is unreachable.
 */
export function statePurge(opts: TmpPurgeOptions): TmpPurgeResult {
  const root = join(homedir(), ".local", "state", "megadj");
  const byFamily = new Map<string, TmpPurgeFamily>();
  const kept: string[] = [];
  const add = (prefix: string, name: string, bytes: number, del: boolean) => {
    const fam = byFamily.get(prefix) ?? { prefix, dirs: 0, bytes: 0 };
    fam.dirs++;
    fam.bytes += bytes;
    byFamily.set(prefix, fam);
    if (del && opts.apply) {
      try {
        rmSync(join(root, name), { force: true });
      } catch (e) {
        opts.log(`  ! could not remove ${name}: ${(e as Error).message}`);
        return;
      }
    }
  };

  let names: string[];
  try {
    names = readdirSync(root);
  } catch (e) {
    opts.log(`tmp-purge --state: cannot read ${root}: ${(e as Error).message}`);
    return {
      ok: false,
      root,
      scanned: 0,
      eligible: 0,
      applied: 0,
      freedBytes: 0,
      families: [],
      appliedMode: opts.apply,
    };
  }

  const held = opts.apply ? openPathsUnder(root) : null;

  // ---- pass 1: classify + find the newest backup per stem ----
  interface Cand {
    name: string;
    stem: string;
    stamp: number;
    bytes: number;
    kind: "backup" | "sidecar" | "spike";
  }
  const cands: Cand[] = [];
  const newestByStem = new Map<string, number>();
  let scanned = 0;

  for (const name of names) {
    // Superseded dated backups (never the live `archive.db` itself).
    const backupStem = backupClass(name);
    // Orphan SQLite sidecars: -shm/-wal whose DB is not currently open.
    const sidecarOf = sidecarClass(name);
    if (
      backupStem === null &&
      sidecarOf === null &&
      !name.startsWith("spike")
    ) {
      continue;
    }
    scanned++;
    const full = join(root, name);
    let bytes = 0;
    let mtime = 0;
    try {
      const st = statSync(full);
      bytes = st.isDirectory() ? treeBytes(full) : st.size;
      mtime = st.mtimeMs;
    } catch {
      continue;
    }
    if (backupStem !== null) {
      const prev = newestByStem.get(backupStem) ?? 0;
      if (mtime > prev) newestByStem.set(backupStem, mtime);
      cands.push({
        name,
        stem: backupStem,
        stamp: mtime,
        bytes,
        kind: "backup",
      });
    } else if (sidecarOf !== null) {
      cands.push({
        name,
        stem: sidecarOf,
        stamp: mtime,
        bytes,
        kind: "sidecar",
      });
    } else {
      // spike/ artifacts: the rb-anlz-spike baselines. Age-gated like
      // tmp fixtures (>24h) — a just-written baseline is never swept.
      const fresh = Date.now() - mtime < 24 * 60 * 60 * 1000;
      if (!opts.all && fresh) continue;
      cands.push({
        name,
        stem: "spike",
        stamp: mtime,
        bytes,
        kind: "spike",
      });
    }
  }

  // ---- pass 2: apply the keep-newest + open-file guards ----
  let eligible = 0;
  let applied = 0;
  let freedBytes = 0;
  for (const c of cands) {
    if (c.kind === "backup" && c.stamp === newestByStem.get(c.stem)) {
      // Newest backup of this stem: lineage snapshot, kept.
      if (!kept.includes(c.name)) kept.push(c.name);
      continue;
    }
    if (c.kind === "sidecar" && held !== null && held.has(join(root, c.stem))) {
      continue; // DB is open — its sidecars are live WAL/SHM state
    }
    eligible++;
    add(c.kind, c.name, c.bytes, true);
    if (opts.apply) {
      applied++;
      freedBytes += c.bytes;
    }
  }

  const families = [...byFamily.values()].toSorted((a, b) => b.dirs - a.dirs);
  return {
    ok: true,
    root,
    roots: [root],
    scanned,
    eligible,
    applied,
    freedBytes,
    families,
    appliedMode: opts.apply,
    kept,
  };
}

/** Classify a state-dir backup name → its DB stem, or null. */
export function backupClass(name: string): string | null {
  const m1 = /^archive\.db\.(bak-\d{8}-\d{6})/.exec(name);
  if (m1) return "archive.db";
  const m2 = /^archive\.db\.pre-restore-\d{8}-\d{6}\.bak/.exec(name);
  if (m2) return "archive.db";
  const m3 = /^archive_bak_[\d-]+T[\d-]+Z\.db/.exec(name);
  if (m3) return "archive.db";
  // Dated lineage snapshots (#108-class): archive-db-before-<what>-<date>.db
  const m4 = /^archive-db-before-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.db$/.exec(name);
  if (m4) return "archive.db";
  return null;
}

/** Classify a SQLite sidecar name → its DB stem, or null. */
export function sidecarClass(name: string): string | null {
  // `-shm`/`-wal` hang off ANY basename, including backup names like
  // `archive.db.bak-20260911-185351-shm` — the stem is the full name
  // minus the suffix, so the lsof guard compares the actual sibling.
  const m = /^(.+)-(shm|wal)$/.exec(name);
  return m?.[1] ?? null;
}

/** One root scan: every fixture-prefixed entry, classified + age-gated.
 *  Shared by the multi-root sweep (#254) so both roots age identically. */
interface RootTally {
  scanned: number;
  eligible: number;
  applied: number;
  freedBytes: number;
}

function scanOneTmpRoot(
  root: string,
  cutoffMs: number,
  apply: boolean,
  log: (message: string) => void,
  byFamily: Map<string, TmpPurgeFamily>,
): RootTally {
  const tally: RootTally = {
    scanned: 0,
    eligible: 0,
    applied: 0,
    freedBytes: 0,
  };

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (e) {
    log(`tmp-purge: cannot read ${root}: ${(e as Error).message}`);
    return tally;
  }

  for (const name of entries) {
    const prefix = FIXTURE_PREFIXES.find((p) => name.startsWith(p));
    if (!prefix) continue;
    tally.scanned++;
    const full = join(root, name);
    let ageOk = false;
    try {
      ageOk = statSync(full).mtimeMs <= cutoffMs;
    } catch {
      continue;
    }
    if (!ageOk) continue;
    tally.eligible++;
    const bytes = treeBytes(full);
    const fam = byFamily.get(prefix) ?? { prefix, dirs: 0, bytes: 0 };
    fam.dirs++;
    fam.bytes += bytes;
    byFamily.set(prefix, fam);
    if (apply) {
      try {
        rmSync(full, { recursive: true, force: true });
        tally.applied++;
        tally.freedBytes += bytes;
      } catch (e) {
        log(`  ! could not remove ${full}: ${(e as Error).message}`);
      }
    }
  }
  return tally;
}

/** The tmpdir tier (#254: scans BOTH tmpdir() and /tmp when they differ,
 *  deduped by realpath — the two roots leak independently). Exported for
 *  the multi-root pin test; the CLI rides tmpPurge(). */
export function tmpPurgeSweep(opts: TmpPurgeOptions): TmpPurgeResult {
  // #254: macOS moved the default tmpdir to ~/.tmp while real suites
  // still leak into /tmp proper — the two roots exist and leak
  // independently, so BOTH are scanned (deduped by realpath) with
  // identical age gating.
  const primary = tmpdir();
  const fallback = "/tmp";
  const roots = new Set<string>([realpathSync(primary)]);
  if (realpathSync(fallback) !== realpathSync(primary)) {
    roots.add(realpathSync(fallback));
  }

  const cutoffMs = opts.all
    ? Number.POSITIVE_INFINITY
    : Date.now() - 24 * 60 * 60 * 1000;
  const byFamily = new Map<string, TmpPurgeFamily>();

  let scanned = 0;
  let eligible = 0;
  let applied = 0;
  let freedBytes = 0;

  for (const root of roots) {
    const t = scanOneTmpRoot(root, cutoffMs, opts.apply, opts.log, byFamily);
    scanned += t.scanned;
    eligible += t.eligible;
    applied += t.applied;
    freedBytes += t.freedBytes;
  }

  const families = [...byFamily.values()].toSorted((a, b) => b.dirs - a.dirs);
  return {
    ok: true,
    root: primary,
    roots: [...roots].toSorted(),
    scanned,
    eligible,
    applied,
    freedBytes,
    families,
    appliedMode: opts.apply,
  };
}

export function printTmpPurgeReport(
  r: TmpPurgeResult,
  log: (message: string) => void,
): void {
  // #254: every scanned root is listed (tmp sweep scans both tmpdir()
  // and /tmp when they differ; the state tier has exactly one).
  log(`megadj tmp-purge — root: ${r.root}${r.kept ? " (state tier)" : ""}`);
  if (!r.ok) {
    log("  scan failed (see above)");
    return;
  }
  if (r.roots && r.roots.length > 1) {
    for (const root of r.roots) log(`  also scanning: ${root}`);
  }
  if (r.kept) {
    for (const k of r.kept) log(`  kept (newest lineage): ${k}`);
  }
  log(
    `  eligible: ${r.eligible} of ${r.scanned} matching${r.appliedMode ? "" : " (read-only; pass --apply to delete)"}`,
  );
  for (const f of r.families) {
    log(
      `    ${f.prefix.padEnd(24)} ${String(f.dirs).padStart(6)} dirs  ${(f.bytes / 1e6).toFixed(1)} MB`,
    );
  }
  if (r.appliedMode) {
    log(
      `removed ${r.applied} item(s), freed ${(r.freedBytes / 1e6).toFixed(1)} MB`,
    );
  }
}
