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

import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { join, basename, extname } from "node:path";
import { intakeFolderName, resolveIntakeDir } from "./intake-folder";
import type { ArchiveState, TrackRow } from "../state";
import { commandLog } from "../progress";
import { applyTags, inferGenre } from "../../fulltags/src/exports";
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
import {
  compareFingerprint,
  nameSimilarityTokens,
} from "../../fulltags/src/exports";
import { identityKey } from "../../fulltags/src/identity";
import {
  detectRemix,
  energyFromLufs,
  measureRms,
} from "../../fulltags/src/exports";
import { wavToAiff } from "./wav-to-aiff";
import { playerCompat, isHiresOnly } from "../../fulltags/src/exports";
import {
  fetchAndEmbedArtwork,
  flushArtworkQueue,
  type ArtworkOutcome,
} from "./ingest-art";
import type { QueueEntry } from "./queue";
// copyIntoArchive / queueArtworkFallback / registerAndMove (the archive-
// landing half of Phase D) live in ingest-register.ts with narrow param
// types — this module never imported back keeps madge at zero cycles.
import { registerAndMove } from "./ingest-register";

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
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// IngestCounters is DEFINED in ingest-register.ts (the leaf seam shared
// with the landing helpers — a split-out module must never import its
// parent's types back: madge counts a type-only back-edge as a cycle).
import type { IngestCounters } from "./ingest-register";

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
  };
}

/** Phase A: probe every file; broken/zero-byte files are reported, never moved.
 *  A file that vanishes between walk and stat is skipped — one ENOENT must
 *  not kill the whole pass (same hardening `sync` got for its byte counter). */
async function probeAllFiles(
  files: string[],
  log: (msg: string) => void,
): Promise<{ records: Record_[]; broken: string[] }> {
  const records: Record_[] = [];
  const broken: string[] = [];
  for (const file of files) {
    let st: Stats;
    try {
      st = await stat(file);
    } catch {
      log(`  ✗ vanished mid-scan, skipped: ${basename(file)}`);
      continue;
    }
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
  return { records, broken };
}

/** Phase B: within-folder dedupe — highest quality wins, losers quarantined. */
async function dedupeWithinFolder(
  records: Record_[],
  quarantineDir: string,
  dryRun: boolean | undefined,
  log: (msg: string) => void,
): Promise<{ survivors: Record_[]; folderDupes: number }> {
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
    // Remove the loser even when it was first-seen (it entered survivors
    // earlier) — leaving it in meant Phase D tried to copy an already
    // quarantined file (ENOENT mid-batch, Sep 10 2026).
    const dropIdx = survivors.indexOf(drop);
    if (dropIdx >= 0) survivors.splice(dropIdx, 1);
    if (!survivors.includes(keep)) survivors.push(keep);
    folderDupes++;
    log(
      `  [dupe] ${basename(drop.file)} — keeping higher-quality ${basename(keep.file)}` +
        ` (${(keep.score / 1e3).toFixed(0)} vs ${(drop.score / 1e3).toFixed(0)})`,
    );
    await quarantine(drop.file, quarantineDir, dryRun, log);
  }
  // Content-hash pass over the survivors (Back To Friends trap, Sep 9
  // 2026): a mislabeled "Extended Mix" was a byte-identical copy of the
  // Radio Edit — different filename + title tag → different identity →
  // both got ingested. Same size is the cheap trigger; MD5 confirms
  // before anything quarantines. Different content at the same size is
  // KEPT (size alone is not a dupe — AGENTS.md).
  folderDupes += await dedupeByContent(survivors, quarantineDir, dryRun, log);
  // Acoustic pass (name-blind, the shelf-dupescan guarantee at intake):
  // same recording re-rip under a different name/container/bitrate.
  // fp-equal + name-similar → dupe; fp-equal + name-dissimilar → possible
  // long-mix fp collision, kept for human review (never auto-quarantined).
  folderDupes += await dedupeByFingerprint(
    survivors,
    quarantineDir,
    dryRun,
    log,
  );
  return { survivors, folderDupes };
}

/** MD5-verified twin pass over the identity-dedupe survivors. */
async function dedupeByContent(
  survivors: Record_[],
  quarantineDir: string,
  dryRun: boolean | undefined,
  log: (m: string) => void,
): Promise<number> {
  let contentDupes = 0;
  const bySize = new Map<number, Record_[]>();
  for (const rec of survivors) {
    const list = bySize.get(rec.size) ?? [];
    list.push(rec);
    bySize.set(rec.size, list);
  }
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    const hashes = new Map<string, Record_>();
    for (const rec of group) {
      const digest = await md5File(rec.file);
      const twin = hashes.get(digest);
      if (!twin) {
        hashes.set(digest, rec);
        continue;
      }
      const [keep, drop] =
        rec.score > twin.score ||
        (rec.score === twin.score &&
          basename(rec.file).length < basename(twin.file).length)
          ? [rec, twin]
          : [twin, rec];
      contentDupes++;
      log(
        `  [dupe] ${basename(drop.file)} — byte-identical twin of ${basename(keep.file)} (md5)`,
      );
      const idx = survivors.indexOf(drop);
      if (idx >= 0) survivors.splice(idx, 1);
      await quarantine(drop.file, quarantineDir, dryRun, log);
      if (hashes.get(digest) === drop) hashes.set(digest, keep);
    }
  }
  return contentDupes;
}

