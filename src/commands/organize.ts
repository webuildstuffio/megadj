/**
 * megadj organize — move downloaded files into genre folders and keep the
 * state DB in sync. Rekordbox-friendly layout:
 *
 *   ~/Music/DJ-Imports/
 *     House/Track A.m4a
 *     Hip-Hop/Track B.m4a
 *     ...
 *
 * Genre is read from the DB (populated at download time) with a fallback to
 * the genre tag embedded in the file (ffprobe).
 */

import { $ } from "bun";
import type { ArchiveState } from "../state";
import { sanitizeGenreFolder } from "../metadata";

export interface OrganizeOptions {
  state: ArchiveState;
  musicDir: string;
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean;
}

async function fileGenreTag(filePath: string): Promise<string | null> {
  const proc =
    await $`ffprobe -v quiet -show_entries format_tags=genre -of csv=p=0 ${filePath}`
      .quiet()
      .nothrow();
  if (proc.exitCode !== 0) return null;
  const tag = new TextDecoder().decode(proc.stdout).trim();
  return tag || null;
}

export async function organize(opts: OrganizeOptions): Promise<void> {
  // --json mode (P1): human logs go quiet — the summary object is the only
  // stdout output so agents get parseable JSON.
  const rawLog = opts.onProgress ?? ((m: string) => console.log(m));
  const log = opts.json && !opts.onProgress ? () => {} : rawLog;
  const tracks = opts.state
    .allTracks()
    .filter((t) => t.status === "downloaded" && t.file_path);
  log(`organizing ${tracks.length} downloaded track(s)`);
  let moved = 0;
  let skipped = 0;
  let missing = 0;
  let movedFailed = 0;

  for (const track of tracks) {
    const filePath = track.file_path;
    if (!filePath) continue;
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      missing++;
      log(`  ✗ missing on disk: ${filePath}`);
      continue;
    }

    const genre = track.genre ?? (await fileGenreTag(filePath)) ?? "Music";
    const folder = sanitizeGenreFolder(genre);
    const fileName = filePath.split("/").pop() ?? `${track.video_id}.m4a`;
    const targetDir = `${opts.musicDir}/${folder}`;
    const targetPath = `${targetDir}/${fileName}`;

    if (filePath === targetPath) {
      skipped++;
      continue;
    }

    if (opts.dryRun) {
      log(`  would move: ${fileName} → ${folder}/`);
      continue;
    }

    // nothrow: an unwritable parent must skip the track, not crash the run.
    const mk = await $`mkdir -p ${targetDir}`.quiet().nothrow();
    if (mk.exitCode !== 0) {
      movedFailed++;
      log(`  ✗ cannot create ${folder}/ (skipping): ${filePath}`);
      continue;
    }
    // Never clobber: if the destination exists with different bytes it is a
    // different rip of the same track — keep both, disambiguate the name.
    let dest = targetPath;
    if (await Bun.file(targetPath).exists()) {
      const ext = fileName.match(/(\.[^.]+)$/)?.[1] ?? "";
      const stem = ext ? fileName.slice(0, -ext.length) : fileName;
      dest = `${targetDir}/${stem} [${track.video_id}]${ext}`;
      log(
        `  ⚠ destination exists — moving as ${stem} [${track.video_id}]${ext}`,
      );
    }
    // Only record the move when it actually happened. The old quiet+nothrow
    // `mv` updated file_path unconditionally, so a failed move (EXDEV, disk
    // full, permissions) left the DB pointing at a file that never existed —
    // and every later pass treated the phantom path as ground truth.
    const mv = await $`mv ${filePath} ${dest}`.quiet().nothrow();
    if (mv.exitCode !== 0) {
      movedFailed++;
      log(`  ✗ move failed (DB unchanged): ${filePath}`);
      continue;
    }
    opts.state.updateFilePath(track.video_id, dest);
    moved++;
    log(`  → ${folder}/${dest.split("/").pop()}`);
  }

  log(
    `\norganize complete: ${moved} moved, ${skipped} already organized, ${missing} missing` +
      (movedFailed > 0 ? `, ${movedFailed} move-failed` : ""),
  );
  if (opts.json) {
    // P1 (--json on every command): one summary object on stdout, last.
    console.log(
      JSON.stringify({
        command: "organize",
        dryRun: opts.dryRun ?? false,
        considered: tracks.length,
        moved,
        alreadyOrganized: skipped,
        missing,
        moveFailed: movedFailed,
      }),
    );
  }
}
