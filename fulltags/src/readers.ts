/**
 * FullTags readers — ground-truth tag/art reads per format. Everything
 * downstream (audit, pipeline, upgrade verification) trusts these reads
 * over any DB row: the FILE is the truth.
 *
 * WAV: ffprobe can't see the ID3 chunk's frames → mutagen read merges in.
 * MP3: mutagen read (ffprobe's mp3 tag surface is lossy).
 * Others: ffprobe JSON.
 */
import { extname } from "node:path";
import type { FullTag } from "./schema";

export interface Truth {
  art: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: string | null;
  comment: string | null;
}

interface FfprobeJson {
  tags: Record<string, string>;
  hasVideo: boolean;
}

function ffprobeJson(p: string): FfprobeJson {
  const pr = Bun.spawnSync({
    cmd: [
      "ffprobe",
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      p,
    ],
    stdout: "pipe",
  });
  try {
    const j = JSON.parse(new TextDecoder().decode(pr.stdout));
    const hasVideo = (j.streams ?? []).some(
      (s: any) =>
        s.codec_type === "video" && ["png", "mjpeg"].includes(s.codec_name),
    );
    return { tags: j.format?.tags ?? {}, hasVideo };
  } catch {
    return { tags: {}, hasVideo: false };
  }
}

/** Mutagen read for WAV (ID3-in-RIFF) and MP3 (ID3v2), JSON over stdout. */
function mutagenRead(p: string): { art: boolean; tags: Record<string, string> } {
  const script = `import json, sys
p = ${JSON.stringify(p)}
tags, art = {}, False
if p.lower().endswith(".wav"):
    from mutagen.wave import WAVE
    a = WAVE(p)
    if a.tags:
        for k in a.tags.keys():
            try:
                frame = a.tags.get(k)
                if k.startswith("APIC"):
                    art = True
                    continue
                v = str(frame.text[0]) if k.startswith("COMM") and frame.text else str(frame)
                tags[k.split(":")[0]] = v
            except Exception:
                pass
else:
    from mutagen.mp3 import MP3
    a = MP3(p)
    if a.tags:
        for k, v in a.tags.items():
            try:
                tags[k] = str(v.text[0]) if hasattr(v, "text") and v.text else str(v)
            except Exception:
                pass
        art = bool(a.tags.getall("APIC"))
print(json.dumps({"art": art, "tags": tags}))`;
  const pr = Bun.spawnSync({
    cmd: ["uv", "run", "--with", "mutagen", "python", "-c", script],
    stdout: "pipe",
  });
  try {
    const last = new TextDecoder().decode(pr.stdout).trim().split("\n").at(-1);
    if (!last) throw new Error("empty");
    return JSON.parse(last);
  } catch {
    return { art: false, tags: {} };
  }
}

const TRUTH_KEY: Record<string, string> = {
  TIT2: "title",
  TPE1: "artist",
  TALB: "album",
  TCON: "genre",
  TDRC: "date",
  COMM: "comment",
};

/** Ground-truth read of a file's tags + art presence. Never throws. */
export function groundTruth(p: string): Truth {
  const ext = extname(p).toLowerCase();
  const isWav = ext === ".wav";
  const isMp3 = ext === ".mp3";
  const ff = ffprobeJson(p);
  let art = ff.hasVideo;
  const merged: Record<string, string> = { ...ff.tags };
  if (isWav || isMp3) {
    const m = mutagenRead(p);
    if (m.art) art = true;
    for (const [k, v] of Object.entries(m.tags)) {
      const key = TRUTH_KEY[k] ?? k.toLowerCase();
      if (!merged[key]) merged[key] = v;
    }
  }
  const g = (...keys: string[]) => {
    for (const k of keys) {
      const v = merged[k] ?? merged[k.toLowerCase()];
      if (v && String(v).trim()) return String(v).trim();
    }
    return null;
  };
  let genre = g("genre");
  if (genre && genre.includes(",")) genre = genre.split(",")[0]?.trim() ?? null;
  const rawDate = g("date", "year", "TDRC");
  const year = rawDate ? (rawDate.match(/\d{4}/)?.[0] ?? null) : null;
  return {
    art,
    title: g("title"),
    artist: g("artist"),
    album: g("album"),
    genre,
    year,
    comment: g("comment"),
  };
}

/** Full-tag read: everything FullTags manages, from the file itself. */
export function readFullTag(p: string): FullTag {
  const t = groundTruth(p);
  return {
    title: t.title,
    artist: t.artist,
    albumArtist: null,
    album: t.album,
    genre: t.genre,
    year: t.year,
    remixer: null,
    grouping: null,
    composer: null,
    comment: t.comment,
    bpm: null,
    key: null,
    energy: null,
    mbid: null,
    art: t.art,
  };
}
