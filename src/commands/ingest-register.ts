// ingest-register.ts — the archive-landing half of Phase D, extracted from
// ingest.ts at the complexity guard: copy-into-archive (never clobber,
// disambiguate inside the batch folder), the artwork queue fallback, and
// the DB registration. ingest.ts keeps the tag/art/energy pipeline; these
// helpers take narrow param objects (leaf seam — this module never imports
// ingest.ts, so madge sees no back-edge). NOTE: file order matters for
// lizard's TS parser (it merges adjacent functions when it loses brace
// track) — the helpers are ordered small → large so the report stays
// honest per function.
import { $ } from "bun";
import { createHash } from "node:crypto";
import { stat, copyFile, mkdir, rename } from "node:fs/promises";
import { join, basename } from "node:path";
import { sanitizeGenreFolder } from "../../fulltags/src/exports";
import type { Record_ } from "./ingest-probe";
import type { ArtworkOutcome } from "./ingest-art";
import type { QueueEntry } from "./queue";
import type { RemixInfo } from "../../fulltags/src/remix";

/** Per-run ingest tallies (the --json summary's counters). Defined HERE —
 *  the leaf seam shared with ingest.ts — so this module never imports its
 *  parent (madge counts a type-only back-edge as a cycle). */
export interface IngestCounters {
  tagged: number;
  artAdded: number;
  artQueued: number;
  artSkippedWav: number;
  shortSkipped: number;
  unchanged: number;
  wavConverted: number;
  /** Fleet-incompatible files refused at the gate (left in place). */
  compatRejected: number;
  /** Files that ingest but will NOT load on XDJ-XZ / CDJ-2000 (hi-res). */
  compatHires: number;
}

/** Narrow view of IngestOptions the landing helpers need. */
export interface IngestOptsLike {
  musicDir: string;
  noArtwork?: boolean | undefined;
  state: {
    updateArtworkStatus(extId: string, status: string): unknown;
    upsertTrackFromPlaylist(
      extId: string,
      idx: number,
      title: string,
      src: string,
    ): unknown;
    markDownloaded(extId: string, row: Record<string, unknown>): unknown;
    /** Existing downloaded row pointing at a path (upgrade replacement). */
    trackByFilePath(filePath: string): { video_id: string } | null;
  };
}

/** Inputs to the landing step (everything Phase D decided for one file). */
export interface RegisterArgs {
  file: string;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string;
  probe: Record_["probe"];
  energy: number | null;
  queuedIdentity: Set<string>;
  queueEntries: QueueEntry[];
  art: ArtworkOutcome;
  remixOf: RemixInfo | null;
}

/** The ext- id ingest registers rows under (stable per source path). */
export function extIdFor(file: string): string {
  return `ext-${createHash("sha1").update(file).digest("hex").slice(0, 12)}`;
}

/** The batch-layout destination: `<archive>/<batch>/<name>` for batch
 *  ingests, flat musicDir otherwise. */
export function destPathFor(
  musicDir: string,
  file: string,
  batchDir: string | null,
): string {
  // New layout: each ingest batch lands in its own subfolder
  // (`<archive>/<batch>` — see intake-folder.ts) so dumps never mix.
  return batchDir && !file.startsWith(batchDir + "/")
    ? join(batchDir, basename(file))
    : join(musicDir, basename(file));
}

/** True only for REAL archive members. Membership needs the separator:
 *  "/X/DJ-Imports-old/f" must NOT count as inside "/X/DJ-Imports" (bare
 *  startsWith treats siblings as members and then skips the copy). */
export function isInArchive(musicDir: string, file: string): boolean {
  return file === musicDir || file.startsWith(musicDir + "/");
}

/** Artwork queue fallback: when nothing could be fetched (bootlegs/
 *  edits rarely exist on iTunes), persist a queue entry so an agent
 *  can generate cover art later via the image-maker CLI. Written to
 *  ~/.local/state/megadj/artwork-queue.jsonl (one JSON per line). */
