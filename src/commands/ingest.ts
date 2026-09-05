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
 */

import { $ } from "bun";
import { createHash } from "node:crypto";
import { stat, copyFile, mkdir, rename } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import type { ArchiveState, TrackRow } from "../state";
import { applyTags, inferGenre, sanitizeGenreFolder } from "../metadata";
import {
  expandZips,
  deleteFullyIngestedZips,
  pendingZipDeletes,
} from "./ingest-zips";
import {
  firstTag,
  mbRecording,
  parseFilename,
  probeFile,
  qualityScore,
  quarantine,
  walkAudio,
  type Record_,
} from "./ingest-probe";
import { identityKey } from "./identity";
import { detectRemix } from "./remix";
import { energyFromLufs, measureRms } from "./energy";
import { wavToAiff } from "./wav-to-aiff";
import {
  fetchAndEmbedArtwork,
  flushArtworkQueue,
  type ArtworkOutcome,
} from "./ingest-art";
import type { QueueEntry } from "./queue";

export interface IngestOptions {
  state: ArchiveState;
  musicDir: string;
  folder: string;
  dryRun?: boolean;
  noArtwork?: boolean;
  quarantineDir?: string;
  /** Tracks shorter than this many seconds are skipped (default 60). */
  minDuration?: number;
  onProgress?: (msg: string) => void;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function ingest(opts: IngestOptions): Promise<void> {
  // --json mode (P1): silence human progress logs — the summary object is
  // the only stdout output, so agents get parseable JSON.
  const log =
    opts.json && !opts.onProgress
      ? () => {}
      : (opts.onProgress ?? ((m: string) => console.log(m)));
  const quarantineDir =
    opts.quarantineDir ?? join(opts.folder, "ingest-duplicates");
  const minDuration = opts.minDuration ?? 60;
  const queuedIdentity = new Set<string>();
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

  // ---- Phase A: probe everything -------------------------------------
  const records: Record_[] = [];
  const broken: string[] = [];
  for (const file of files) {
    const st = await stat(file);
    const probe = await probeFile(file);
    if (!st.size || !probe.ok) {
      broken.push(file);
      log(`  ✗ broken/zero-byte: ${basename(file)}`);
      continue;
    }
    const parsed = parseFilename(basename(file));
    const tagTitle = firstTag(probe.tags, ["title"]);
    const tagArtist = firstTag(probe.tags, ["artist"]);
    const title = tagTitle || parsed.title;
    const artist = tagArtist || parsed.artist;
    records.push({
      file,
      size: st.size,
      probe,
      parsed,
      identity: identityKey(artist, title),
      score: qualityScore(probe),
    });
  }

  // ---- Phase B: within-folder dedupe, highest quality wins -----------
  const byIdentity = new Map<string, Record_>();
  const survivors: Record_[] = [];
  let folderDupes = 0;
  for (const rec of records) {
    const incumbent = byIdentity.get(rec.identity);
    if (!incumbent) {
      byIdentity.set(rec.identity, rec);
      survivors.push(rec);
      continue;
    }
    const [keep, drop] =
      rec.score > incumbent.score ||
      (rec.score === incumbent.score &&
        basename(rec.file).length < basename(incumbent.file).length)
        ? [rec, incumbent]
        : [incumbent, rec];
    byIdentity.set(keep.identity, keep);
    if (!survivors.includes(keep)) survivors.push(keep);
    folderDupes++;
    log(
      `  [dupe] ${basename(drop.file)} — keeping higher-quality ${basename(keep.file)}` +
        ` (${(keep.score / 1e3).toFixed(0)} vs ${(drop.score / 1e3).toFixed(0)})`,
    );
    await quarantine(drop.file, quarantineDir, opts.dryRun, log);
  }

  // ---- Phase C: archive collision check ------------------------------
  const archiveTracks = opts.state
    .allTracks()
    .filter((t) => t.status === "downloaded" && t.file_path);
  const archiveByIdentity = new Map<string, TrackRow>();
  for (const t of archiveTracks) {
    if (!t.title) continue;
    const key = identityKey(t.artist, t.title);
    if (!archiveByIdentity.has(key)) archiveByIdentity.set(key, t);
  }
  let archiveDupes = 0;
  let upgrades = 0;
  const toIngest: Record_[] = [];
  for (const rec of survivors) {
    const existing = archiveByIdentity.get(rec.identity);
    if (!existing?.file_path) {
      toIngest.push(rec);
      continue;
    }
    archiveDupes++;
    const existingProbe = await probeFile(existing.file_path);
    const existingScore = existingProbe.ok ? qualityScore(existingProbe) : -1;
    if (rec.score > existingScore * 1.05) {
      upgrades++;
      log(
        `  [upgrade] ${basename(rec.file)} beats archive copy of "${existing.title}"` +
          ` — will replace`,
      );
      toIngest.push(rec);
    } else {
      log(`  [dupe] already in archive: ${basename(rec.file)} — quarantining`);
      await quarantine(rec.file, quarantineDir, opts.dryRun, log);
    }
  }

  // ---- Phase D: tag + artwork + register ------------------------------
  let tagged = 0;
  let artAdded = 0;
  let artQueued = 0;
  let artSkippedWav = 0;
  let shortSkipped = 0;
  let unchanged = 0;
  let wavConverted = 0;
  const queueEntries: QueueEntry[] = [];

  for (const rec of toIngest) {
    let { file, probe, parsed } = rec;
    let ext = extname(file).toLowerCase();
    const title = firstTag(probe.tags, ["title"]) || parsed.title;
    let artist = firstTag(probe.tags, ["artist"]) || parsed.artist;
    let album = firstTag(probe.tags, ["album"]);
    let date = firstTag(probe.tags, ["date", "year"]);
    let genre = firstTag(probe.tags, ["genre"]);
    let mbidUsed: string | null =
      firstTag(probe.tags, ["musicbrainz_trackid"]) ?? null;
    const remixOf = detectRemix(parsed.title);
    const bootleg = /\b(bootleg|unofficial|unreleased)\b/i.test(parsed.title);

    // Duration gate: tracks under 60s are not DJ material (usually clips,
    // ringtones, ads, or corrupted extractions). Still registered in the
    // DB (status skipped_short) so they show up in `megadj list` — but
    // never copied to the music dir or tagged. Override: --min-duration 0.
    if ((probe.durationS ?? Infinity) < minDuration) {
      shortSkipped++;
      log(
        `  ⚠ short (${probe.durationS?.toFixed(0)}s < ${minDuration}s): ${basename(file)} — skipped`,
      );
      if (!opts.dryRun) {
        const shortId = `ext-${createHash("sha1").update(file).digest("hex").slice(0, 12)}`;
        opts.state.upsertTrackFromPlaylist(shortId, 0, title, "ingest");
        opts.state.markShortSkipped(shortId, file, probe.durationS);
      }
      continue;
    }

    // WAV → AIFF lossless conversion (stream copy, tags ride along).
    // rekordbox cannot read embedded art from WAVs; AIFF is bit-identical
    // audio with native art support. See docs/rekordbox-wav-artwork.md.
    if (ext === ".wav" && !opts.dryRun) {
      const aiff = await wavToAiff(file);
      if (aiff) {
        file = aiff;
        ext = ".aiff";
        probe.hasArt = true; // tags+art already rode along via map_metadata
        wavConverted++;
        log(`  ⇄ wav→aiff: ${basename(aiff)}`);
      }
    }

    if (!artist || !album || !genre || genre === "Music") {
      if (title.length >= 4) {
        await sleep(1100); // MusicBrainz politeness
        const mb = await mbRecording(artist, title);
        artist = artist || mb.artist;
        if (!album && mb.album) album = mb.album;
        if (!date && mb.date) date = mb.date;
        if (!genre || genre === "Music")
          genre = inferGenre([genre, mb.artistTags, artist]);
        if (mb.mbid) mbidUsed = mb.mbid;
      }
    }
    genre = inferGenre([genre, artist, album, title]) ?? "Music";

    const changes: string[] = [];
    if (firstTag(probe.tags, ["title"]) !== title) changes.push("title");
    if (artist && firstTag(probe.tags, ["artist"]) !== artist)
      changes.push("artist");
    if (album && firstTag(probe.tags, ["album"]) !== album)
      changes.push("album");
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
      tagged++;
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
        artSkippedWav++;
      } else if (art.source) {
        artAdded++;
        changes.push("artwork");
      }
    }