async function md5File(path: string): Promise<string> {
  const crypto = await import("node:crypto");
  const { createReadStream } = await import("node:fs");
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    createReadStream(path)
      .on("data", (d: Buffer) => hash.update(d))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

/** Filename stem, lowercased and stripped to alphanumerics — the same-stem
 *  pair key for the mp3↔lossless dupe pass. Pure — module-level. */
const stemOf = (f: string): string =>
  basename(f)
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Acoustic-fingerprint pass over the identity+MD5 survivors (name-blind
 *  dupe class: same recording, different rip). fpcalc per file is ~1s, so
 *  this runs only for pairs the cheaper passes couldn't resolve. Loser =
 *  lower quality score, then longer name — same tiebreaks as everywhere. */
async function dedupeByFingerprint(
  survivors: Record_[],
  quarantineDir: string,
  dryRun: boolean | undefined,
  log: (m: string) => void,
): Promise<number> {
  let fpDupes = 0;
  const byFp = new Map<string, Record_>();
  // SAME-STEM PAIR pass (the Play Hard trap, Sep 10 2026): pools ship
  // mp3+wav pairs whose fingerprints differ slightly (lossy vs lossless
  // decode), so the fp equality check below can never match them — and
  // both copies ingested. A same-stem mp3↔lossless pair IS one recording
  // by convention (the skill's zip rule); the lossless side always wins,
  // regardless of what qualityScore says (an mp3's nominal bitrate must
  // never beat the lossless file it shipped with).
  const LOSSLESS_RE = /\.(wav|aiff?|flac)$/i;
  const losslessStems = new Set<string>();
  for (const rec of survivors) {
    if (LOSSLESS_RE.test(rec.file)) losslessStems.add(stemOf(rec.file));
  }
  const mp3Losers = survivors.filter(
    (rec) => /\.mp3$/i.test(rec.file) && losslessStems.has(stemOf(rec.file)),
  );
  for (const loser of mp3Losers) {
    log(
      `  [dupe] ${basename(loser.file)} — mp3 twin of the same-stem lossless copy`,
    );
    const idx = survivors.indexOf(loser);
    if (idx >= 0) survivors.splice(idx, 1);
    await quarantine(loser.file, quarantineDir, dryRun, log);
    fpDupes++;
  }
  for (const rec of survivors) {
    // One fpcalc call per file — compareFingerprint hashes the second file
    // again; group sequentially so each file is hashed at most twice.
    const v = await compareFingerprint(rec.file, rec.file);
    if (!v.fp) continue;
    const seen = byFp.get(v.fp);
    if (!seen) {
      byFp.set(v.fp, rec);
      continue;
    }
    const similar =
      nameSimilarityTokens(basename(rec.file), basename(seen.file)) >= 0.5;
    if (!similar) {
      // fp collision across dissimilar names → likely different recordings
      // (long-mix), never auto-quarantine — surface it and keep both.
      log(
        `  [fp] same fingerprint, dissimilar names — kept for review: ${basename(rec.file)} ≈ ${basename(seen.file)}`,
      );
      continue;
    }
    const [keep, drop] =
      rec.score > seen.score ||
      (rec.score === seen.score &&
        basename(rec.file).length < basename(seen.file).length)
        ? [rec, seen]
        : [seen, rec];
    fpDupes++;
    log(
      `  [dupe] ${basename(drop.file)} — same recording as ${basename(keep.file)} (acoustic fingerprint)`,
    );
    const idx = survivors.indexOf(drop);
    if (idx >= 0) survivors.splice(idx, 1);
    await quarantine(drop.file, quarantineDir, dryRun, log);
    if (byFp.get(v.fp) === drop) byFp.set(v.fp, keep);
  }
  return fpDupes;
}

/** Phase B seam for tests (ingest-pair.test.ts): probe a folder's files
 * and run the within-folder dedupe passes — no DB, no archive check. */
export async function dedupeWithinFolderForTest(
  folder: string,
  quarantineDir: string,
  dryRun: boolean | undefined,
  log: (msg: string) => void,
): Promise<{ survivors: Record_[]; dupes: number }> {
  const files = await walkAudio(folder, [], [quarantineDir]);
  const { records } = await probeAllFiles(files, log);
  const { survivors, folderDupes } = await dedupeWithinFolder(
    records,
    quarantineDir,
    dryRun,
    log,
  );
  return { survivors, dupes: folderDupes };
}

/** Phase C: archive collision check — archive dupes quarantine unless the new
 *  copy beats the stored one by >5% quality (a "quality upgrade"). */
async function dedupeAgainstArchive(
  state: ArchiveState,
  survivors: Record_[],
  quarantineDir: string,
  dryRun: boolean | undefined,
  log: (msg: string) => void,
): Promise<{ toIngest: Record_[]; archiveDupes: number; upgrades: number }> {
  const archiveTracks = state.downloadedWithFiles();
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
    // SELF-MATCH GUARD: the "existing" row may point at THIS VERY FILE.
    // Every batch folder lives inside musicDir, so last night's ingest of
    // this folder registered rows whose file_path is the file we're now
    // looking at. Quarantining here would rename the archive's only copy
    // into ingest-duplicates and leave the row pointing at a missing path
    // (the Sep 10 14:29 UI re-run did exactly that to 14 rows — the file
    // survived in quarantine, but the archive pointer broke). A self-match
    // means "already ingested, nothing to do": skip in place.
    if (existing.file_path === rec.file) {
      log(
        `  [dupe] already in archive (self): ${basename(rec.file)} — unchanged`,
      );
      archiveDupes++;
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
      await quarantine(rec.file, quarantineDir, dryRun, log);
    }
  }
  return { toIngest, archiveDupes, upgrades };
}