export function queueArtworkFallback(
  opts: IngestOptsLike,
  rec: Pick<Record_, "identity">,
  a: Pick<
    RegisterArgs,
    | "probe"
    | "art"
    | "queuedIdentity"
    | "queueEntries"
    | "title"
    | "artist"
    | "album"
    | "remixOf"
  >,
  extId: string,
  destPath: string,
  counters: IngestCounters,
): void {
  if (a.probe.hasArt || opts.noArtwork) return;
  if (a.art.skipped) {
    // format can't hold art — nothing to queue
  } else if (a.queuedIdentity.has(rec.identity)) {
    // already in queue from an earlier run/file
  } else {
    const entry: QueueEntry = a.art.failedUrl
      ? {
          path: destPath,
          title: a.title,
          artist: a.artist,
          album: a.album,
          reason: "embed-failed",
          sourceUrl: a.art.failedUrl,
        }
      : {
          path: destPath,
          title: a.title,
          artist: a.artist,
          album: a.album,
          reason: "no-source-found",
          remixOf: a.remixOf?.original ?? null,
        };
    a.queuedIdentity.add(rec.identity);
    a.queueEntries.push(entry);
    opts.state.updateArtworkStatus(extId, "queued");
    counters.artQueued++;
  }
}

/** Copy the file into the music dir (unless already there) and return the
 *  final archive path. Sources are moved (not copied) once the copy into
 *  the archive succeeds, so Downloads doesn't fill with duplicate copies. */
export async function copyIntoArchive(
  opts: IngestOptsLike,
  rec: Pick<Record_, "size">,
  a: Pick<RegisterArgs, "file">,
  destPath: string,
  inArchive: boolean,
  batchDir: string | null,
): Promise<string> {
  if (inArchive) return a.file;
  if (destPath === a.file) return destPath;
  await mkdir(batchDir ?? opts.musicDir, { recursive: true });
  const finalDest = await landingPath(opts, rec, a, destPath, batchDir);
  await copyFile(a.file, finalDest);
  // success: remove the source so nothing is left duplicated
  try {
    await rename(a.file, `${a.file}.ingested`);
    await $`rm -f ${`${a.file}.ingested`}`.quiet().nothrow();
  } catch {
    /* keep source if we can't even mark it — copy already succeeded */
  }
  return finalDest;
}

/** Collision rule: same name + different bytes disambiguates INSIDE the
 *  batch folder ("Name (ingest).ext") — a flat-musicDir fallback would mix
 *  batches again. Missing dest (ENOENT) is the normal first-ingest path. */
async function landingPath(
  opts: IngestOptsLike,
  rec: Pick<Record_, "size">,
  a: Pick<RegisterArgs, "file">,
  destPath: string,
  batchDir: string | null,
): Promise<string> {
  try {
    const destStat = await stat(destPath);
    if (destStat.size === rec.size) return destPath;
    const fallbackDir = batchDir ?? opts.musicDir;
    return join(
      fallbackDir,
      basename(a.file).replace(/(\.[^.]+)$/, " (ingest)$1"),
    );
  } catch {
    return destPath; /* dest missing — normal path */
  }
}

/** Register in the DB + move into the music dir (unless already there). */
export async function registerAndMove(
  opts: IngestOptsLike,
  rec: Record_,
  a: RegisterArgs,
  counters: IngestCounters,
  batchDir: string | null,
): Promise<void> {
  // UPGRADE REPLACEMENT (Sep 11 2026): when a quality upgrade lands on a
  // file path that is already registered (self-ingest of the archive), the
  // path-keyed ext- id would insert a SHADOW row next to the existing one —
  // same file, two rows, the old one keeping all beats/mood/cues history
  // while list/DB views see doubles. Reuse the existing row's id instead:
  // markDownloaded then overwrites it in place and the ledger survives.
  const existingRow = opts.state.trackByFilePath(
    // match against the FINAL path (this file already lives in the archive
    // on the self-ingest path; a fresh copy registers its own new row).
    isInArchive(opts.musicDir, a.file) ? a.file : "",
  );
  const extId = existingRow?.video_id ?? extIdFor(a.file);
  const inArchive = isInArchive(opts.musicDir, a.file);
  let destPath = destPathFor(opts.musicDir, a.file, batchDir);
  destPath = await copyIntoArchive(opts, rec, a, destPath, inArchive, batchDir);
  opts.state.upsertTrackFromPlaylist(extId, 0, a.title, "ingest");
  opts.state.markDownloaded(extId, {
    title: a.title,
    artist: a.artist,
    album: a.album,
    genre: sanitizeGenreFolder(a.genre),
    formatId: null,
    bitrateKbps: a.probe.bitrateKbps,
    codec: a.probe.codec,
    filePath: destPath,
    fileSizeBytes: rec.size,
    durationS: a.probe.durationS,
    energy: a.energy,
  });
  queueArtworkFallback(opts, rec, a, extId, destPath, counters);
}
