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
 *     og:image); else iTunes Search (600x600). WAV gets tags but no embedded
 *     art (WAV + artwork is unreliable across players).
 *  5. Tagged files are copied into the music dir (sources never touched) and
 *     registered in the state DB so `organize` / USB sync pick them up.
 */

import { $ } from "bun";
import { createHash } from "node:crypto";
import { readdir, stat, copyFile, mkdir, rename } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import type { ArchiveState, TrackRow } from "../state";
import { applyTags, inferGenre, sanitizeGenreFolder } from "../metadata";

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
}

const AUDIO_EXTS = new Set([".m4a", ".mp3", ".wav", ".flac", ".aiff", ".aif"]);
/** Containers that reliably hold embedded artwork. */
const ARTWORK_EXTS = new Set([".m4a", ".mp3", ".flac", ".aiff", ".aif"]);
const LOSSLESS = new Set([".wav", ".flac", ".aiff", ".aif"]);
const MB_UA = "megadj/0.1 (https://github.com/megadj/megadj)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Normalize a string for loose title/artist comparison (same idea as adopt). */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[｜|]/g, "|")
    .replace(/\(1\)|\(2\)|\(3\)/g, " ") // Safari "name (1).ext" dupes
    .replace(/[\[\]\(\)]/g, " ")
    .replace(/_/g, " ")
    .replace(/\b(final|master|mstr|v\d+)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function identityKey(artist: string | null, title: string): string {
  return `${normalize(artist ?? "")}|${normalize(title)}`;
}

export interface RemixInfo {
  /** Original track title, e.g. "Savin Me". */
  track: string;
  /** Original artist, e.g. "Nickelback". */
  originalArtist: string;
  /** Remix credit, e.g. "Flozone" or "Flozone Flip". */
  remixName: string;
  remixer: string;
  original: string;
}

/**
 * Detect `X - Y (Z Remix/Flip/Edit)` patterns. Bootlegs rarely have
 * MusicBrainz entries, so filename structure is the best source for the
 * original-artist credit. Returns null when no remix pattern is present.
 */
export function detectRemix(title: string): RemixInfo | null {
  // "Artist - Track (Remixer Remix)" / "(Remixer Flip)" / "(Remixer Edit)"
  const m =
    /^(.{2,80}?)\s+-\s+(.{1,120}?)\s*\(([^()]{2,60}?)\s+(remix|flip|edit|rework|re-work|vip|bootleg)\s*\)$/i.exec(
      title.trim(),
    );
  if (!m || !m[1] || !m[2] || !m[3] || !m[4]) return null;
  const originalArtist = m[1].trim();
  const track = m[2].trim();
  const tail = m[3].trim();
  const kind = m[4].toLowerCase();
  // "Flozone Remix" → remixer "Flozone"; "a x b Remix" → last name wins.
  const remixers = tail
    .replace(new RegExp(`\\s+${kind}$`, "i"), "")
    .split(/\s+[x&]\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const remixer = remixers[remixers.length - 1] ?? tail;
  // m[3] is lazy so it stops before the keyword — rebuild the full credit.
  const remixName = `${tail} ${m[4]}`;
  return {
    track,
    originalArtist,
    remixName,
    remixer,
    original: `${originalArtist} - ${track}`,
  };
}

interface ParsedName {
  trackNo: number | null;
  artist: string | null;
  title: string;
}

/** Parse `NNN - Artist - Title.ext` / `Artist - Title.ext` / `Title.ext`. */
export function parseFilename(basename: string): ParsedName {
  const stem = basename.replace(/\.[^.]+$/, "");
  const numMatch = /^(\d{1,3})\s+-\s+(.+)$/.exec(stem);
  let rest = stem;
  let trackNo: number | null = null;
  if (numMatch) {
    trackNo = Number(numMatch[1]);
    rest = numMatch[2] ?? stem;
  }
  const parts = rest.split(/\s+-\s+/);
  if (parts.length >= 2) {
    const artistPart = parts[0]?.trim();
    return {
      trackNo,
      artist: artistPart ? artistPart : null,
      title: parts.slice(1).join(" - ").trim(),
    };
  }
  return { trackNo, artist: null, title: rest.trim() };
}

interface Probe {
  ok: boolean;
  durationS: number | null;
  bitrateKbps: number | null;
  sampleRate: number | null;
  codec: string | null;
  hasArt: boolean;
  tags: Record<string, string>;
}

async function probeFile(path: string): Promise<Probe> {
  const proc =
    await $`ffprobe -v error -print_format json -show_format -show_streams ${path}`
      .quiet()
      .nothrow();
  if (proc.exitCode !== 0) {
    return {
      ok: false,
      durationS: null,
      bitrateKbps: null,
      sampleRate: null,
      codec: null,
      hasArt: false,
      tags: {},
    };
  }
  const stdout =
    typeof proc.stdout === "string" ? proc.stdout : proc.stdout.toString();
  const data = JSON.parse(stdout) as {
    format?: {
      duration?: string;
      bit_rate?: string;
      tags?: Record<string, string>;
    };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      sample_rate?: string;
    }>;
  };
  const tags: Record<string, string> = {};
  const formatTags = data.format?.tags ?? {};
  for (const k of Object.keys(formatTags)) {
    tags[k.toLowerCase()] = String(formatTags[k]).trim();
  }
  const streams = data.streams ?? [];
  const audio = streams.find((s) => s.codec_type === "audio");
  return {
    ok: true,
    durationS: data.format?.duration ? Number(data.format.duration) : null,
    bitrateKbps: data.format?.bit_rate
      ? Math.round(Number(data.format.bit_rate) / 1000)
      : null,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    codec: audio?.codec_name ?? null,
    hasArt: streams.some((s) => s.codec_type === "video"),
    tags,
  };
}

/** Higher = better. Lossless dominates, then bitrate, then length. */
export function qualityScore(p: Probe): number {
  const lossless =
    p.codec && LOSSLESS.has(`.${p.codec.replace("pcm_s16le", "wav")}`)
      ? 1e9
      : 0;
  return lossless + (p.bitrateKbps ?? 0) * 1e3 + (p.durationS ?? 0);
}

function firstTag(tags: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = tags[k];
    if (v) return v;
  }
  return null;
}

