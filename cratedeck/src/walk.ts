// walk.ts — one shared filesystem walker. scan.ts and bench.ts used to carry
// two near-identical recursive walkers (dup LOC + divergent skip rules).
import { readdirSync, statSync, type Stats } from "node:fs";
import { join } from "node:path";

export interface WalkOptions {
  /** Called for each regular file. Return `false` to stop early. */
  onFile: (path: string, st: Stats, relPath: string) => boolean | void;
  /** Directories to skip anywhere in the tree. */
  skipDirs?: ReadonlySet<string>;
  /** File-name prefixes to skip (e.g. AppleDouble "._"). */
  skipPrefixes?: readonly string[];
  /** Only descend into this subdirectory of root when present (e.g. Contents). */
  onlySubdir?: string;
}

const DEFAULT_SKIP_DIRS = new Set([
  ".Trash",
  "System Volume Information",
  ".Spotlight-V100",
  ".fseventsd",
  ".Trashes",
]);

/** Depth-first walk. `relPath` is relative to `root`, "/"-separated. */
export function walkTree(root: string, opts: WalkOptions): void {
  let base = root;
  let relBase = "";
  if (opts.onlySubdir) {
    try {
      readdirSync(join(root, opts.onlySubdir));
      base = join(root, opts.onlySubdir);
      relBase = opts.onlySubdir;
    } catch {
      // subdir absent — walk the root itself (non-rekordbox sticks)
    }
  }
  rec(base, relBase, opts);
}

function rec(
  dir: string,
  rel: string,
  opts: WalkOptions,
): boolean /* false = stop */ {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return true;
  }
  const skipDirs = opts.skipDirs ?? DEFAULT_SKIP_DIRS;
  const skipPrefixes = opts.skipPrefixes ?? [];
  for (const e of entries) {
    if (skipDirs.has(e) || skipPrefixes.some((p) => e.startsWith(p))) continue;
    const p = join(dir, e);
    const relPath = rel ? `${rel}/${e}` : e;
    let st: Stats;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!rec(p, relPath, opts)) return false;
    } else if (st.isFile()) {
      if (opts.onFile(p, st, relPath) === false) return false;
    }
  }
  return true;
}

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "(none)";
}
