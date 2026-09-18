// tmp-purge.ts — `megadj tmp-purge`: the reusable sweep for stale test
// fixture dirs in the OS tmpdir (#236). The megadj + cratedeck test
// suites create prefixed fixture dirs (cratedeck-hashcancel-*,
// cratedeck-config-*, cratedeck-event-cap-*, megadj-*) that leaked
// unbounded for weeks — 16k dirs / 2.6 GB measured Sep 18.
//
// Policy encoded here so the cleanup never needs a one-off script:
//   - only KNOWN fixture prefixes are eligible (never a blind tmp sweep)
//   - age-gated by default (>24h, the AGENTS.md fixture rule) so a
//     concurrently RUNNING suite's live fixtures are never swept
//   - `--all` takes every eligible dir regardless of age (only when the
//     test gate is known-quiet)
//   - per-family counts + bytes in the report; `--json` contract
//
// Read-only by default: pass --apply to delete.
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  scanned: number;
  eligible: number;
  applied: number;
  freedBytes: number;
  families: TmpPurgeFamily[];
  appliedMode: boolean;
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
  const root = tmpdir();
  const cutoffMs = opts.all
    ? Number.POSITIVE_INFINITY
    : Date.now() - 24 * 60 * 60 * 1000;
  const byFamily = new Map<string, TmpPurgeFamily>();

  let scanned = 0;
  let eligible = 0;
  let applied = 0;
  let freedBytes = 0;

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (e) {
    opts.log(`tmp-purge: cannot read ${root}: ${(e as Error).message}`);
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

  for (const name of entries) {
    const prefix = FIXTURE_PREFIXES.find((p) => name.startsWith(p));
    if (!prefix) continue;
    scanned++;
    const full = join(root, name);
    let ageOk = false;
    try {
      ageOk = statSync(full).mtimeMs <= cutoffMs;
    } catch {
      continue;
    }
    if (!ageOk) continue;
    eligible++;
    const bytes = treeBytes(full);
    const fam = byFamily.get(prefix) ?? { prefix, dirs: 0, bytes: 0 };
    fam.dirs++;
    fam.bytes += bytes;
    byFamily.set(prefix, fam);
    if (opts.apply) {
      try {
        rmSync(full, { recursive: true, force: true });
        applied++;
        freedBytes += bytes;
      } catch (e) {
        opts.log(`  ! could not remove ${name}: ${(e as Error).message}`);
      }
    }
  }

  const families = [...byFamily.values()].toSorted((a, b) => b.dirs - a.dirs);
  return {
    ok: true,
    root,
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
  log(`megadj tmp-purge — root: ${r.root}`);
  if (!r.ok) {
    log("  scan failed (see above)");
    return;
  }
  log(
    `  eligible fixture dirs: ${r.eligible} of ${r.scanned} matching${r.appliedMode ? "" : " (read-only; pass --apply to delete)"}`,
  );
  for (const f of r.families) {
    log(
      `    ${f.prefix.padEnd(24)} ${String(f.dirs).padStart(6)} dirs  ${(f.bytes / 1e6).toFixed(1)} MB`,
    );
  }
  if (r.appliedMode) {
    log(
      `removed ${r.applied} dir(s), freed ${(r.freedBytes / 1e6).toFixed(1)} MB`,
    );
  }
}
