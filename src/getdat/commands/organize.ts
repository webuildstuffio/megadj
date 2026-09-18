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
import { basename } from "node:path";
import type { ArchiveState, TrackRow } from "../../archive/state";
import { commandLog } from "../../progress";
import { writeJson } from "../../shared/cli-output";
import { sanitizeGenreFolder } from "../../fulltags/write/schema";

export interface OrganizeOptions {
  state: ArchiveState;
  musicDir: string;
  dryRun?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean | undefined;
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

interface OrganizeCounters {
  moved: number;
  merged: number;
  skipped: number;
  missing: number;
  movedFailed: number;
}

/** Byte-identical check for the F5 merge path: size first (cheap), then
 *  MD5 — only called on a destination-exists collision. */
async function filesIdentical(a: string, b: string): Promise<boolean> {
  const fa = Bun.file(a);
  const fb = Bun.file(b);
  if (fa.size !== fb.size) return false;
  const hasherA = new Bun.CryptoHasher("md5");
  const hasherB = new Bun.CryptoHasher("md5");
  hasherA.update(await fa.bytes());
  hasherB.update(await fb.bytes());
  return hasherA.digest("hex") === hasherB.digest("hex");
}

/** Per-track: resolve destination from genre, move without clobbering, and
 *  only record the move when it actually happened. Returns true when the
 *  file moved (caller counts it). */
async function organizeOne(
  opts: OrganizeOptions,
  log: (msg: string) => void,
  track: TrackRow,
  counters: OrganizeCounters,
): Promise<void> {
  const filePath = track.file_path;
  if (!filePath) return;
  // F5 stray rule: existence checks are CASE-INSENSITIVE in effect — on a
  // case-insensitive volume a case-variant spelling of the row's path
  // IS the same file. `Bun.file(p).exists()` already resolves that way
  // on macOS, but the old code then used the ROW's spelling for every
  // later move/hash, so a rescue-imported row pointing at `Track A.wav`
  // while the disk holds `track a.wav` hashed and moved fine — the bug
  // was sweeps comparing strings, not this resolver. Keep the resolved
  // (actual) spelling authoritative for everything below.
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    counters.missing++;
    log(`  ✗ missing on disk: ${filePath}`);
    return;
  }

  // Fallback to the literal "Music" placeholder is gone (#61): organize is
  // a MOVES command — a wrong bucket is damage, an "Unknown Genre" folder
  // (sanitizeGenreFolder already maps null through safely) is recoverable.
  const genre = track.genre ?? (await fileGenreTag(filePath));
  const folder = sanitizeGenreFolder(genre);
  const fileName = filePath.split("/").pop() ?? `${track.video_id}.m4a`;
  // Batch folders (`<YYYY-MM-DD slug>/` — per-dump intake groups) are
  // already organized: moving their files into genre folders would destroy
  // the per-dump grouping the archive layout is built around. Only loose
  // root files get genre-foldered.
  const firstSegment = filePath.startsWith(`${opts.musicDir}/`)
    ? (filePath.slice(opts.musicDir.length + 1).split("/")[0] ?? "")
    : "";
  if (/^\d{4}-\d{2}-\d{2} /.test(firstSegment)) {
    counters.skipped++;
    log(
      `  = in batch folder (kept): ${filePath.slice(opts.musicDir.length + 1)}`,
    );
    return;
  }
  const targetDir = `${opts.musicDir}/${folder}`;
  const targetPath = `${targetDir}/${fileName}`;

  if (filePath === targetPath) {
    counters.skipped++;
    return;
  }

  if (opts.dryRun) {
    log(`  would move: ${fileName} → ${folder}/`);
    return;
  }

  // nothrow: an unwritable parent must skip the track, not crash the run.
  const mk = await $`mkdir -p ${targetDir}`.quiet().nothrow();
  if (mk.exitCode !== 0) {
    counters.movedFailed++;
    log(`  ✗ cannot create ${folder}/ (skipping): ${filePath}`);
    return;
  }
  // Never clobber. F5 (postmortem): move-or-MERGE — when the destination
  // exists, byte-compare first:
  //   identical bytes  → merge: drop the source duplicate, keep the
  //                      destination row (the case-variant twin class),
  //                      repoint THIS row at the destination;
  //   different bytes  → a different rip of the same track: keep both,
  //                      disambiguate the name as before.
  // The old unconditional-rename behavior silently grew duplicate twins
  // and left the ledger pointing at whichever copy moved last.
  let dest = targetPath;
  if (await Bun.file(targetPath).exists()) {
    if (await filesIdentical(filePath, targetPath)) {
      if (opts.dryRun) {
        log(`  would merge (identical bytes): ${fileName} → ${folder}/`);
        return;
      }
      const rm = await $`rm ${filePath}`.quiet().nothrow();
      if (rm.exitCode !== 0) {
        counters.movedFailed++;
        log(`  ✗ merge failed (could not remove source): ${filePath}`);
        return;
      }
      opts.state.updateFilePath(track.video_id, targetPath);
      counters.merged++;
      log(`  ⇉ merged into ${folder}/${basename(targetPath)}`);
      return;
    }
    const ext = fileName.match(/(\.[^.]+)$/)?.[1] ?? "";
    const stem = ext ? fileName.slice(0, -ext.length) : fileName;
    dest = `${targetDir}/${stem} [${track.video_id}]${ext}`;
    log(
      `  ⚠ destination exists (different bytes) — moving as ${stem} [${track.video_id}]${ext}`,
    );
  }
  // Only record the move when it actually happened. The old quiet+nothrow
  // `mv` updated file_path unconditionally, so a failed move (EXDEV, disk
  // full, permissions) left the DB pointing at a file that never existed —
  // and every later pass treated the phantom path as ground truth.
  const mv = await $`mv ${filePath} ${dest}`.quiet().nothrow();
  if (mv.exitCode !== 0) {
    counters.movedFailed++;
    log(`  ✗ move failed (DB unchanged): ${filePath}`);
    return;
  }
  opts.state.updateFilePath(track.video_id, dest);
  counters.moved++;
  log(`  → ${folder}/${dest.split("/").pop()}`);
}

export async function organize(opts: OrganizeOptions): Promise<void> {
  const log = commandLog(opts);
  const tracks = opts.state.downloadedWithFiles();
  log(`organizing ${tracks.length} downloaded track(s)`);
  const counters: OrganizeCounters = {
    moved: 0,
    merged: 0,
    skipped: 0,
    missing: 0,
    movedFailed: 0,
  };

  for (const track of tracks) {
    await organizeOne(opts, log, track, counters);
  }

  const { moved, merged, skipped, missing, movedFailed } = counters;
  log(
    `\norganize complete: ${moved} moved, ${merged} merged, ${skipped} already organized, ${missing} missing${
      movedFailed > 0 ? `, ${movedFailed} move-failed` : ""
    }`,
  );
  if (opts.json) {
    // P1 (--json on every command): one summary object on stdout, last.
    await writeJson({
      command: "organize",
      dryRun: opts.dryRun ?? false,
      considered: tracks.length,
      moved,
      merged,
      alreadyOrganized: skipped,
      missing,
      moveFailed: movedFailed,
    });
  }
}
