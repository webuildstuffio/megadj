// walk.ts — one shared filesystem walker. scan.ts and bench.ts used to carry
// two near-identical recursive walkers (dup LOC + divergent skip rules).
//
// Async (fs/promises) end-to-end: a full-drive walk from the job engine must
// NOT block the event loop — spawnSync/hash loops once froze the server for
// minutes and starved the SSE heartbeat (Bun kills silent streams ~10s),
// which stranded finished jobs as phantom "running 0%" (see AGENTS.md
// invariants). Keep it async — there is a regression expectation.
import { readdir, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
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
export async function walkTree(root: string, opts: WalkOptions): Promise<void> {
  let base = root;
  let relBase = "";
  if (opts.onlySubdir) {
    try {
      await readdir(join(root, opts.onlySubdir));
      base = join(root, opts.onlySubdir);
      relBase = opts.onlySubdir;
    } catch {
      // subdir absent — walk the root itself (non-rekordbox sticks)
    }
  }
  await rec(base, relBase, opts);
}

async function rec(
  dir: string,
  rel: string,
  opts: WalkOptions,
): Promise<boolean /* false = stop */> {
  let entries;
  try {
    // withFileTypes gives Dirents and saves a stat per entry on the happy
    // path (isDirectory()/isFile() come from the dirent, not statSync).
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  const skipDirs = opts.skipDirs ?? DEFAULT_SKIP_DIRS;
  const skipPrefixes = opts.skipPrefixes ?? [];
  for (const e of entries) {
    if (skipDirs.has(e.name) || skipPrefixes.some((p) => e.name.startsWith(p)))
      continue;
    const p = join(dir, e.name);
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    let st: Stats;
    if (e.isFile()) {
      // Dirent knows it's a file — stat is still needed for size/mtime.
      try {
        st = await stat(p);
      } catch {
        continue;
      }
      if (opts.onFile(p, st, relPath) === false) return false;
      continue;
    }
    if (e.isDirectory()) {
      if (!(await rec(p, relPath, opts))) return false;
      continue;
    }
    // sockets/fifos/symlinks: the sync walker stat()'d everything and
    // dispatched on the follow target; keep a stat for non-dirent-known
    // kinds only (rare) so behavior stays compatible.
    try {
      st = await stat(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!(await rec(p, relPath, opts))) return false;
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
