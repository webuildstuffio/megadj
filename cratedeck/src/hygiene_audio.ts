// hygiene_audio.ts — the A/B compare backend for the Hygiene tab's
// ear-check queue (docs/shelf-hygiene-2026-09-09.md §4.1). Two routes:
//
//   GET /api/hygiene/audio?path=…  → the audio file itself (streamed)
//   GET /api/hygiene/stats?path=…  → ffprobe sidecar (duration/bitrate/
//                                    codec/sample-rate), cached in
//                                    memory for the server's lifetime
//
// SAFETY RAIL (this route hands arbitrary bytes to a browser tab):
// a path is servable ONLY when it (a) resolves under the SHELF mount,
// (b) has an audio extension, (c) does not contain a `..` segment, and
// (d) exists as a regular file. Findings store absolute paths, so the
// UI round-trips them — anything else is a 403, never a partial read.
import { statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

const AUDIO_EXT = new Set([
  ".aiff",
  ".aif",
  ".wav",
  ".mp3",
  ".flac",
  ".m4a",
  ".aac",
  ".alac",
]);

export interface AudioStats {
  path: string;
  exists: boolean;
  bytes: number;
  /** seconds, 1 decimal — from ffprobe; null when unavailable */
  durationS: number | null;
  bitrateKbps: number | null;
  codec: string | null;
  sampleRate: number | null;
  error?: string | undefined;
}

/** The guard every route in this module goes through first. Returns the
 *  resolved path or null (null → caller answers 403). */
export function servableAudioPath(
  raw: string | null,
  shelfRoot: string,
): string | null {
  if (!raw || raw.includes("..")) return null;
  const ext = extname(raw).toLowerCase();
  if (!AUDIO_EXT.has(ext)) return null;
  let p: string;
  try {
    p = resolve(raw);
  } catch {
    return null;
  }
  const root = resolve(shelfRoot) + sep;
  if (!p.startsWith(root)) return null;
  try {
    if (!statSync(p).isFile()) return null;
  } catch {
    return null;
  }
  return p;
}

const statsCache = new Map<string, AudioStats>();

/** ffprobe sidecar for one file. Cached per path for the server's
 *  lifetime — findings are stable between scans, so one probe is enough
 *  (a re-scan that changes the path changes the key). ffprobe is bound:
 *  a missing/failed probe degrades to nulls, never throws. */
export function audioStats(path: string): AudioStats {
  const hit = statsCache.get(path);
  if (hit) return hit;
  let out: AudioStats;
  try {
    const bytes = statSync(path).size;
    const r = Bun.spawnSync([
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration,bit_rate:stream=codec_name,sample_rate",
      "-of",
      "json",
      path,
    ]);
    if (r.exitCode !== 0) {
      out = {
        path,
        exists: true,
        bytes,
        durationS: null,
        bitrateKbps: null,
        codec: null,
        sampleRate: null,
        error: r.stderr.toString().trim().slice(0, 200) || "ffprobe failed",
      };
    } else {
      const j = JSON.parse(r.stdout.toString()) as {
        format?: { duration?: string; bit_rate?: string };
        streams?: Array<{ codec_name?: string; sample_rate?: string }>;
      };
      const s = j.streams?.[0];
      out = {
        path,
        exists: true,
        bytes,
        durationS: j.format?.duration
          ? Math.round(Number(j.format.duration) * 10) / 10
          : null,
        bitrateKbps: j.format?.bit_rate
          ? Math.round(Number(j.format.bit_rate) / 1000)
          : null,
        codec: s?.codec_name ?? null,
        sampleRate: s?.sample_rate ? Number(s.sample_rate) : null,
      };
    }
  } catch (e) {
    out = {
      path,
      exists: false,
      bytes: 0,
      durationS: null,
      bitrateKbps: null,
      codec: null,
      sampleRate: null,
      error: e instanceof Error ? e.message : "stat failed",
    };
  }
  statsCache.set(path, out);
  return out;
}

/** Bound the cache — findings come and go; the map shouldn't outlive a
 *  reasonable working set (100k entries would be ~10MB worst case). */
export function pruneStatsCache(max = 20_000): void {
  if (statsCache.size <= max) return;
  const drop = statsCache.size - max;
  let i = 0;
  for (const k of statsCache.keys()) {
    if (i++ >= drop) break;
    statsCache.delete(k);
  }
}

/** The audio response. Bun.file streams lazily (no full read into
 *  memory); Range requests ride Bun's built-in support so the <audio>
 *  element can scrub. */
export function audioResponse(path: string): Response {
  return new Response(Bun.file(path), {
    headers: {
      "Content-Type": audioMime(extname(path).toLowerCase()),
      "Cache-Control": "no-store",
    },
  });
}

function audioMime(ext: string): string {
  switch (ext) {
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".flac":
      return "audio/flac";
    case ".m4a":
    case ".aac":
    case ".alac":
      return "audio/mp4";
    default:
      return "audio/aiff"; // .aiff/.aif
  }
}

/** Row label for the compare card: "3:42 · 1411 kbps · wav 44.1kHz". */
export function statsLine(s: AudioStats): string {
  if (!s.exists) return "file missing";
  const parts: string[] = [];
  if (s.durationS !== null) {
    const m = Math.floor(s.durationS / 60);
    const sec = Math.round(s.durationS % 60);
    parts.push(`${m}:${String(sec).padStart(2, "0")}`);
  }
  if (s.bitrateKbps !== null) parts.push(`${s.bitrateKbps} kbps`);
  if (s.codec) {
    parts.push(
      s.sampleRate
        ? `${s.codec} ${(s.sampleRate / 1000).toFixed(1).replace(/\.0$/, "")}kHz`
        : s.codec,
    );
  }
  return parts.join(" · ") || "no metadata";
}
