/**
 * megadj organize — move downloaded files into genre folders and keep the
 * state DB in sync. Rekordbox-friendly layout:
 *
 *   ~/Music/YTMusic-Liked/
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
}

async function fileGenreTag(filePath: string): Promise<string | null> {
  const proc = await $`ffprobe -v quiet -show_entries format_tags=genre -of csv=p=0 ${filePath}`
    .quiet()
    .nothrow();
  if (proc.exitCode !== 0) return null;
  const tag = new TextDecoder().decode(proc.stdout).trim();
  return tag || null;
}

export async function organize(opts: OrganizeOptions): Promise<void> {
  const log = opts.onProgress ?? ((m: string) => console.log(m));
  const tracks = opts.state.allTracks().filter(
    (t) => t.status === "downloaded" && t.file_path,
  );
  log(`organizing ${tracks.length} downloaded track(s)`);  let moved = 0;
  let skipped = 0;
  let missing = 0;

  for (const track of tracks) {
    const filePath = track.file_path;
    if (!filePath) continue;
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      missing++;
      log(`  ✗ missing on disk: ${filePath}`);
      continue;
    }

    let genre = track.genre ?? (await fileGenreTag(filePath)) ?? "Music";
    if (genre === "Music" && track.artist) {
      genre = "Music";
    }
    const folder = sanitizeGenreFolder(genre);    const fileName = filePath.split("/").pop() ?? `${track.video_id}.m4a`;
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

    await $`mkdir -p ${targetDir}`.quiet();
    // Never clobber: if the destination exists with different bytes it is a
    // different rip of the same track — keep both, disambiguate the name.
    if (await Bun.file(targetPath).exists()) {
      const ext = fileName.match(/(\.[^.]+)$/)?.[1] ?? "";
      const stem = ext ? fileName.slice(0, -ext.length) : fileName;
      const alt = `${targetDir}/${stem} [${track.video_id}]${ext}`;
      log(`  ⚠ destination exists — moving as ${stem} [${track.video_id}]${ext}`);
      await $`mv ${filePath} ${alt}`.quiet();
      opts.state.updateFilePath(track.video_id, alt);
      moved++;
      continue;
    }
    await $`mv ${filePath} ${targetPath}`.quiet();
    opts.state.updateFilePath(track.video_id, targetPath);
    moved++;
    log(`  → ${folder}/${fileName}`);
  }

  log(
    `\norganize complete: ${moved} moved, ${skipped} already organized, ${missing} missing`,
  );
}
