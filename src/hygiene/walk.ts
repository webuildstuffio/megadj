/**
 * walkShelf — THE shelf walk (§5 Phase 1.1). One module, one exclusion
 * rule set, one walk token — the previous per-command walkers (dupescan,
 * shelf-archive) each rolled their own filters, and the exclusions this
 * feature needs (quarantine dirs, PIONEER DBs, AppleDouble junk) are a
 * repo rule, not a per-command preference.
 *
 * Sync readdir on purpose: the CLI + job paths both run it as a discrete
 * leg and tick progress around it; the volume fits, and an async walk
 * that interleaves with fingerprint workers made resume accounting racy
 * once (dupescan's original pool design).
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { walkTokenFor, type ShelfFile } from "./types";

export const AUDIO_EXT = new Set([
  ".mp3",
  ".wav",
  ".aif",
  ".aiff",
  ".m4a",
  ".flac",
]);

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
} {
  const root = join(volume, "Contents");
  const files: ShelfFile[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable subdir — logged by the caller leg, walk continues
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue; // dotdirs + dotfiles
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(join(dir, e.name));
        continue;
      }
      if (isJunkName(e.name)) continue;
      const dot = e.name.lastIndexOf(".");
      const ext = dot > 0 ? e.name.slice(dot).toLowerCase() : "";
      if (!AUDIO_EXT.has(ext)) continue;
      const abs = join(dir, e.name);
      try {
        const st = statSync(abs);
        files.push({ path: abs, bytes: st.size, mtimeMs: st.mtimeMs });
      } catch {
        // vanished mid-walk — next run sees it or it's gone; never crash
      }
    }
  };
  walk(root);
  return { files, walkToken: walkTokenFor(files) };
}
