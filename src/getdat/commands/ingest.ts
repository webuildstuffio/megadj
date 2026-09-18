/**
 * megadj ingest — bring external downloads (Bandcamp rips, DJ edits, friends'
 * folders, loose mp3s/wavs) into the archive with complete tags + embedded
 * artwork, ready for rekordbox. The scripted equivalent of a Picard pass:
 *
 *  1. Probe every file (broken/zero-byte files are reported, never moved).
 *  2. Dedupe: within the folder AND against the archive — highest quality
 *     wins (lossless > bitrate), losers are quarantined, never deleted.
 *  3. Merge existing tags with `Artist - Title` filename parsing; missing
 *     artist/album/date get filled from MusicBrainz (1 rps, polite).
 *  4. Artwork: embedded art wins; else SoundCloud (URL found in tags → page
 *     og:image); else iTunes Search; else queued for AI generation.
 *     WAVs are converted to AIFF first (rekordbox can't read WAV art).
 *  5. Tagged files are copied into the music dir (sources never touched) and
 *     registered in the state DB so `organize` / USB sync pick them up.
 *
 * Split per concern (#88 item 3): probe (Phase A) lives in
 * ingest-probe-files.ts, the dedupe passes (Phases B/C) in
 * ingest-dedupe.ts, the run report + --json payload in ingest-report.ts —
 * this file is the per-track Phase D work and the phase orchestration.
 */

import { basename, join } from "node:path";
import { intakeFolderName, resolveIntakeDir } from "./intake-folder";
import type { ArchiveState } from "../../archive/state";
import { commandLog } from "../../shared/progress";
import { applyTags } from "../../fulltags/write/writer";
import { detectRemix } from "../../fulltags/sources/remix";
import {
  energyFromLufs,
  firstTag,
  measureRms,
} from "../../fulltags/media-probe";
import { walkAudio, type Record_ } from "./ingest-probe";
import {
  expandZips,
  deleteFullyIngestedZips,
  pendingZipDeletes,
} from "./ingest-zips";
import {
  gateDuration,
  gateWavConversion,
  gatePlayerCompat,
  gateMbFill,
  type IngestGateCtx,
} from "./ingest-one-stages";
import {
  fetchAndEmbedArtwork,
  flushArtworkQueue,
  type ArtworkOutcome,
} from "./ingest-art";
import type { QueueEntry } from "./queue";
// copyIntoArchive / queueArtworkFallback / registerAndMove (the archive-
// landing half of Phase D) live in ingest-register.ts with narrow param
// types — this module never imported back keeps madge at zero cycles.
// IngestCounters is also DEFINED there (the leaf seam shared with the
// landing helpers).
import { registerAndMove, type IngestCounters } from "./ingest-register";
import { probeAllFiles } from "./ingest-probe-files";
import { dedupeWithinFolder, dedupeAgainstArchive } from "./ingest-dedupe";
import { emitIngestReport, type IngestRunStats } from "./ingest-report";

/** The Phase-B test seam lives in ingest-pair.ts (#211 — test-only export
 *  out of the command body); re-exported for the existing test import. */
export { dedupeWithinFolderForTest } from "./ingest-pair";

export interface IngestOptions {
  state: ArchiveState;
  musicDir: string;
  folder: string;
  dryRun?: boolean | undefined;
  noArtwork?: boolean | undefined;
  quarantineDir?: string | undefined;
  /** Tracks shorter than this many seconds are skipped (default 60). */
  minDuration?: number | undefined;
  onProgress?: ((msg: string) => void) | undefined;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean | undefined;
  /** Clock override for the dated intake-folder name (tests pin it so a
   * suite that straddles UTC midnight cannot fork a "-2" batch folder). */
  now?: Date | undefined;
}

function newCounters(): IngestCounters {
  return {
    tagged: 0,
    artAdded: 0,
    artQueued: 0,
    artSkippedWav: 0,
    shortSkipped: 0,
    unchanged: 0,
    wavConverted: 0,
    compatRejected: 0,
    compatHires: 0,
    writeFailed: 0,
  };
}

/** Phase D per-track work: tag + artwork + register + move into the archive.
 *  The early gates (duration / wav→aiff / player-compat / MB fill) live in
 *  ingest-one-stages.ts (#88 item 1); this body is the sequencer + the
 *  tag-write tail it feeds. */
