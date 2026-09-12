/**
 * megadj adopt — register existing audio files into the state database
 * without re-downloading. Matches by fuzzy title against the current
 * playlist snapshot. Intended for bootstrapping an archive that predates
 * the tool.
 */

import type { Dirent, Stats } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { walkAudioFiles, groundTruth } from "../../../fulltags/src/exports";
import { normalize } from "../../../fulltags/src/identity";
import type { ArchiveState } from "../../archive/state";
import { commandLog } from "../../progress";
import { resolveShelfVolume } from "../../shared/volume";

export interface AdoptOptions {
  state: ArchiveState;
  musicDir: string;
  onProgress?: (msg: string) => void;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean;
  /** Repoint downloaded rows whose local file is gone at their shelf copy
   *  (NFC+casefold basename match under <shelf>/Contents/). Dry-run by
   *  default; the shelf is never written. */
  shelf?: boolean;
  /** Shelf volume root override (doc default SHELF1; config/env win). */
  shelfVolume?: string;
  /** No-op preview for --shelf mode (plain adopt is always a no-op for
   *  pending rows, so it never needed one). */
  dryRun?: boolean;
}

/** Audio files under the archive (the tree has genre subfolders) — shared
 * FullTags walker, filtered to .m4a for the YouTube-intake format. Sync
 * walk is fine here: adopt is a short CLI pass. */
function walkM4a(dir: string): string[] {
  return walkAudioFiles(dir).filter((f) => f.toLowerCase().endsWith(".m4a"));
}

/** NFC+casefold basename index of every audio file under `<shelf>/Contents/`.
 * Walks the real filesystem (not the rekordbox library) so files not yet
 * imported into master.db still match. `PIONEER/` lives outside Contents/
 * and is never walked. */
function shelfNameIndex(contentsDir: string): Map<string, string> {
  const index = new Map<string, string>();
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable subtree — skip, never crash the pass
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        const key = `${ent.name.normalize("NFC").toLowerCase()}`;
        // First hit wins; genuine name twins on the shelf are handled by
        // shelf-dupescan, not by guessing here.
        if (!index.has(key)) index.set(key, full);
      }
    }
  };
  walk(contentsDir);
  return index;
}

/** adopt --shelf: heal downloaded rows whose local file vanished (folder
 * reorgs, disk cleanup) by repointing file_path at the copy on the shelf
 * master. Additive and reversible — the DB row is the only thing written;
 * files never move and the shelf never changes. */
