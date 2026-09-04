/**
 * megadj ingest — bring external downloads (Bandcamp rips, friends' folders,
 * loose mp3s) into the archive with complete tags + embedded artwork, ready
 * for rekordbox. The scripted equivalent of a Picard lookup pass:
 *
 *  1. Probe every file (broken/zero-byte files are reported, never moved).
 *  2. Merge existing ID3/MP4 tags with `Artist - Title` filename parsing.
 *  3. MusicBrainz recording lookup fills missing album/date (1 rps, polite).
 *  4. Missing artwork is fetched from the iTunes Search API and embedded.
 *  5. Genre via the shared inferGenre + MusicBrainz artist tags (as enrich).
 *  6. Tagged files are copied into the music dir (sources never touched) and
 *     registered in the state DB so `organize` / USB sync pick them up.
 */

import { $ } from "bun";
import { createHash } from "node:crypto";
import { readdir, stat, copyFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import type { ArchiveState } from "../state";
import { applyTags, inferGenre, sanitizeGenreFolder } from "../metadata";

export interface IngestOptions {
  state: ArchiveState;
  musicDir: string;
  folder: string;
  dryRun?: boolean;
  noArtwork?: boolean;
  onProgress?: (msg: string) => void;
}

const AUDIO_EXTS = new Set([".m4a", ".mp3", ".wav", ".flac", ".aiff", ".aif"]);
const MB_UA = "megadj/0.1 (https://github.com/megadj/megadj)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const artistPart = typeof parts[0] === "string" ? parts[0].trim() : "";
    return {
      trackNo,
      artist: artistPart || null,
      title: parts.slice(1).join(" - ").trim(),
    };
  }
  return { trackNo, artist: null, title: rest.trim() };
}

interface Probe {
  ok: boolean;
  durationS: number | null;
  bitrateKbps: number | null;
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
      codec: null,
      hasArt: false,
      tags: {},
    };
  }
  const stdout =
    typeof proc.stdout === "string"
      ? proc.stdout
      : proc.stdout instanceof Uint8Array
        ? new TextDecoder().decode(proc.stdout)
        : String(proc.stdout ?? "");
  const data = JSON.parse(stdout) as {
    format?: {
      duration?: string;
      bit_rate?: string;
      tags?: Record<string, string>;
    };
    streams?: Array<{ codec_type?: string; codec_name?: string }>;
  };
  const tags: Record<string, string> = {};
  const formatTags = data.format?.tags ?? {};
  for (const k of Object.keys(formatTags)) {
    tags[k.toLowerCase()] = String(formatTags[k]).trim();
  }
  const streams = data.streams ?? [];
  return {
    ok: true,
    durationS: data.format?.duration ? Number(data.format.duration) : null,
    bitrateKbps: data.format?.bit_rate
      ? Math.round(Number(data.format.bit_rate) / 1000)
      : null,
    codec: streams.find((s) => s.codec_type === "audio")?.codec_name ?? null,
    hasArt: streams.some((s) => s.codec_type === "video"),
    tags,
  };
}

function firstTag(tags: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = tags[k];
    if (v) return v;
  }
  return null;
}