async function mbRecording(
  artist: string | null,
  title: string,
): Promise<{
  artist: string | null;
  album: string | null;
  date: string | null;
  artistTags: string;
}> {
  const q = artist
    ? `artist:"${encodeURIComponent(artist)}" AND recording:"${encodeURIComponent(title)}"`
    : `recording:"${encodeURIComponent(title)}"`;
  const url = `https://musicbrainz.org/ws/2/recording/?query=${q}&fmt=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": MB_UA } });
    if (!res.ok)
      return { artist: null, album: null, date: null, artistTags: "" };
    const data = (await res.json()) as {
      recordings?: Array<{
        "artist-credit"?: Array<{
          name?: string;
          artist?: {
            name?: string;
            tags?: Array<{ name: string; count: number }>;
          };
        }>;
        releases?: Array<{ title?: string; date?: string }>;
      }>;
    };
    const rec = data.recordings?.[0];
    const credit = rec?.["artist-credit"]?.[0];
    const mbArtist = credit?.artist?.name ?? credit?.name ?? null;
    const rel = rec?.releases?.[0];
    const tags = (credit?.artist?.tags ?? [])
      .sort((a, b) => b.count - a.count)
      .map((t) => t.name)
      .join(" ");
    return {
      artist: mbArtist,
      album: rel?.title ?? null,
      date: rel?.date?.slice(0, 4) ?? null,
      artistTags: tags,
    };
  } catch {
    return { artist: null, album: null, date: null, artistTags: "" };
  }
}

/** Fetch the biggest artwork image from a SoundCloud track/playlist page. */
async function soundcloudArtwork(pageUrl: string): Promise<string | null> {
  try {
    const oembed = await fetch(
      `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(pageUrl)}`,
    );
    if (oembed.ok) {
      const data = (await oembed.json()) as { thumbnail_url?: string };
      if (data.thumbnail_url) {
        // t500x500 is the largest oEmbed serves; original art hides in the page.
        return data.thumbnail_url.replace(/-(large|t\d+x\d+)\./, "-t500x500.");
      }
    }
    const page = await fetch(pageUrl, { headers: { "User-Agent": MB_UA } });
    if (page.ok) {
      const html = await page.text();
      const og = /property="og:image" content="([^"]+)"/.exec(html);
      if (og?.[1]) return og[1].replace(/-(large|t\d+x\d+)\./, "-t500x500.");
    }
  } catch {
    /* fall through */
  }
  return null;
}

function soundcloudUrlInTags(tags: Record<string, string>): string | null {
  for (const v of Object.values(tags)) {
    const m = /https?:\/\/(www\.)?soundcloud\.com\/[^\s"'<>]+/.exec(v);
    if (m?.[0]) return m[0];
  }
  return null;
}

async function itunesArtwork(
  artist: string,
  titleOrAlbum: string,
): Promise<string | null> {
  const term = encodeURIComponent(`${artist} ${titleOrAlbum}`.slice(0, 120));
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${term}&entity=song&limit=1`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{ artworkUrl100?: string }>;
    };
    const url = data.results?.[0]?.artworkUrl100;
    return url ? url.replace("/100x100", "/600x600") : null;
  } catch {
    return null;
  }
}