async function ingestOne(
  opts: IngestOptions,
  log: (msg: string) => void,
  rec: Record_,
  counters: IngestCounters,
  minDuration: number,
  queuedIdentity: Set<string>,
  queueEntries: QueueEntry[],
  batchDir: string | null,
): Promise<void> {
  let { file, probe } = rec;
  const { parsed } = rec;
  const title = firstTag(probe.tags, ["title"]) || parsed.title;
  const ctx: IngestGateCtx = {
    opts,
    log,
    rec,
    counters,
    minDuration,
    title,
    artist: firstTag(probe.tags, ["artist"]) || parsed.artist,
    album: firstTag(probe.tags, ["album"]),
    date: firstTag(probe.tags, ["date", "year"]),
    genre: firstTag(probe.tags, ["genre"]),
    mbidUsed: firstTag(probe.tags, ["musicbrainz_trackid"]) ?? null,
    remixOf: detectRemix(parsed.title),
    bootleg: /\b(bootleg|unofficial|unreleased)\b/i.test(parsed.title),
    proceed: true,
  };

  // ---- gates (each may reject; order matters) ----
  // Duration gate: tracks under 60s are not DJ material (usually clips,
  // ringtones, ads, or corrupted extractions). Still registered in the
  // DB (status skipped_short) so they show up in `megadj list` — but
  // never copied to the music dir or tagged. Override: --min-duration 0.
  gateDuration(ctx);
  if (!ctx.proceed) return;

  // WAV → AIFF lossless conversion (stream copy, tags ride along).
  // rekordbox cannot read embedded art from WAVs; AIFF is bit-identical
  // audio with native art support. See docs/fulltags/rekordbox-wav-artwork.md.
  await gateWavConversion(ctx);
  file = rec.file;
  probe = rec.probe;

  // Player-compat gate — the file must PLAY on the whole booth fleet
  // (XDJ-XZ / CDJ-3000 / CDJ-2000NXS2 / CDJ-2000). See
  // fulltags/src/player-compat.ts for the spec table this enforces.
  // Checked AFTER wav→aiff so a 96kHz WAV becomes a compliant 96kHz AIFF
  // verdict on the same probe it will register with.
  gatePlayerCompat(ctx);
  if (!ctx.proceed) return;

  // MB fill + genre normalize (no "Music" mint, #61).
  await gateMbFill(ctx);
  const { artist, date, genre, mbidUsed } = ctx;
  let { album } = ctx;
  const remixOf = ctx.remixOf;
  const bootleg = ctx.bootleg;
  const changes: string[] = [];
  if (firstTag(probe.tags, ["title"]) !== title) changes.push("title");
  if (artist && firstTag(probe.tags, ["artist"]) !== artist)
    changes.push("artist");
  if (album && firstTag(probe.tags, ["album"]) !== album) changes.push("album");
  if (date && firstTag(probe.tags, ["date", "year"]) !== date)
    changes.push("date");
  if (genre && firstTag(probe.tags, ["genre"]) !== genre)
    changes.push(`genre=${genre}`);

  // Bootleg-aware tagging: for remixes/edits/flips, ID3v2.3/MP4 have a
  // dedicated remix field ("version" → shows as "remixer" in rekordbox
  // and most DJ software), and the album goes to a single-work bucket so
  // cover-art and library grouping stay clean. originalArtist keeps the
  // original credited artist (TXXX/©art) without wrecking the artist field.
  const extraMeta: Record<string, string> = {};
  if (remixOf) {
    extraMeta.version = remixOf.remixName;
    extraMeta.originalArtist = remixOf.originalArtist;
    extraMeta.remixer = remixOf.remixer;
    if (!album)
      album = `${remixOf.originalArtist} — ${remixOf.track} (Remixes)`;
  }
  if (bootleg && !album) {
    album = `${artist ?? "Unknown"} — Bootlegs & Edits`;
  }
  if (probe.tags["album_artist"] || probe.tags["albumartist"]) {
    const aa = probe.tags["album_artist"] ?? probe.tags["albumartist"];
    if (aa) extraMeta.albumArtist = aa;
  }
  // DJ organization hints: grouping + movement carry the subgenre/style
  // string (rekordbox reads grouping; Serato/MusicBee read both).
  if (genre && genre !== "Music") extraMeta.grouping = genre;

  if (
    !opts.dryRun &&
    (changes.length > 0 || Object.keys(extraMeta).length > 0)
  ) {
    await applyTags(file, {
      title,
      artist,
      albumArtist: extraMeta.albumArtist ?? (artist && album ? artist : null),
      album,
      genre,
      date,
      composer: extraMeta.originalArtist ?? null,
      comment: firstTag(probe.tags, ["comment"]),
      bpm: null,
      grouping: extraMeta.grouping ?? null,
      remixer: extraMeta.remixer ?? null,
      mbid: mbidUsed,
    });
    counters.tagged++;
  }

  // Energy rating (1-10): decode + RMS, ~0.5-2s per file. First pass only —
  // stored in the DB, never recomputed on re-ingest (archive dupe check
  // short-circuits before this).
  const energy = opts.dryRun ? null : energyFromLufs(await measureRms(file));

  // Artwork: embedded → SoundCloud (URL in tags) → iTunes → AI queue.
  // AIFF/MP3/M4A/FLAC embed natively; WAV rarely reaches here because
  // ingest converts to AIFF first (art rides along via mutagen).
  let art: ArtworkOutcome = {
    source: null,
    failedUrl: null,
    queued: false,
    skipped: false,
  };
  if (!probe.hasArt && !opts.noArtwork && artist) {
    art = await fetchAndEmbedArtwork(file, {
      tags: probe.tags,
      hasArt: probe.hasArt,
      noArtwork: opts.noArtwork,
      artist,
      album,
      title,
      dryRun: opts.dryRun,
    });
    if (art.skipped) {
      counters.artSkippedWav++;
    } else if (art.source) {
      counters.artAdded++;
      changes.push("artwork");
    }
  }

  if (changes.length === 0) {
    counters.unchanged++;
    log(`  = ok: ${basename(file)}`);
  } else {
    log(`  ~ ${basename(file)}: ${changes.join(", ")}`);
  }

  if (opts.dryRun) return;

  await registerAndMove(
    opts,
    rec,
    {
      file,
      title,
      artist,
      album,
      genre,
      probe,
      energy,
      queuedIdentity,
      queueEntries,
      art,
      remixOf,
    },
    counters,
    batchDir,
  );
}

