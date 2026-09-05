/**
 * Ingest plumbing: file probing, filename parsing, dedupe scoring,
 * MusicBrainz lookup, directory walking, and quarantine. Split out of
 * ingest.ts (file-length gate) — pure helpers, no pipeline logic.
 */
import { $ } from "bun";
import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rename } from "node:fs/promises";
import type { Probe } from "./probe-types";

const MB_UA = "megadj/0.1 (https://github.com/megadj/megadj)";

export const LOSSLESS = new Set([".wav", ".flac", ".aiff", ".aif"]);

const AUDIO_EXTS = new Set([".m4a", ".mp3", ".wav", ".flac", ".aiff", ".aif"]);

export interface ParsedName {
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

export async function probeFile(path: string): Promise<Probe> {
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
  const formatTags = data.format?.tags ?? {};
  const tags: Record<string, string> = {};
  for (const k of Object.keys(formatTags)) {
    const v = formatTags[k];
    if (v == null) continue;
    tags[k.toLowerCase()] = String(v).trim();
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

export function firstTag(
  tags: Record<string, string>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = tags[k];
    if (v) return v;
  }
  return null;
}

export interface Record_ {
  file: string;
  size: number;
  probe: Probe;
  parsed: ParsedName;
  identity: string;
  score: number;
}

/** Move a duplicate out of the intake folder (never deletes audio). */
export async function quarantine(
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
  if (!existsSync(file)) {
    log(`  [dupe] already gone (handled earlier): ${basename(file)}`);
    return;
  }
  try {
    await rename(file, dest);
  } catch {
    await copyFile(file, dest); // cross-device fallback; original left in place
  }
}

/** Recursively list audio files under `dir`, skipping hidden entries. */
export async function walkAudio(
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
    } else if (AUDIO_EXTS.has(ent.name.replace(/^.*\./, ".").toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

/** MusicBrainz recording lookup — fills missing artist/album/date (1 rps). */
export async function mbRecording(
  artist: string | null,
  title: string,
): Promise<{
  artist: string | null;
  album: string | null;
  date: string | null;
  artistTags: string;
  mbid: string | null;
}> {
  const q = artist
    ? `artist:"${encodeURIComponent(artist)}" AND recording:"${encodeURIComponent(title)}"`
    : `recording:"${encodeURIComponent(title)}"`;
  const url = `https://musicbrainz.org/ws/2/recording/?query=${q}&fmt=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": MB_UA } });
    if (!res.ok)
      return {
        artist: null,
        album: null,
        date: null,
        artistTags: "",
        mbid: null,
      };
    const data = (await res.json()) as {
      recordings?: Array<{
        id?: string;
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
      .slice(0, 3);
    return {
      artist: mbArtist,
      album: rel?.title ?? null,
      date: rel?.date ?? null,
      artistTags: tags.join(","),
      mbid: rec?.id ?? null,
    };
  } catch {
    return {
      artist: null,
      album: null,
      date: null,
      artistTags: "",
      mbid: null,
    };
  }
}
