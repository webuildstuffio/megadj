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
import { mutagenJson } from "./mutagen";

export interface Truth {
  art: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: string | null;
  comment: string | null;
  bpm: number | null;
  key: string | null;
  /** Raw TXXX:MOOD "k=v; …" stamp — presence gates the mood stage. */
  mood: string | null;
  /** DJ energy 1–10 (TXXX:ENERGY) — null when absent. */
  energy: number | null;
  /** Record label (TPUB / freeform LABEL) — filled by Beatport/MB writes.
   * Read back so a label-carrying file is never re-filled (idempotency). */
  label: string | null;
  /** Mix name (TIT3 / freeform MIXNAME) — "Club Mix", "Original Mix". */
  mixName: string | null;
  /** ISRC (TSRC / freeform ISRC) — store-grade recording identity. */
  isrc: string | null;
  /** Official remixer credit (TXXX:version / freeform REMIXER) — read
   * back so a credited file is never re-filled (idempotency). */
  remixer: string | null;
  /** Track duration in whole seconds (ffprobe format.duration) — the
   * Beatport scorer's ±2 s / ±10 s signal. Null when unreadable. */
  durationS: number | null;
}

interface FfprobeJson {
  tags: Record<string, string>;
  hasVideo: boolean;
  durationS: number | null;
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
    const j = JSON.parse(new TextDecoder().decode(pr.stdout)) as {
      streams?: Array<{ codec_type?: string; codec_name?: string }>;
      format?: { tags?: Record<string, string>; duration?: string };
    };
    const hasVideo = (j.streams ?? []).some(
      (s) =>
        s.codec_type === "video" &&
        ["png", "mjpeg"].includes(s.codec_name ?? ""),
    );
    const durRaw = j.format?.duration ? Number(j.format.duration) : NaN;
    return {
      tags: j.format?.tags ?? {},
      hasVideo,
      durationS:
        Number.isFinite(durRaw) && durRaw > 0 ? Math.round(durRaw) : null,
    };
  } catch (e) {
    // Empty tags are legit (untagged file); a PARSE failure means ffprobe
    // answered something we can't trust — that difference feeds the audit
    // gate, so it must not read as "untagged". Log at the boundary; the
    // empty result still degrades the same way downstream.
    console.error(`ffprobe JSON unparsable for ${p}`, e);
    return { tags: {}, hasVideo: false, durationS: null };
  }
}

/** Mutagen read for WAV (ID3-in-RIFF) and MP3 (ID3v2), JSON over stdout. */
function mutagenRead(p: string): {
  art: boolean;
  tags: Record<string, string>;
} {
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
  const parsed = mutagenJson<
    Partial<{
      art: boolean;
      tags: Record<string, string>;
    }>
  >(script, {});
  return { art: parsed.art === true, tags: parsed.tags ?? {} };
}

const TRUTH_KEY: Record<string, string> = {
  TIT2: "title",
  TPE1: "artist",
  TALB: "album",
  TCON: "genre",
  TDRC: "date",
  COMM: "comment",
  TBPM: "TBPM",
  TKEY: "TKEY",
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
  const bpmRaw = g("TBPM", "bpm", "tmpo");
  const bpm = bpmRaw ? Number(bpmRaw.split(/[.,;]/)[0]) : NaN;
  const energyRaw = g("ENERGY");
  const energy = energyRaw ? Number(energyRaw) : NaN;
  // ID3 renders TXXX:version as "version" through ffprobe; mutagen keeps
  // the literal "TXXX:version" key. Both are the REMIXER frame (the
  // writer's every path maps remixer → version) — never a mix name, so
  // the mixName probe must not include it (a remixer-only file used to
  // read its remixer string as mixName and block a Beatport mix fill).
  const remixer = g("version", "REMIXER", "remixer");
  return {
    art,
    durationS: ff.durationS,
    title: g("title"),
    artist: g("artist"),
    album: g("album"),
    genre,
    year,
    comment: g("comment"),
    bpm: Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm) : null,
    key: g("TKEY", "initial_key", "initialkey", "CAMELOT"),
    mood: g("MOOD"),
    energy: Number.isFinite(energy) ? energy : null,
    // ID3 renders TPUB as "publisher" through ffprobe; flac keeps "TPUB".
    label: g("publisher", "TPUB", "tpub", "LABEL", "label"),
    mixName: g("TIT3", "tit3", "MIXNAME", "mixname"),
    remixer,
    isrc: g("TSRC", "tsrc", "ISRC", "isrc", "ISRC:", "isrc:"),
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
    remixer: t.remixer,
    grouping: null,
    composer: null,
    label: t.label,
    mixName: t.mixName,
    comment: t.comment,
    bpm: t.bpm,
    key: t.key,
    energy: t.energy,
    mbid: null,
    fingerprint: null,
    mood: t.mood,
    isrc: t.isrc,
    art: t.art,
  };
}
