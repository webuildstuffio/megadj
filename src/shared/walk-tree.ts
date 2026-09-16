/**
 * walk-tree.ts — THE one directory walker (issue #69).
 *
 * Six commands re-rolled the same recursive traversal with per-command
 * drift: junk filters disagreed (dotfiles-only vs AppleDouble+junk vs
 * quarantine SKIP_DIRS), landing shapes differed (relative paths vs
 * trash flat names), and unreadable directories were crash/skip/surface
 * depending on which file you were in. The audio-ext SSOT (audio-exts.ts)
 * closed the extension half; this closes the traversal half.
 *
 * The rule: ONE walker for every "walk a directory tree" pass. Policy
 * lives in the options — the deliberate differences (hygiene's
 * quarantine SKIP_DIRS, shelf-archive's junk-dir skip + PIONEER REC
 * landing root + trash flat-landing, ingest's quarantine path-prefix
 * skips) become visible configuration instead of divergent copy-paste.
 *
 * Semantics pinned by the existing suites:
 * - SYNC on purpose: callers are short CLI passes; the volume fits, and
 *   an async walk interleaving with fingerprint workers made dupescan's
 *   resume accounting racy once. For server/event-loop contexts use
 *   cratedeck's async walkTree instead.
 * - Dot-entries (files AND dirs) are always skipped — the one rule every
 *   walker agreed on (this also covers AppleDouble `._` forks).
 * - Soft-fail: an unreadable/missing dir contributes nothing and is
 *   surfaced in `unreadable` (and through `onUnreadable`) — a swallowed
 *   readdir is a dropped subtree, never silent.
 * - Files that vanish between readdir and stat are skipped, never fatal.
 * - Every collected file is stat'd once: bytes + mtimeMs ride the entry
 *   so callers never re-stat (hygiene's token, dupescan's keeper sort).
 */
import { readdirSync, statSync, type Dirent } from "node:fs";
import { basename, join, relative } from "node:path";

/** One walked file: absolute path, path relative to the landing root,
 * size, and mtime (one stat per file — callers never re-stat). */
export interface WalkEntry {
  abs: string;
  /** relative(root, abs) by default; the bare basename under `flat`;
   * computed against `relRoot` when that is set. */
  rel: string;
  bytes: number;
  mtimeMs: number;
}

export interface WalkTreeOptions {
  /** Extra entry filter. Dot-entries are ALWAYS skipped before this.
   * Files hit `skip(name, false)`; directories `skip(name, true)`. */
  skip?: (name: string, isDir: boolean) => boolean;
  /** When set, only files whose lowercase extension is in the set are
   * collected (the audio-exts SSOT). Absent = every file collects. */
  exts?: ReadonlySet<string>;
  /** rel is computed against this root instead of `root` (shelf-archive's
   * PIONEER REC landing: rel against the volume, not PIONEER REC/). */
  relRoot?: string;
  /** rel is the bare basename (trash flat-landing: deleted files keep
   * their NAMES — the folders they came from mean nothing). */
  flat?: boolean;
  /** Skip any directory whose absolute path equals or lives under one of
   * these prefixes (ingest's quarantine/rekordbox-dir skips). */
  skipPaths?: readonly string[];
  /** Called when a directory cannot be read (in addition to the returned
   * `unreadable` list) — surface the boundary, never swallow it. */
  onUnreadable?: (dir: string) => void;
}

export interface WalkTreeResult {
  entries: WalkEntry[];
  /** Dirs whose readdir failed — caller decides log/throw policy. */
  unreadable: string[];
}

function isUnderPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`),
  );
}

export function walkTree(root: string, opts?: WalkTreeOptions): WalkTreeResult {
  const entries: WalkEntry[] = [];
  const unreadable: string[] = [];
  const relRoot = opts?.flat ? undefined : (opts?.relRoot ?? root);
  const skipPaths = opts?.skipPaths;
  const walk = (dir: string): void => {
    let dirents: Dirent[];
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch {
      unreadable.push(dir); // caller logs the boundary; walk continues
      opts?.onUnreadable?.(dir);
      return;
    }
    for (const ent of dirents) {
      if (ent.name.startsWith(".")) continue; // dotfiles + `._` AppleDouble
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (opts?.skip?.(ent.name, true)) continue;
        if (skipPaths && isUnderPrefix(abs, skipPaths)) continue;
        walk(abs);
        continue;
      }
      if (opts?.skip?.(ent.name, false)) continue;
      if (opts?.exts) {
        const dot = ent.name.lastIndexOf(".");
        const ext = dot > 0 ? ent.name.slice(dot).toLowerCase() : "";
        if (!opts.exts.has(ext)) continue;
      }
      try {
        const st = statSync(abs);
        entries.push({
          abs,
          rel: opts?.flat ? basename(abs) : relative(relRoot!, abs),
          bytes: st.size,
          mtimeMs: st.mtimeMs,
        });
      } catch {
        // vanished mid-walk — next run sees it or it's gone; never crash
      }
    }
  };
  walk(root);
  return { entries, unreadable };
}