    if (changes.length === 0) {
      unchanged++;
      log(`  = ok: ${basename(file)}`);
    } else {
      log(`  ~ ${basename(file)}: ${changes.join(", ")}`);
    }

    if (opts.dryRun) continue;

    // Register + move into the music dir (unless already there).
    // Sources are moved (not copied) once the copy into the archive
    // succeeds, so Downloads doesn't fill with duplicate copies.
    const extId = `ext-${createHash("sha1").update(file).digest("hex").slice(0, 12)}`;
    let destPath = join(opts.musicDir, basename(file));
    if (!file.startsWith(opts.musicDir)) {
      if (destPath !== file) {
        await mkdir(opts.musicDir, { recursive: true });
        try {
          const destStat = await stat(destPath);
          if (destStat.size !== rec.size) {
            destPath = join(
              opts.musicDir,
              basename(file).replace(/(\.[^.]+)$/, " (ingest)$1"),
            );
          }
        } catch {
          /* dest missing — normal path */
        }
        await copyFile(file, destPath);
        // success: remove the source so nothing is left duplicated
        try {
          await rename(file, `${file}.ingested`);
          await $`rm -f ${`${file}.ingested`}`.quiet().nothrow();
        } catch {
          /* keep source if we can't even mark it — copy already succeeded */
        }
      }
    } else {
      destPath = file;
    }
    opts.state.upsertTrackFromPlaylist(extId, 0, title, "ingest");
    opts.state.markDownloaded(extId, {
      title,
      artist,
      album,
      genre: sanitizeGenreFolder(genre),
      formatId: null,
      bitrateKbps: probe.bitrateKbps,
      codec: probe.codec,
      filePath: destPath,
      fileSizeBytes: rec.size,
      durationS: probe.durationS,
      energy,
    });

