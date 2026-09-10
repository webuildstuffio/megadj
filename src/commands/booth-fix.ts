/**
 * booth-fix — propose (and optionally apply) fixes for everything the
 * booth gates flag: `megadj audit` finds the gaps, this command FIXES
 * the fixable ones and prints an executable plan for the rest.
 *
 * Fix matrix (fleet-aware — derived from config.toml [booth].fleet via
 * setBoothFleet, so a CDJ-2000 in the fleet widens the fix set):
 *
 *   flag                    fix                                        apply-safe?
    10| *   ----------------------  -----------------------------------------  -----------
 *   non-fleet-characters    sanitize tag text (per-char: strip emoji,  yes (tag
 *                           transliterate accents→ASCII, drop or        rewrite,
 *                           best-effort map other scripts)              atomic)
 *   mojibake                re-decode (CP1252→UTF-8 or CP1251) and     yes (tag
 *                           write the repaired string                    rewrite)
 *   path-illegal-character  rename file (sanitized), update DB paths   yes (rename
 *                           so rekordbox relink + re-export work         + DB update)
 *   path-trailing-dot/space rename (same machinery)                    yes
 *   path-too-long / -deep   propose only (moves change library layout; yes→plan
    20| *                           the plan names the shallowest legal path)  only
 *   player-compat (audio)   convert/re-encode is convert's job — the   plan only
 *                           plan names `megadj convert` / re-source
 *
 * Nothing is deleted, ever: renames keep the same audio bytes; tag
 * sanitization preserves the rest of the tag. --apply idempotence: a
 * second run finds nothing to fix (the sanitizer is a fixed point).
 *
 * The per-file text fixer lives in booth_fix_text.ts (rename + tag rows,
 * apply order); this module owns the walk, the gate input assembly, the
 * player-compat plan rows, and the DB path follow.
 */
import { basename } from "node:path";
import { existsSync } from "node:fs";
import {
  groundTruth,
  walkAudioFiles,
  probeFile,
  playerCompat,
  isHiresOnly,
  boothTextCompat,
  type TextCompatResult,
} from "../../fulltags/src/exports";
import { fixBoothText } from "./booth_fix_text";
import type { BoothFixRow, BoothFixResult } from "./booth_fix_types";
import type { ArchiveState } from "../state";

// Text sanitizers moved to booth_fix_text.ts with the fixer; re-exported so
// existing `from "./booth-fix"` import sites (tests, CLI help) stay put.
export {
  sanitizeDisplayText,
  sanitizeFilename,
  repairMojibake,
} from "./booth_fix_text";

export interface BoothFixOptions {
  state: ArchiveState;
  musicDir: string;
  /** Extra root to also walk (e.g. the shelf Contents dir). */
  alsoWalk?: string;
  dryRun?: boolean;
  apply?: boolean;
  json?: boolean;
  log?: (m: string) => void;
}

// BoothFixRow/BoothFixResult are DEFINED in booth_fix_types.ts (the leaf
// seam shared with booth_fix_text.ts — a split-out module must never import
// its parent's types back: madge counts a type-only back-edge as a cycle).
// Re-exported so existing `from "./booth-fix"` sites hold.
export type { BoothFixRow, BoothFixResult } from "./booth_fix_types";

/** Look up the track a file belongs to (booth-fix's DB follow). Scans
 * the in-memory track list — the archive is ~hundreds of rows, and this
 * avoids widening ArchiveState's query surface. */
export function trackIdForFile(
  state: ArchiveState,
  relPath: string,
): string | null {
  const hit = state
    .allTracks()
    .find(
      (t) => t.file_path === relPath || t.file_path?.endsWith(`/${relPath}`),
    );
  return hit?.video_id ?? null;
}

function walkRoots(musicDir: string, alsoWalk?: string): string[] {
  const roots = [walkAudioFiles(musicDir)];
  if (alsoWalk && existsSync(alsoWalk)) roots.push(walkAudioFiles(alsoWalk));
  return roots.flat();
}

export async function boothFix(opts: BoothFixOptions): Promise<BoothFixResult> {
  const log = opts.log ?? (() => {});
  const apply = opts.apply === true && opts.dryRun !== true;
  const rows: BoothFixRow[] = [];
  const seen = new Set<string>();
  let checked = 0;
  let applied = 0;
  const { getBoothFleet } = await import("../../fulltags/src/exports");
  const sink = { apply, applied, log };

  for (const p of walkRoots(opts.musicDir, opts.alsoWalk)) {
    if (seen.has(p) || !existsSync(p)) continue;
    seen.add(p);
    checked++;
    const t = groundTruth(p);
    const text: TextCompatResult = boothTextCompat({
      filename: basename(p),
      title: t.title,
      artist: t.artist,
      album: t.album,
      genre: t.genre,
      relPath: p.slice(opts.musicDir.length + 1),
    });
    const compat = playerCompat(await probeFile(p));

    if (text.ok && (compat.ok || isHiresOnly(compat))) continue;

    // Build the fix plan. Order matters: rename first (paths), then tag
    // text, so the DB path update lands against the final name (the order
    // lives inside fixBoothText).
    const outcome = fixBoothText(
      p,
      text,
      { title: t.title, artist: t.artist, album: t.album, genre: t.genre },
      sink,
    );
    applied = sink.applied;
    if (outcome.row) rows.push(outcome.row);
    const workFile = outcome.workFile;

    if (!compat.ok && !isHiresOnly(compat)) {
      rows.push({
        file: workFile,
        gate: "player-compat",
        reasons: [...compat.reasons],
        action: "none",
        plan: `audio outside the fleet floor (${compat.reasons.join(", ")}) — run \`megadj convert\` (WAV→AIFF) or re-source the track`,
      });
    }

    // DB path follow for applied renames (rekordbox relink reads this).
    if (outcome.renamed) {
      const relOld = p.slice(opts.musicDir.length + 1);
      const relNew = workFile.slice(opts.musicDir.length + 1);
      const videoId = trackIdForFile(opts.state, relOld);
      if (videoId) opts.state.updateFilePath(videoId, relNew);
    }
  }

  const result: BoothFixResult = {
    fleet: [...getBoothFleet()],
    checked,
    fixable: rows.filter((r) => r.action !== "none").length,
    applied,
    rows,
  };
  return result;
}