async function embedArtwork(
  filePath: string,
  artUrl: string,
): Promise<boolean> {
  const tmp = filePath.replace(/(\.[^.]+)$/, ".art$1");
  const img = `${tmp}.jpg`;
  try {
    const res = await fetch(artUrl);
    if (!res.ok) return false;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 1000) return false;
    await Bun.write(img, buf);
    const args =
      extname(filePath).toLowerCase() === ".mp3" ? ["-id3v2_version", "3"] : [];
    const proc =
      await $`ffmpeg -y -hide_banner -loglevel error -i ${filePath} -i ${img} -map 0:a -map 1:v -c:a copy -c:v mjpeg -disposition:v:0 attached_pic ${args} ${tmp}`
        .quiet()
        .nothrow();
    if (proc.exitCode !== 0) return false;
    return (await $`mv -f ${tmp} ${filePath}`.quiet().nothrow()).exitCode === 0;
  } finally {
    await $`rm -f ${img}`.quiet().nothrow();
  }
}

async function walkAudio(
  dir: string,
  out: string[] = [],
  skip?: string[],
): Promise<string[]> {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (skip?.some((s) => full === s || full.startsWith(s + "/"))) continue;
      await walkAudio(full, out, skip);
    } else if (AUDIO_EXTS.has(extname(ent.name).toLowerCase())) out.push(full);
  }
  return out;
}

/**
 * Crude DJ "energy" rating (1–10) from integrated loudness — same idea as
 * Mixed In Key's energy column: how hard a track hits, for set planning.
 * RMS dBFS typical range -25 (chill) .. -8 (banger) mapped linearly.
 * rekordbox/MatchMySound do fancier analysis; this is a sortable baseline.
 */
export function energyFromLufs(rmsDb: number | null): number | null {
  if (rmsDb === null || Number.isNaN(rmsDb)) return null;
  const clamped = Math.min(-8, Math.max(-25, rmsDb));
  return Math.round((1 + ((clamped + 25) / 17) * 9) * 10) / 10;
}

async function measureRms(file: string): Promise<number | null> {
  const proc =
    await $`ffmpeg -hide_banner -nostats -i ${file} -af astats=measure_overall=RMS_level:measure_perchannel=none -f null -`
      .quiet()
      .nothrow();
  if (proc.exitCode !== 0) return null;
  const out = proc.stderr.toString();
  const m = /RMS level dB:\s*(-?[\d.]+)/.exec(out);
  return m?.[1] ? Number(m[1]) : null;
}

interface Record_ {
  file: string;
  size: number;
  probe: Probe;
  parsed: ParsedName;
  identity: string;
  score: number;
}

async function quarantine(
  file: string,
  quarantineDir: string,
  dryRun: boolean | undefined,
  log: (m: string) => void,
): Promise<void> {
  if (dryRun) {
    log(`  [dupe] would quarantine: ${basename(file)}`);
    return;
  }
  await mkdir(quarantineDir, { recursive: true });
  const dest = join(quarantineDir, basename(file));
  try {
    await rename(file, dest);
  } catch {
    await copyFile(file, dest); // cross-device fallback; original left in place
  }
}

