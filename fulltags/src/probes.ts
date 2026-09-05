/**
 * FullTags probes — ffprobe audio inspection + filename parsing +
 * MusicBrainz lookup helpers. Migrated from src/commands/ingest-probe.ts
 * and src/commands/energy.ts so every enrichment concern lives here.
 */
import { $ } from "bun";

const MB_UA = "megadj/0.1 (https://github.com/megadj/megadj)";

export const LOSSLESS = new Set([".wav", ".flac", ".aiff", ".aif"]);

/** Shared audio-file probe shape (ffprobe result). */
export interface Probe {
  ok: boolean;
  durationS: number | null;
  bitrateKbps: number | null;
  sampleRate: number | null;
  codec: string | null;
  hasArt: boolean;
  tags: Record<string, string>;
}

/** DJ energy 1–10 from integrated loudness (Mixed In Key style baseline).
 * RMS dBFS typical range -25 (chill) .. -8 (banger), mapped linearly. */
export function energyFromLufs(rmsDb: number | null): number | null {
  if (rmsDb === null || Number.isNaN(rmsDb)) return null;
  const clamped = Math.min(-8, Math.max(-25, rmsDb));
  return Math.round((1 + ((clamped + 25) / 17) * 9) * 10) / 10;
}

/** Integrated RMS level (dBFS) via ffmpeg astats; null on failure.
 *  `-map 0:a` is NOT optional: art-embedded files carry a cover-video
 *  stream (the APIC/mjpeg chunk), and when it's left in the default
 *  stream selection ffmpeg decodes it into the astats graph, fails the
 *  decode, and exits non-zero — measureRms returned null for every
 *  art-embedded track (4 real archive WAVs lost their energy stamp to
 *  this). Mapping the audio stream explicitly sidesteps the junk. */
export async function measureRms(file: string): Promise<number | null> {
  const proc =
    await $`ffmpeg -hide_banner -nostats -i ${file} -map 0:a -af astats=measure_overall=RMS_level:measure_perchannel=none -f null -`
      .quiet()
      .nothrow();
  if (proc.exitCode !== 0) return null;
  const out = proc.stderr.toString();
  const m = /RMS level dB:\s*(-?[\d.]+)/.exec(out);
  return m?.[1] ? Number(m[1]) : null;
}

/** Structured result of `parseFilename`. */
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

/** ffprobe a file: duration, bitrate, codec, art presence, lowercase tags. */
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
  // ffprobe reports raw PCM codec names — AIFF is pcm_s16be/big-endian and
  // hi-res WAV is pcm_s24le/32le: all lossless, all previously scored ZERO
  // lossless bonus (only pcm_s16le mapped), so an AIFF master lost its
  // dupe-resolution to any 16-bit WAV.
  const LOSSLESS_CODECS = new Set([
    "flac",
    "wav",
    "pcm_s16le",
    "pcm_s24le",
    "pcm_s32le",
    "pcm_s16be",
    "pcm_s24be",
    "pcm_s32be",
    "alac",
  ]);
  const lossless = p.codec && LOSSLESS_CODECS.has(p.codec) ? 1e9 : 0;
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
