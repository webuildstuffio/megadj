/**
 * walkShelf — THE shelf walk (§5 Phase 1.1). One module, one exclusion
 * rule set, one walk token — the previous per-command walkers (dupescan,
 * shelf-archive) each rolled their own filters, and the exclusions this
 * feature needs (quarantine dirs, PIONEER DBs, AppleDouble junk) are a
 * repo rule, not a per-command preference.
 *
 * #69: the traversal itself rides the shared walker (src/shared/
 * walk-tree.ts) — this module is the hygiene POLICY (SKIP_DIRS, junk
 * names, audio-ext filter) over it. Sync readdir on purpose: the CLI +
 * job paths both run it as a discrete leg and tick progress around it;
 * the volume fits, and an async walk that interleaves with fingerprint
 * workers made resume accounting racy once (dupescan's original pool
 * design).
 */
import { join } from "node:path";
import { walkTree } from "../../shared/walk-tree";
import { AUDIO_EXTS } from "../../shared/audio-exts";
import { walkTokenFor, type ShelfFile } from "./types";

/** Never walked, never reported: AppleDouble forks + finder junk (exFAT
 *  materializes `._` lazily — trap §3.7), rekordbox device DBs (device-
 *  library only; `PIONEER REC/` recordings ARE walked), and the hygiene/
 *  dupescan quarantine dirs themselves (their contents are DELIBERATE
 *  copies — walking them would re-report every already-quarantined loser
 *  as an orphan/duplicate forever). */
const SKIP_DIRS = new Set([
  ".dupescan-quarantine",
  ".hygiene-quarantine",
  "PIONEER",
  "_appledouble-junk",
]);

export function isJunkName(name: string): boolean {
  return (
    name.startsWith("._") ||
    name === ".DS_Store" ||
    name.startsWith(".hygiene-") ||
    name.endsWith(".tmp")
  );
}

export function walkShelf(volume: string): {
  files: ShelfFile[];
  walkToken: string;
  /** dirs whose readdir failed — surfaced, never silent (a swallowed
   *  readdir = a dropped subtree = findings that never existed) */
  unreadable: string[];
} {
  const { entries, unreadable } = walkTree(join(volume, "Contents"), {
    exts: AUDIO_EXTS,
    skip: (name, isDir) =>
      (isDir && SKIP_DIRS.has(name)) || (!isDir && isJunkName(name)),
  });
  const files: ShelfFile[] = entries.map((e) => ({
    path: e.abs,
    bytes: e.bytes,
    mtimeMs: e.mtimeMs,
  }));
  return { files, walkToken: walkTokenFor(files), unreadable };
}