export async function ingest(opts: IngestOptions): Promise<void> {
  const log = opts.onProgress ?? ((m: string) => console.log(m));
  const quarantineDir =
    opts.quarantineDir ?? join(opts.folder, "ingest-duplicates");
  const minDuration = opts.minDuration ?? 60;
  const queuedIdentity = new Set<string>();
  const files = await walkAudio(
    opts.folder,
    [],
    [quarantineDir, join(opts.musicDir, "rekordbox")],
  );
  log(`${files.length} audio file(s) under ${opts.folder}`);

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
  const queueEntries: string[] = [];

  for (const rec of toIngest) {
    const { file, probe, parsed } = rec;
    const ext = extname(file).toLowerCase();
    const title = firstTag(probe.tags, ["title"]) || parsed.title;
    let artist = firstTag(probe.tags, ["artist"]) || parsed.artist;
    let album = firstTag(probe.tags, ["album"]);
    let date = firstTag(probe.tags, ["date", "year"]);
    let genre = firstTag(probe.tags, ["genre"]);
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

    if (!artist || !album || !genre || genre === "Music") {
      if (title.length >= 4) {
        await sleep(1100); // MusicBrainz politeness
        const mb = await mbRecording(artist, title);
        artist = artist || mb.artist;
        if (!album && mb.album) album = mb.album;
        if (!date && mb.date) date = mb.date;
        if (!genre || genre === "Music")
          genre = inferGenre([genre, mb.artistTags, artist]);
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
      });
      tagged++;
    }

    // Energy rating (1-10): decode + RMS, ~0.5-2s per file. First pass only —
    // stored in the DB, never recomputed on re-ingest (archive dupe check
    // short-circuits before this).
    const energy = opts.dryRun ? null : energyFromLufs(await measureRms(file));

    // Artwork: embedded → SoundCloud (URL in tags) → iTunes. Never WAV.
    let artUrlFound: string | null = null;
    if (!probe.hasArt && !opts.noArtwork && artist) {
      if (!ARTWORK_EXTS.has(ext)) {
        artSkippedWav++;
      } else {
        const scUrl = soundcloudUrlInTags(probe.tags);
        const artUrl =
          (scUrl && (await soundcloudArtwork(scUrl))) ||
          (await itunesArtwork(artist, album ?? title));
        artUrlFound = artUrl;
        if (artUrl && !opts.dryRun && (await embedArtwork(file, artUrl))) {
          artAdded++;
          changes.push("artwork");
        }
      }
    }

    if (changes.length === 0) {
      unchanged++;
      log(`  = ok: ${basename(file)}`);
    } else {
      log(`  ~ ${basename(file)}: ${changes.join(", ")}`);
    }

    if (opts.dryRun) continue;

    // Register + copy into the music dir (unless already there).
    const extId = `ext-${createHash("sha1").update(file).digest("hex").slice(0, 12)}`;
    let destPath = join(opts.musicDir, basename(file));
    if (!file.startsWith(opts.musicDir)) {
      if (destPath !== file) {
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
      if (!ARTWORK_EXTS.has(ext)) {
        artSkippedWav++;
      } else if (queuedIdentity.has(rec.identity)) {
        // already in queue from an earlier run/file
      } else if (artUrlFound) {
        // artwork found but embedding failed — try again next run
        queuedIdentity.add(rec.identity);
        queueEntries.push(
          JSON.stringify({
            path: destPath,
            title,
            artist,
            album,
            reason: "embed-failed",
            sourceUrl: artUrlFound,
          }),
        );
        opts.state.updateArtworkStatus(extId, "queued");
        artQueued++;
      } else {
        queuedIdentity.add(rec.identity);
        queueEntries.push(
          JSON.stringify({
            path: destPath,
            title,
            artist,
            album,
            reason: "no-source-found",
            remixOf: remixOf?.original ?? null,
          }),
        );
        opts.state.updateArtworkStatus(extId, "queued");
        artQueued++;
      }
    }
  }

  if (queueEntries.length > 0 && !opts.dryRun) {
    const { appendFile, mkdir } = await import("node:fs/promises");
    await mkdir(opts.state.dbDir, { recursive: true });
    const queuePath = join(opts.state.dbDir, "artwork-queue.jsonl");
    await appendFile(queuePath, queueEntries.join("\n") + "\n", "utf8");
    log(`artwork queue: ${queueEntries.length} entr(ies) → ${queuePath}`);
  }

  log(
    `\ndone: ${tagged} retagged, ${artAdded} artwork embedded` +
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
}