/** Phase D per-track work: tag + artwork + register + move into the archive. */
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
    counters.shortSkipped++;
    log(
      `  ⚠ short (${probe.durationS?.toFixed(0)}s < ${minDuration}s): ${basename(file)} — skipped`,
    );
    if (!opts.dryRun) {
      const shortId = `ext-${createHash("sha1").update(file).digest("hex").slice(0, 12)}`;
      opts.state.upsertTrackFromPlaylist(shortId, 0, title, "ingest");
      opts.state.markShortSkipped(shortId, file, probe.durationS);
    }
    return;
  }

  // WAV → AIFF lossless conversion (stream copy, tags ride along).
  // rekordbox cannot read embedded art from WAVs; AIFF is bit-identical
  // audio with native art support. See docs/rekordbox-wav-artwork.md.
  if (ext === ".wav" && !opts.dryRun) {
    const aiff = await wavToAiff(file);
    if (aiff) {
      file = aiff;
      ext = ".aiff";
      // Same PCM stream in a new container — codec/bit depth are the
      // source's (s16le→s16be etc.), only art presence changes.
      probe = { ...probe, hasArt: true };
      counters.wavConverted++;
      log(`  ⇄ wav→aiff: ${basename(aiff)}`);
    }
  }

  // Player-compat gate — the file must PLAY on the whole booth fleet
  // (XDJ-XZ / CDJ-3000 / CDJ-2000NXS2 / CDJ-2000). See
  // fulltags/src/player-compat.ts for the spec table this enforces.
  // Checked AFTER wav→aiff so a 96kHz WAV becomes a compliant 96kHz AIFF
  // verdict on the same probe it will register with.
  {
    const compat = playerCompat(probe);
    if (!compat.ok && !isHiresOnly(compat)) {
      counters.compatRejected++;
      log(
        `  ⛔ player-incompatible (${compat.detail}): ${basename(file)} — left in place`,
      );
      // No DB row on purpose: same treatment as broken files. A `failed`
      // row would be resurrected by `megadj retry` into the download
      // queue; the refusal lives in this log + counter and, if the file
      // ever lands in the archive anyway, the audit's playable gate.
      return;
    }
    if (isHiresOnly(compat)) {
      counters.compatHires++;
      log(
        `  ⚠ hires-only (${compat.detail}): ${basename(file)} — ingesting; will NOT load on XDJ-XZ / CDJ-2000`,
      );
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
    opts.folder.startsWith(opts.musicDir + "/");
  const batchDir =
    opts.dryRun || isSelfIngest
      ? null
      : resolveIntakeDir(opts.musicDir, intakeFolderName(opts.folder));
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
  }

  await flushArtworkQueue(opts.state.dbDir, queueEntries, opts.dryRun);
  if (queueEntries.length > 0 && !opts.dryRun) {
    log(`artwork queue: ${queueEntries.length} entr(ies)`);
  }

  log(
    `\ndone: ${counters.tagged} retagged, ${counters.artAdded} artwork embedded` +
      (counters.wavConverted ? `, ${counters.wavConverted} wav→aiff` : "") +
      (counters.compatRejected
        ? `, ${counters.compatRejected} PLAYER-INCOMPATIBLE (left in place)`
        : "") +
      (counters.compatHires
        ? `, ${counters.compatHires} hires-only (no XDJ-XZ/CDJ-2000)`
        : "") +
      (counters.artQueued
        ? `, ${counters.artQueued} artwork QUEUED for image-maker`
        : "") +
      (counters.artSkippedWav
        ? `, ${counters.artSkippedWav} wav skipped for art`
        : "") +
      (counters.shortSkipped
        ? `, ${counters.shortSkipped} skipped (<${minDuration}s)`
        : "") +
      `, ${counters.unchanged} already clean` +
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
        tagged: counters.tagged,
        artAdded: counters.artAdded,
        artQueued: counters.artQueued,
        wavConverted: counters.wavConverted,
        compatRejected: counters.compatRejected,
        compatHires: counters.compatHires,
        shortSkipped: counters.shortSkipped,
        unchanged: counters.unchanged,
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
