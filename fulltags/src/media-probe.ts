/**
 * FullTags probes — ffprobe audio inspection + filename parsing +
 * MusicBrainz lookup helpers. Migrated from src/commands/ingest-probe.ts
 * and src/commands/energy.ts so every enrichment concern lives here.
 */
import { $ } from "bun";

function finiteNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function isRecord(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === "object" && !Array.isArray(item);
}

function stringField(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  return typeof record[field] === "string" ? record[field] : undefined;
}

function hasOptionalString(
  record: Record<string, unknown>,
  field: string,
): boolean {
  return record[field] === undefined || typeof record[field] === "string";
}

/** Shared audio-file probe shape (ffprobe result). */
export interface Probe {
  ok: boolean;
  durationS: number | null;
  bitrateKbps: number | null;
  sampleRate: number | null;
  codec: string | null;
  hasArt: boolean;
  tags: Record<string, string>;
  /** ffprobe format_name split on commas (e.g. ["mov","mp4","m4a",…]). */
  container?: string[];
}

interface FfprobeJson {
  format: {
    duration: string | undefined;
    bitRate: string | undefined;
    tags: Record<string, unknown>;
    formatName: string | undefined;
  } | null;
  streams: {
    codecType: string | undefined;
    codecName: string | undefined;
    sampleRate: string | undefined;
  }[];
}

/** Guard ffprobe's JSON subprocess boundary. Null means malformed JSON or a
 * schema mismatch; probeFile exposes that as `ok: false`. */
export function parseFfprobeJson(stdout: string): FfprobeJson | null {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    void error;
    return null;
  }
  if (!isRecord(value)) return null;
  const formatRaw = value.format;
  if (formatRaw !== undefined && !isRecord(formatRaw)) return null;
  const streamsRaw = value.streams;
  if (streamsRaw !== undefined && !Array.isArray(streamsRaw)) return null;
  const rawStreams = streamsRaw ?? [];
  if (!rawStreams.every(isRecord)) return null;
  let format: FfprobeJson["format"] = null;
  if (isRecord(formatRaw)) {
    const tagsRaw = formatRaw.tags;
    if (
      (tagsRaw !== undefined && !isRecord(tagsRaw)) ||
      !["duration", "bit_rate", "format_name"].every((field) =>
        hasOptionalString(formatRaw, field),
      )
    )
      return null;
    format = {
      duration: stringField(formatRaw, "duration"),
      bitRate: stringField(formatRaw, "bit_rate"),
      tags: tagsRaw ?? {},
      formatName: stringField(formatRaw, "format_name"),
    };
  }
  if (
    !rawStreams.every((stream) =>
      ["codec_type", "codec_name", "sample_rate"].every((field) =>
        hasOptionalString(stream, field),
      ),
    )
  )
    return null;
  return {
    format,
    streams: rawStreams.map((stream) => ({
      codecType: stringField(stream, "codec_type"),
      codecName: stringField(stream, "codec_name"),
      sampleRate: stringField(stream, "sample_rate"),
    })),
  };
}

function failedProbe(): Probe {
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
  return finiteNumber(m?.[1]);
}

/** Structured result of `parseFilename`. */
export interface ParsedName {
  trackNo: number | null;
  artist: string | null;
  title: string;
}

/** Parse `NNN - Artist - Title.ext` / `Artist - Title.ext` / `Title.ext`.
 *  Recognizes quarantine-style junk prefixes first: a filename composed by
 *  an upstream tool as `UnknownArtist · UnknownAlbum · <real rest>` (and
 *  plain `UnknownArtist - ` variants) would otherwise parse "UnknownArtist"
 *  as the ARTIST and bake it into tags + search keys — Sep 11: 13 pool
 *  tracks searched SC for "UnknownArtist · UnknownAlbum · suspense of
 *  seas", matched junk, and all embedded the same pool banner. The prefix
 *  is stripped BEFORE the artist/title split so `<real rest>` parses. */
export function parseFilename(basename: string): ParsedName {
  let stem = basename.replace(/\.[^.]+$/, "");
  stem = stem.replace(
    /^(?:UnknownArtist\s*·\s*UnknownAlbum\s*·\s*|UnknownArtist\s*·\s*|UnknownArtist\s*-\s*|Unknown Artist\s*-\s*)/iu,
    "",
  );
  const numMatch = /^(\d{1,3})\s+-\s+(.+)$/.exec(stem);
  let rest = stem;
  let trackNo: number | null = null;
  if (numMatch) {
    trackNo = finiteNumber(numMatch[1]);
    rest = numMatch[2] ?? stem;
  }
  const parts = rest.split(/\s+-\s+/);
  if (parts.length >= 2) {
    const artistPart = parts[0]?.trim();
    const artistOk =
      !!artistPart && !/^unknown(\s*artist)?$/iu.test(artistPart);
    return {
      trackNo,
      artist: artistOk ? artistPart : null,
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
    return failedProbe();
  }
  const stdout =
    typeof proc.stdout === "string" ? proc.stdout : proc.stdout.toString();
  const data = parseFfprobeJson(stdout);
  if (!data) return failedProbe();
  const formatTags = data.format?.tags ?? {};
  const tags: Record<string, string> = {};
  for (const k of Object.keys(formatTags)) {
    const v = formatTags[k];
    if (v == null) continue;
    tags[k.toLowerCase()] = String(v).trim();
  }
  const streams = data.streams;
  const audio = streams.find((s) => s.codecType === "audio");
  const duration = finiteNumber(data.format?.duration);
  const bitrate = finiteNumber(data.format?.bitRate);
  return {
    ok: true,
    durationS: duration,
    bitrateKbps: bitrate === null ? null : Math.round(bitrate / 1000),
    sampleRate: finiteNumber(audio?.sampleRate),
    codec: audio?.codecName ?? null,
    hasArt: streams.some((s) => s.codecType === "video"),
    tags,
    // Container truth vs extension: pool rips ship AAC audio in MP4
    // containers wearing a `.mp3` name (Sep 11: 14 rescue files). ffmpeg's
    // mp3 muxer rejects non-MP3 audio with exit 234, and Pioneer hardware
    // chokes on the mislabel too — the writer and ingest both need the
    // real container, not the filename's claim.
    container: data.format?.formatName?.split(",").map((s) => s.trim()) ?? [],
  };
}

/** The real audio container implied by ffprobe's format_name — the caller
 *  compares against the file's extension and renames only on mismatch
 *  (`.mp3` in → `.mp3` out is the honest-file case). Null when the container
 *  isn't one we can name confidently — never guess a rename. */
export function trueContainerExt(p: Probe): string | null {
  const fmt = p.container ?? [];
  if (fmt.includes("mp3")) return ".mp3";
  if (fmt.includes("mov")) return ".m4a"; // mov,mp4,m4a,3gp,3g2,mj2 family
  if (fmt.includes("flac")) return ".flac";
  if (fmt.includes("aiff")) return ".aiff";
  if (fmt.includes("wav")) return ".wav";
  return null;
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