export async function ingest(opts: IngestOptions): Promise<void> {
  const log = commandLog(opts);
  // Quarantine lives at the ARCHIVE ROOT as a dot-folder (Sep 10 2026:
  // user request — "people will drag that folder", so a visible
  // `ingest-duplicates/` INSIDE the batch folder risks its rejects being
  // re-imported by a later folder drag). Dot-prefix → every walker (and
  // Finder) skips it; archive-root → never travels with a batch folder.
  const quarantineDir =
    opts.quarantineDir ?? join(opts.musicDir, ".ingest-duplicates");
  const minDuration = opts.minDuration ?? 60;
  const queuedIdentity = new Set<string>();
  // Per-batch destination folder: this run's imports land in
  // `<archive>/<batch>` (e.g. "2026-09-09 new dump"), computed ONCE so all
  // files of the run share it. Null when the source folder IS the archive
  // (files already home — nothing to group) or a dry run (no writes).
  const isSelfIngest =
    opts.folder === opts.musicDir ||
    opts.folder.startsWith(`${opts.musicDir}/`);
  const batchDir =
    opts.dryRun || isSelfIngest
      ? null
      : resolveIntakeDir(
          opts.musicDir,
          intakeFolderName(opts.folder, opts.now),
        );
  if (batchDir) log(`intake folder: ${basename(batchDir)}/`);
  const files0 = await walkAudio(
    opts.folder,
    [],
    [quarantineDir, join(opts.musicDir, "rekordbox")],
  );
  log(`${files0.length} audio file(s) under ${opts.folder}`);

  // Zips in the folder: extract audio next to them so the pipeline below
  // picks it up; the zip itself is deleted only after every staged file
  // is safely in the archive. MUST run before the final walk — otherwise
  // staged files miss this run and only get ingested on a second run.
  await expandZips(opts.folder, opts.dryRun, (d) => walkAudio(d), log);

  const files = await walkAudio(
    opts.folder,
    [],
    [quarantineDir, join(opts.musicDir, "rekordbox")],
  );

  // ---- Phase A: probe ------------------------------------------------------
  const { records, broken } = await probeAllFiles(files, log);

  // ---- Phase B: within-folder dedupe ---------------------------------------
  const { survivors, folderDupes } = await dedupeWithinFolder(
    records,
    quarantineDir,
    opts.dryRun,
    log,
  );

  // ---- Phase C: archive collision check -------------------------------------
  const { toIngest, archiveDupes, upgrades } = await dedupeAgainstArchive(
    opts.state,
    survivors,
    quarantineDir,
    opts.dryRun,
    log,
  );

  // ---- Phase D: tag + artwork + register -------------------------------------
  const counters = newCounters();
  const queueEntries: QueueEntry[] = [];
  for (const rec of toIngest) {
    try {
      await ingestOne(
        opts,
        log,
        rec,
        counters,
        minDuration,
        queuedIdentity,
        queueEntries,
        batchDir,
      );
    } catch (e) {
      // One broken file must not kill a 373-file run (Sep 11: a single
      // ffmpeg exit-234 aborted the whole batch mid-loop). Surface it,
      // count it, keep going.
      counters.writeFailed++;
      const name = rec.file.split("/").pop() ?? rec.file;
      log(
        `  ✗ tag-write failed: ${name} — ${(e as Error).message?.slice(0, 90)}`,
      );
    }
  }

  await flushArtworkQueue(opts.state.dbDir, queueEntries, opts.dryRun);
  if (queueEntries.length > 0 && !opts.dryRun) {
    log(`artwork queue: ${queueEntries.length} entries`);
  }

  const runStats: IngestRunStats = {
    files: files.length,
    folderDupes,
    archiveDupes,
    upgrades,
    broken,
    minDuration,
  };
  await emitIngestReport(opts, counters, runStats, quarantineDir);

  // Zips: delete only when EVERY file staged from them has left the source
  // folder (i.e. was moved into the archive or quarantined as a dupe).
  if (!opts.dryRun && pendingZipDeletes.size > 0) {
    await deleteFullyIngestedZips(
      opts.folder,
      opts.musicDir,
      quarantineDir,
      log,
    );
  }
}
