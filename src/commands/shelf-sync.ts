/**
 * megadj shelf-sync — copy new music from the archive onto the shelf master
 * (and optionally the gig sticks), resumable and additive-only.
 *
 * The standing workflow after `megadj drop`: new tracks land in the archive
 * (~/Music/DJ-Imports), shelf-sync copies anything not already on the shelf
 * into Contents/<artist>/ (folder-per-artist, matching the drive layout),
 * then optionally mirrors to the master/mirror USBs. Never deletes — the
 * shelf is append-only; removal is a human decision.
 *
 * Roles come from config.toml ([library] shelf_drive/master_drive/
 * mirror_drive) with SHELF1/DJMASTER/DJMIRROR doc defaults; the sticks are
 * only touched when mounted, and each root is checked per-run.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, join, relative } from "node:path";

export interface ShelfSyncOptions {
  /** Archive root — new music lands here (megadj drop / organize output). */
  musicDir: string;
  /** Shelf master mount root (volume), e.g. /Volumes/SHELF1. */
  shelfVolume?: string;
  /** Extra targets to mirror to after the shelf (mounted sticks). */
  stickVolumes?: string[];
  dryRun?: boolean;
  json?: boolean;
  log?: (s: string) => void;
}

interface CopyPlan {
  src: string;
  /** Path relative to the archive root — also the layout under Contents/. */
  rel: string;
  bytes: number;
}

interface VolumeResult {
  volume: string;
  mounted: boolean;
  copied: number;
  skipped: number;
  bytes: number;
  failed: number;
}

/** Top-level artist folder for a file: "Artist/album/track.mp3" → "Artist".
 *  Files already at the archive root go to a "[unknown]" folder on the shelf
 *  so Contents/ never fills with loose files. */
function artistFolder(rel: string): string {
  const parts = rel.split("/");
  return (parts[0] ?? "") !== "" && parts.length > 1
    ? (parts[0] as string)
    : "[unknown]";
}

/** Index of every audio file already on the shelf: basename → sizes. A file
 *  counts as "already there" when ANY shelf copy of the same name has the
 *  same size — the shelf is artist-foldered while the archive keeps its
 *  batch folders, so the raw relative-path destination is only ONE of the
 *  places the file may legitimately live. Without this, a regrouped shelf
 *  re-copies the whole archive into dated folders (the Sep 11 discovery). */
function shelfAudioIndex(contents: string): Map<string, number[]> {
  const AudioRe = /\.(mp3|m4a|wav|aiff?|flac|ogg|opus)$/i;
  const idx = new Map<string, number[]>();
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable subtree — skip, never crash the sync
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "$RECYCLE.BIN") continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (AudioRe.test(entry.name)) {
        // fskit exFAT hands back NFD; the archive side is NFC. Key the index
        // on NFC so the Unicode forms can never split one file into two.
        const key = entry.name.normalize("NFC");
        const sizes = idx.get(key) ?? [];
        try {
          sizes.push(statSync(abs).size);
        } catch {
          // vanished mid-walk — skip this entry
        }
        idx.set(key, sizes);
      }
    }
  };
  walk(contents);
  return idx;
}

/** Byte-size equality pre-check: same size = "already there". Checksums are
 *  the real truth (checksum jobs audit that); this keeps the walk fast. */
function sameSize(a: string, b: string): boolean {
  try {
    return statSync(a).size === statSync(b).size;
  } catch {
    return false;
  }
}

/** Every audio file under root, as CopyPlan relative paths. */
function walkArchive(root: string): CopyPlan[] {
  const out: CopyPlan[] = [];
  const AudioRe = /\.(mp3|m4a|wav|aiff?|flac|ogg|opus)$/i;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "$RECYCLE.BIN") continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (AudioRe.test(entry.name))
        out.push({
          src: abs,
          rel: relative(root, abs),
          bytes: statSync(abs).size,
        });
    }
  };
  walk(root);
  return out;
}

/** Copy plan → one volume. Returns per-volume counters for the summary. */
function syncToVolume(
  plans: CopyPlan[],
  volume: string,
  opts: { dryRun?: boolean; log?: (s: string) => void },
): VolumeResult {
  const contents = join(volume, "Contents");
  const res: VolumeResult = {
    volume,
    mounted: existsSync(volume),
    copied: 0,
    skipped: 0,
    bytes: 0,
    failed: 0,
  };
  if (!res.mounted) return res;
  const shelfIndex = shelfAudioIndex(contents);
  for (const p of plans) {
    const dest = join(contents, artistFolder(p.rel), basename(p.rel));
    const onShelfSomewhere = shelfIndex
      .get(basename(p.rel).normalize("NFC"))
      ?.includes(p.bytes);
    if (
      (existsSync(dest) && sameSize(p.src, dest)) ||
      (onShelfSomewhere && !existsSync(dest))
    ) {
      res.skipped++;
      continue;
    }
    if (!opts.dryRun) {
      try {
        mkdirSync(join(contents, artistFolder(p.rel)), { recursive: true });
        // copyFileSync (not Bun.write — its sync variant is fd-based) then a
        // size-check: a silent partial write must not read as done.
        copyFileSync(p.src, dest);
        if (!sameSize(p.src, dest)) throw new Error("size mismatch after copy");
      } catch (e) {
        res.failed++;
        opts.log?.(`failed: ${p.rel} (${e instanceof Error ? e.message : e})`);
        continue;
      }
    }
    res.copied++;
    res.bytes += p.bytes;
  }
  return res;
}

export async function shelfSync(opts: ShelfSyncOptions): Promise<void> {
  const {
    musicDir,
    shelfVolume = "/Volumes/SHELF1",
    stickVolumes = [],
    dryRun = false,
    json = false,
    log = (s) => console.log(s),
  } = opts;

  if (!existsSync(musicDir)) {
    if (json)
      console.log(
        JSON.stringify({ error: `archive dir missing: ${musicDir}` }),
      );
    else log(`shelf-sync: archive dir missing: ${musicDir}`);
    process.exitCode = 1;
    return;
  }

  const plans = walkArchive(musicDir);
  const results: VolumeResult[] = [
    syncToVolume(plans, shelfVolume, { dryRun, log }),
    ...stickVolumes.map((v) => syncToVolume(plans, v, { dryRun, log })),
  ];

  if (json) {
    console.log(
      JSON.stringify(
        {
          command: "shelf-sync",
          archive: musicDir,
          tracked: plans.length,
          dry_run: dryRun,
          volumes: results,
          ok: results.every((r) => (r.mounted ? r.failed === 0 : true)),
        },
        null,
        2,
      ),
    );
    return;
  }

  log(
    `shelf-sync: ${plans.length} archive tracks${dryRun ? " (dry run)" : ""}`,
  );
  for (const r of results) {
    if (!r.mounted) {
      log(`  ${r.volume}: not mounted — skipped`);
      continue;
    }
    log(
      `  ${r.volume}: ${dryRun ? "would copy" : "copied"} ${r.copied}, already there ${r.skipped}${r.failed ? `, FAILED ${r.failed}` : ""}`,
    );
  }
}
