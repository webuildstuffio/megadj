/**
 * megadj sync — copy new music from the archive onto the shelf master
 * (and optionally the gig sticks), resumable and additive-only.
 *
 * The standing workflow after `megadj drop`: new tracks land in the archive
 * (~/Music/DJ-Imports), sync copies anything not already on the shelf
 * into Contents/<artist>/ (folder-per-artist, matching the drive layout),
 * then optionally mirrors to the master/mirror USBs. Never deletes — the
 * shelf is append-only; removal is a human decision.
 *
 * Roles come from config.toml ([library] shelf_drive/master_drive/
 * mirror_drive) with SHELF1/DJMASTER/DJMIRROR doc defaults; the sticks are
 * only touched when mounted, and each root is checked per-run.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { nameKey } from "../shared/name-key";
import { AUDIO_EXTS } from "../shared/audio-exts";
import { walkTree } from "../shared/walk-tree";
import { resolveShelfVolume } from "../shared/volume";
import { writeJson, setExit } from "../shared/cli-output";
import { errMessage as errorText } from "../shared/leaf/fmt";
import { md5Cli } from "./md5-cli";

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

/** walkArchive rides the shared walker (#69): dot-entries skipped, the
 * AUDIO_EXTS regex SSOT as the ext gate, soft-fail on unreadable
 * dirs. Plans are {src, rel, bytes} over the walker's entries. */
function walkArchive(root: string): CopyPlan[] {
  return walkTree(root, { exts: AUDIO_EXTS }).entries.map((e) => ({
    src: e.abs,
    rel: e.rel,
    bytes: e.bytes,
  }));
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

/** Shelf-sync's audio match — the repo-wide SSOT set
 *  (src/shared/audio-exts.ts, issue #69). The scanner sets derive from
 *  the same membership, so a copied file can never be invisible to
 *  hygiene/dedupe/dupescan (the ogg/opus drift this closes). */

/** Index of every audio file already on the shelf: basename → paths. A file
 *  counts as "already there" when ANY shelf copy of the same name has the
 *  same bytes — the shelf is artist-foldered while the archive keeps its
 *  batch folders, so the raw relative-path destination is only ONE of the
 *  places the file may legitimately live. Without this, a regrouped shelf
 *  re-copies the whole archive into dated folders (the Sep 11 discovery).
 *  Rides the shared walker (#69). */
function shelfAudioIndex(contents: string): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const e of walkTree(contents, { exts: AUDIO_EXTS }).entries) {
    // fskit exFAT hands back NFD; the archive side is NFC. Key the index
    // on the shared NFC+casefold name key (issue #67 SSOT) so Unicode
    // forms AND case variants can never split one file into two.
    const key = nameKey(basename(e.abs));
    const paths = idx.get(key) ?? [];
    paths.push(e.abs);
    idx.set(key, paths);
  }
  return idx;
}

/** Compare bytes before declaring a shelf copy already present. A same-size
 *  divergent rip must never be mistaken for the archive file. */
function sameBytes(a: string, b: string): boolean {
  try {
    if (statSync(a).size !== statSync(b).size) return false;
    const left = md5Cli(a);
    const right = md5Cli(b);
    return left !== null && left === right;
  } catch {
    return false;
  }
}

function divergentDestination(contents: string, rel: string): string {
  const artist = artistFolder(rel);
  const name = basename(rel);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 1;
  let candidate = join(contents, artist, `${stem} [archive]${ext}`);
  while (existsSync(candidate)) {
    i++;
    candidate = join(contents, artist, `${stem} [archive ${i}]${ext}`);
  }
  return candidate;
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
    let dest = join(contents, artistFolder(p.rel), basename(p.rel));
    const onShelfSomewhere = shelfIndex
      .get(nameKey(basename(p.rel)))
      ?.some((candidate) => sameBytes(p.src, candidate));
    if ((existsSync(dest) && sameBytes(p.src, dest)) || onShelfSomewhere) {
      res.skipped++;
      continue;
    }
    if (existsSync(dest)) dest = divergentDestination(contents, p.rel);
    if (!opts.dryRun) {
      try {
        mkdirSync(join(contents, artistFolder(p.rel)), { recursive: true });
        // copyFileSync (not Bun.write — its sync variant is fd-based) then a
        // size-check: a silent partial write must not read as done.
        copyFileSync(p.src, dest);
        if (!sameBytes(p.src, dest))
          throw new Error("byte mismatch after copy");
      } catch (e) {
        res.failed++;
        opts.log?.(`failed: ${p.rel} (${errorText(e)})`);
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
    shelfVolume = resolveShelfVolume(),
    stickVolumes = [],
    dryRun = false,
    json = false,
    log = (s) => console.log(s),
  } = opts;

  if (!existsSync(musicDir)) {
    if (json) await writeJson({ error: `archive dir missing: ${musicDir}` });
    else log(`sync: archive dir missing: ${musicDir}`);
    // #160 ring 3: setExit is the one mutation point.
    setExit(1);
    return;
  }

  const plans = walkArchive(musicDir);
  const results: VolumeResult[] = [
    syncToVolume(plans, shelfVolume, { dryRun, log }),
    ...stickVolumes.map((v) => syncToVolume(plans, v, { dryRun, log })),
  ];

  if (json) {
    await writeJson({
      command: "sync",
      archive: musicDir,
      tracked: plans.length,
      dry_run: dryRun,
      volumes: results,
      ok: results.every((r) => (r.mounted ? r.failed === 0 : true)),
    });
    return;
  }

  log(`sync: ${plans.length} archive tracks${dryRun ? " (dry run)" : ""}`);
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