async function mbRecording(
  artist: string,
  title: string,
): Promise<{ album: string | null; date: string | null; artistTags: string }> {
  const url =
    `https://musicbrainz.org/ws/2/recording/?query=artist:"${encodeURIComponent(artist)}"` +
    ` AND recording:"${encodeURIComponent(title)}"&fmt=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": MB_UA } });
    if (!res.ok) return { album: null, date: null, artistTags: "" };
    const data = (await res.json()) as {
      recordings?: Array<{
        releases?: Array<{ title?: string; date?: string }>;
        "artist-credit"?: Array<{
          artist?: { tags?: Array<{ name: string; count: number }> };
        }>;
      }>;
    };
    const rec = data.recordings?.[0];
    const rel = rec?.releases?.[0];
    const tags = (rec?.["artist-credit"]?.[0]?.artist?.tags ?? [])
      .sort((a, b) => b.count - a.count)
      .map((t) => t.name)
      .join(" ");
    return {
      album: rel?.title ?? null,
      date: rel?.date?.slice(0, 4) ?? null,
      artistTags: tags,
    };
  } catch {
    return { album: null, date: null, artistTags: "" };
  }
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

async function walkAudio(dir: string, out: string[] = []): Promise<string[]> {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) await walkAudio(full, out);
    else if (AUDIO_EXTS.has(extname(ent.name).toLowerCase())) out.push(full);
  }
  return out;
}

export async function ingest(opts: IngestOptions): Promise<void> {
  const log = opts.onProgress ?? ((m: string) => console.log(m));
  const files = await walkAudio(opts.folder);
  log(`${files.length} audio file(s) under ${opts.folder}`);

  let tagged = 0;
  let artAdded = 0;
  let broken = 0;
  let unchanged = 0;
  const brokenFiles: string[] = [];

  for (const file of files) {
    const name = basename(file);
    const st = await stat(file);
    const probe = await probeFile(file);
    if (!st.size || !probe.ok) {
      broken++;
      brokenFiles.push(name);
      log(`  ✗ broken/zero-byte: ${name}`);
      continue;
    }

    const parsed = parseFilename(name);
    const title = firstTag(probe.tags, ["title"]) || parsed.title;
    const artist = firstTag(probe.tags, ["artist"]) || parsed.artist;
    let album = firstTag(probe.tags, ["album"]);
    let date = firstTag(probe.tags, ["date", "year"]);
    let genre = firstTag(probe.tags, ["genre"]);

    // MusicBrainz fill for missing album/date + genre signal (1 rps).
    if (artist && (!album || !genre || genre === "Music")) {
      await sleep(1100);
      const mb = await mbRecording(artist, title);
      if (!album && mb.album) album = mb.album;
      if (!date && mb.date) date = mb.date;
      if (!genre || genre === "Music")
        genre = inferGenre([genre, mb.artistTags, parsed.artist]);
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

    if (!opts.dryRun && changes.length > 0) {
      await applyTags(file, {
        title,
        artist,
        albumArtist: artist && album ? artist : null,
        album,
        genre,
        date,
        composer: null,
        comment: firstTag(probe.tags, ["comment"]),
        bpm: null,
      });
      tagged++;
    }

    if (!probe.hasArt && !opts.noArtwork && artist) {
      const artUrl = await itunesArtwork(artist, album ?? title);
      if (artUrl && !opts.dryRun && (await embedArtwork(file, artUrl))) {
        artAdded++;
        changes.push("artwork");
      }
    }

    if (changes.length === 0) {
      unchanged++;
      log(`  = ok: ${name}`);
    } else {
      log(`  ~ ${name}: ${changes.join(", ")}`);
    }

    // Register + copy into the music dir (unless ingest already runs there).
    if (!opts.dryRun) {
      const extId = `ext-${createHash("sha1").update(file).digest("hex").slice(0, 12)}`;
      let destPath = join(opts.musicDir, name);
      if (!file.startsWith(opts.musicDir)) {
        if (destPath !== file) {
          try {
            const destStat = await stat(destPath);
            if (destStat.size !== st.size) {
              destPath = join(
                opts.musicDir,
                name.replace(/(\.[^.]+)$/, " (ingest)$1"),
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
        fileSizeBytes: st.size,
        durationS: probe.durationS,
      });
    }
  }

  log(
    `\ndone: ${tagged} retagged, ${artAdded} artwork embedded, ${unchanged} already clean` +
      (broken ? `, ${broken} BROKEN (left in place)` : ""),
  );
  if (opts.dryRun) log("(dry run — nothing written)");
  if (brokenFiles.length > 0)
    log(`broken files:\n  ${brokenFiles.join("\n  ")}`);
}