export async function adoptFromShelf(opts: AdoptOptions): Promise<void> {
  const log = commandLog(opts);
  const shelfRoot = resolveShelfVolume(opts.shelfVolume);
  const contentsDir = join(shelfRoot, "Contents");
  const index = shelfNameIndex(contentsDir);
  log(`shelf ${shelfRoot}: ${index.size} file(s) under Contents/ indexed`);

  const stale = opts.state
    .allTracks()
    .filter(
      (t) =>
        t.status === "downloaded" &&
        typeof t.file_path === "string" &&
        t.file_path.length > 0,
    );
  let repointed = 0;
  let stillLocal = 0;
  let nowhere = 0;
  for (const t of stale) {
    const path = t.file_path as string;
    let exists = false;
    try {
      exists = statSync(path).isFile();
    } catch {
      exists = false;
    }
    if (exists) {
      stillLocal++;
      continue; // healthy row — never touched
    }
    const shelfPath = index.get(basename(path).normalize("NFC").toLowerCase());
    if (!shelfPath) {
      nowhere++;
      log(`  ✗ no shelf copy: ${basename(path)}`);
      continue;
    }
    if (opts.dryRun) {
      repointed++;
      log(`  would repoint: ${basename(path)} → shelf`);
      continue;
    }
    opts.state.updateFilePath(t.video_id, shelfPath);
    // The TKEY cache is keyed by source path; a moved file's key is still
    // valid (same bytes, mtime preserved by the move), so migrate the row
    // instead of paying a fresh ffprobe+mutagen read per track.
    opts.state.relabelKeySource(t.video_id, path, shelfPath);
    repointed++;
    log(`  → repointed: ${basename(path)}`);
  }

  log(
    `\n${repointed} row(s) ${opts.dryRun ? "would be repointed" : "repointed"} ` +
      `to the shelf; ${stillLocal} still local; ${nowhere} nowhere`,
  );

  // Heal the TKEY read-cache in the same pass (skipped on dry-run): rows
  // whose key was never cached (or invalidated by the repoint) cost one
  // ffprobe+mutagen read PER set-builder/rb-playlist invocation. Reading
  // the key once here is the difference between a 1s and a 6min build.
  // Fresh rows, not `stale`: the repoint loop just CHANGED file_path and
  // the cache source_path — healing against the captured snapshot would
  // re-read the old path and clobber the migrated row (PK = video_id).
  let keysCached = 0;
  if (!opts.dryRun) {
    const fresh = opts.state.allTracks();
    for (const t of fresh) {
      if (t.status !== "downloaded") continue;
      const path = t.file_path;
      if (typeof path !== "string" || path.length === 0) continue;
      if (opts.state.keyRecord(t.video_id, path) !== null) continue;
      try {
        const key = groundTruth(path).key;
        opts.state.setKeyRecord({
          videoId: t.video_id,
          key: key ?? "",
          sourcePath: path,
        });
        keysCached++;
      } catch {
        // unreadable/unsupported file — leave uncached, it is retried on
        // the next pass but never blocks this one (per-file isolation)
      }
    }
    log(`keys cached: ${keysCached}`);
  }
  if (opts.json) {
    console.log(
      JSON.stringify({
        command: "adopt",
        mode: "shelf",
        shelf: shelfRoot,
        inspected: stale.length,
        repointed,
        still_local: stillLocal,
        nowhere,
        keys_cached: keysCached,
        dry_run: opts.dryRun === true,
        ok: true,
      }),
    );
  }
}

export async function adopt(opts: AdoptOptions): Promise<void> {
  const log = commandLog(opts);
  const files = walkM4a(opts.musicDir);
  log(`found ${files.length} audio files under ${opts.musicDir}`);

  const tracks = opts.state.allTracks();
  // Build a lookup of normalized title -> track row. Prefer entries that
  // are not already marked downloaded.
  const byTitle = new Map<string, (typeof tracks)[number]>();
  for (const t of tracks) {
    if (t.status === "downloaded" || !t.title) continue;
    byTitle.set(normalize(t.title), t);
  }

  let adopted = 0;
  let vanished = 0;
  for (const file of files) {
    const base =
      file
        .replace(/\.m4a$/, "")
        .split("/")
        .pop() ?? file;
    const key = normalize(base);
    const match = byTitle.get(key);
    if (!match) continue;
    // A file can vanish between the directory walk and this stat (cleanup,
    // another agent, a moving tree). Skipping one file beats crashing the
    // whole adoption pass — same hardening `sync` got for its byte counter.
    let stat: Stats;
    try {
      stat = await Bun.file(file).stat();
    } catch {
      vanished++;
      log(`  ✗ vanished mid-scan, skipped: ${base}`);
      continue;
    }
    opts.state.markDownloaded(match.video_id, {
      title: match.title,
      artist: match.artist,
      album: match.album,
      formatId: null,
      bitrateKbps: null,
      codec: "aac",
      filePath: file,
      fileSizeBytes: stat.size,
      durationS: null,
    });
    byTitle.delete(key);
    adopted++;
    log(`  adopted: ${base}`);
  }

  log(
    `\nadopted ${adopted} file(s); ${files.length - adopted} unmatched (left pending or already tracked)${
      vanished > 0 ? `, ${vanished} vanished` : ""
    }`,
  );
  if (opts.json) {
    // P1 (--json on every command): one summary object on stdout, last.
    console.log(
      JSON.stringify({
        command: "adopt",
        scanned: files.length,
        adopted,
        unmatched: files.length - adopted,
        vanished,
      }),
    );
  }
}
