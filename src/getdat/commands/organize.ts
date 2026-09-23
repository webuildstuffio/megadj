/**
 * megadj organize — sweep loose root files into the dated downloads batch
 * and keep the state DB in sync. Sep 19 policy (user): downloads are
 * organized by BATCH (the intake convention), never by genre, and never
 * left loose at the archive root:
 *
 *   ~/Music/DJ-Imports/
 *     2026-09-19 soundcloud downloads/Track A.m4a
 *     2026-09-10 intake/Track B.aiff
 *     ...
 *
 * Files in any `<YYYY-MM-DD …>` batch folder are already home and stay
 * put. Unique rips are never deleted — merge only ever removes a
 * byte-identical duplicate COPY while at least one copy survives.
 */

import { $ } from "bun";
import { mkdirSync } from "node:fs";
import { basename } from "node:path";
import type { ArchiveState, TrackRow } from "../../core/state";
import { commandLog } from "../../shared/progress";
import { writeJson } from "../../shared/cli-output";
import { downloadBatchDir } from "./intake-folder";

export interface OrganizeOptions {
  state: ArchiveState;
  musicDir: string;
  dryRun?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean | undefined;
}

interface OrganizeCounters {
  moved: number;
  merged: number;
  skipped: number;
  missing: number;
  movedFailed: number;
  /** Rows whose file lives outside musicDir (shelf mirrors etc.) — not
   *  this command's scope, never a move candidate (Sep 19 audit). */
  outside: number;
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

/** Per-track: loose root files move into the dated batch folder; files in
 *  any batch folder stay put. Genre is NEVER the destination axis (Sep 19
 *  policy change — genre folders retired; the ledger still carries genre
 *  as metadata). */
async function organizeOne(
  opts: OrganizeOptions,
  log: (msg: string) => void,
  track: TrackRow,
  counters: OrganizeCounters,
): Promise<void> {
  const filePath = track.file_path;
  if (!filePath) return;
  // Scope guard (Sep 19 audit): organize owns the LOCAL music dir only.
  // Rows pointing at other volumes (shelf mirrors, intake dumps) are not
  // this command's business — counting them "missing" lied in every run's
  // summary (3,656 phantom-missing while every file sat safe on SHELF1).
  // Outside-scope is its own honest bucket, never a move candidate.
  if (!filePath.startsWith(`${opts.musicDir}/`)) {
    counters.outside++;
    return;
  }
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

  const fileName = filePath.split("/").pop() ?? `${track.video_id}.m4a`;
  // Batch folders (`<YYYY-MM-DD slug>/` — per-dump intake groups) are
  // already organized: the batch IS the organization. Nothing in one
  // ever moves — genre folders are retired as a destination.
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
  // A loose ROOT file: into the dated downloads batch (same-day re-runs
  // share the folder). Never genre, never left loose.
  const targetDir = downloadBatchDir(opts.musicDir, "organized");
  mkdirSync(targetDir, { recursive: true });
  const targetPath = `${targetDir}/${fileName}`;

  if (filePath === targetPath) {
    counters.skipped++;
    return;
  }

  if (opts.dryRun) {
    log(`  would move: ${fileName} → ${basename(targetDir)}/`);
    return;
  }

  // nothrow: an unwritable parent must skip the track, not crash the run.
  const mk = await $`mkdir -p ${targetDir}`.quiet().nothrow();
  if (mk.exitCode !== 0) {
    counters.movedFailed++;
    log(`  ✗ cannot create batch folder (skipping): ${filePath}`);
    return;
  }
  // Never clobber. F5 (postmortem): move-or-MERGE — when the destination
  // exists, byte-compare first:
  //   identical bytes  → merge: the rows repoint at ONE file, and the
  //                      duplicate COPY is removed (never the last copy —
  //                      "files never deleted" means every unique rip
  //                      survives, not that byte-twins multiply);
  //   different bytes  → a different rip of the same track: keep both,
  //                      disambiguate the name as before.
  // The old unconditional-rename behavior silently grew duplicate twins
  // and left the ledger pointing at whichever copy moved last.
  let dest = targetPath;
  if (await Bun.file(targetPath).exists()) {
    if (await filesIdentical(filePath, targetPath)) {
      if (opts.dryRun) {
        log(
          `  would merge (identical bytes): ${fileName} → ${basename(targetDir)}/`,
        );
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
      log(`  ⇉ merged into ${basename(targetDir)}/${basename(targetPath)}`);
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
  log(`  → ${basename(targetDir)}/${dest.split("/").pop()}`);
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
    outside: 0,
  };

  for (const track of tracks) {
    await organizeOne(opts, log, track, counters);
  }

  const { moved, merged, skipped, missing, movedFailed, outside } = counters;
  log(
    `\norganize complete: ${moved} moved, ${merged} merged, ${skipped} already organized, ${missing} missing${
      movedFailed > 0 ? `, ${movedFailed} move-failed` : ""
    }${outside > 0 ? `, ${outside} outside ${opts.musicDir} (skipped)` : ""}`,
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
      outsideScope: outside,
    });
  }
}