    // Artwork queue fallback: when nothing could be fetched (bootlegs/
    // edits rarely exist on iTunes), persist a queue entry so an agent
    // can generate cover art later via the image-maker CLI (square,
    // nano-banana-2, ~$0.03-0.07/img). Written to
    // ~/.local/state/megadj/artwork-queue.jsonl (one JSON per line).
    if (!probe.hasArt && !opts.noArtwork) {
      if (art.skipped) {
        // format can't hold art — nothing to queue
      } else if (queuedIdentity.has(rec.identity)) {
        // already in queue from an earlier run/file
      } else if (art.failedUrl) {
        // artwork found but embedding failed — try again next run
        queuedIdentity.add(rec.identity);
        queueEntries.push({
          path: destPath,
          title,
          artist,
          album,
          reason: "embed-failed",
          sourceUrl: art.failedUrl,
        });
        opts.state.updateArtworkStatus(extId, "queued");
        artQueued++;
      } else if (art.queued || !art.source) {
        queuedIdentity.add(rec.identity);
        queueEntries.push({
          path: destPath,
          title,
          artist,
          album,
          reason: "no-source-found",
          remixOf: remixOf?.original ?? null,
        });
        opts.state.updateArtworkStatus(extId, "queued");
        artQueued++;
      }
    }
  }

  await flushArtworkQueue(opts.state.dbDir, queueEntries, opts.dryRun);
  if (queueEntries.length > 0 && !opts.dryRun) {
    log(`artwork queue: ${queueEntries.length} entr(ies)`);
  }

  log(
    `\ndone: ${tagged} retagged, ${artAdded} artwork embedded` +
      (wavConverted ? `, ${wavConverted} wav→aiff` : "") +
      (artQueued ? `, ${artQueued} artwork QUEUED for image-maker` : "") +
      (artSkippedWav ? `, ${artSkippedWav} wav skipped for art` : "") +
      (shortSkipped ? `, ${shortSkipped} skipped (<${minDuration}s)` : "") +
      `, ${unchanged} already clean` +
      `, ${folderDupes} in-folder dupes, ${archiveDupes} archive dupes (${upgrades} quality upgrades)` +
      (broken.length ? `, ${broken.length} BROKEN (left in place)` : ""),
  );
  if (opts.dryRun) log("(dry run — nothing written)");
  else if (folderDupes + archiveDupes > 0)
    log(`duplicates moved to: ${quarantineDir}`);
  if (broken.length > 0)
    log(`broken files:\n  ${broken.map((b) => basename(b)).join("\n  ")}`);

  if (opts.json) {
    // P1 (--json on every command): one summary object on stdout, last.
    console.log(
      JSON.stringify({
        command: "ingest",
        dryRun: opts.dryRun ?? false,
        files: files.length,
        tagged,
        artAdded,
        artQueued,
        wavConverted,
        shortSkipped,
        unchanged,
        folderDupes,
        archiveDupes,
        upgrades,
        broken: broken.length,
      }),
    );
  }

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
