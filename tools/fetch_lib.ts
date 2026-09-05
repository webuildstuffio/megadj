/**
 * fetch_lib.ts — shared plumbing for fetch_all.ts:
 * config, DB access, ground-truth file readers, tag writers,
 * SoundCloud search, and every artwork source.
 */
import { Database } from "bun:sqlite";
import {
  existsSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, basename } from "node:path";

const home = process.env.HOME!;
export const ARCH = `${home}/Music/DJ-Imports`;
export const QUEUE = `${home}/.local/state/megadj/artwork-queue.jsonl`;
export const db = new Database(`${home}/.local/state/megadj/archive.db`);
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
};
export const AI_MODEL = "google/gemini-2.5-flash-lite"; // cheapest solid

export interface Row {
  video_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  file_path: string;
  format_id: string | null;
}

// ---------- ground truth ----------
export function archiveFiles(): Set<string> {
  return new Set(
    readdirSync(ARCH).filter(
      (f) => !f.startsWith(".") && /\.(wav|mp3|m4a|flac|aiff)$/i.test(f),
    ),
  );
}

function ffprobeJson(p: string): {
  tags: Record<string, string>;
  hasVideo: boolean;
} {
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

function wavArtAndTags(p: string): {
  art: boolean;
  tags: Record<string, string>;
} {
  const script = `import json
from mutagen.wave import WAVE
a = WAVE(${JSON.stringify(p)})
tags, art = {}, False
if a.tags:
    for k in a.tags.keys():
        try:
            frame = a.tags.get(k)
            if k.startswith("COMM"):
                v = str(frame.text[0]) if frame.text else ""
            elif k.startswith("APIC"):
                continue
            else:
                v = str(frame)
            tags[k.split(":")[0]] = v
        except Exception:
            pass
    art = any(k.startswith("APIC") for k in a.tags.keys())
print(json.dumps({"art": art, "tags": tags}))`;
  const pr = Bun.spawnSync({
    cmd: ["uv", "run", "--with", "mutagen", "python", "-c", script],
    stdout: "pipe",
  });
  try {
    const lastLine =
      new TextDecoder().decode(pr.stdout).trim().split("\n").at(-1) ?? "";
    return JSON.parse(lastLine) as {
      art: boolean;
      tags: Record<string, string>;
    };
  } catch {
    return { art: false, tags: {} };
  }
}

export interface Truth {
  art: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: string | null;
  comment: string | null;
}

export function groundTruth(p: string): Truth {
  const isWav = p.toLowerCase().endsWith(".wav");
  const ff = ffprobeJson(p);
  let art = ff.hasVideo;
  const merged: Record<string, string> = { ...ff.tags };
  if (isWav) {
    const w = wavArtAndTags(p);
    if (w.art) art = true;
    for (const [k, v] of Object.entries(w.tags)) {
      const key =
        {
          TIT2: "title",
          TPE1: "artist",
          TALB: "album",
          TCON: "genre",
          TDRC: "date",
          COMM: "comment",
        }[k] ?? k.toLowerCase();
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
  if (genre && genre.includes(",")) {
    genre = genre.split(",")[0]?.trim() || genre;
  }
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

// ---------- helpers ----------
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

export async function fetchImage(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, {
      headers: UA,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const b = new Uint8Array(await res.arrayBuffer());
    return b.length > 3000 ? b : null;
  } catch {
    return null;
  }
}

export async function pageOgImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: UA,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return (
      html.match(/property="og:image"\s+content="([^"]+)"/)?.[1] ??
      html.match(/content="([^"]+)"\s+property="og:image"/)?.[1] ??
      null
    );
  } catch {
    return null;
  }
}

/** SC CDN: prefer -original, fall back to the given URL. */
export async function fetchBestScArt(
  ogUrl: string,
): Promise<Uint8Array | null> {
  const orig = ogUrl
    .replace(/-t500x500\.jpg/, "-original.jpg")
    .replace(/-large\.jpg/, "-original.jpg")
    .replace(/-badge\.(jpg|png)/, "-original.$1");
  if (orig !== ogUrl) {
    const b = await fetchImage(orig);
    if (b) return b;
  }
  return fetchImage(ogUrl);
}

// ---------- embedding ----------
export function embedArt(p: string, bytes: Uint8Array): boolean {
  const dump = p + ".fa.jpg";
  writeFileSync(dump, bytes);
  let ok = false;
  if (p.toLowerCase().endsWith(".wav")) {
    const script = `from mutagen.wave import WAVE
from mutagen.id3 import ID3, APIC
a = WAVE(${JSON.stringify(p)})
if a.tags and any(k.startswith("APIC") for k in a.tags.keys()):
    a.tags.delall("APIC")
try:
    a.add_tags()
except Exception:
    pass
if not isinstance(a.tags, ID3):
    a.tags = ID3()
a.tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=open(${JSON.stringify(dump)}, "rb").read()))
a.save()
print("ok")`;
    const pr = Bun.spawnSync({
      cmd: ["uv", "run", "--with", "mutagen", "python", "-c", script],
      stdout: "pipe",
    });
    ok = new TextDecoder().decode(pr.stdout).trim() === "ok";
  } else {
    const tmp = p + ".fa";
    const pr = Bun.spawnSync({
      cmd: [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        p,
        "-i",
        dump,
        "-map",
        "0:a",
        "-map",
        "1:v",
        "-c:a",
        "copy",
        "-c:v",
        "mjpeg",
        "-disposition:v:0",
        "attached_pic",
        tmp,
      ],
      stdout: "pipe",
    });
    ok = pr.exitCode === 0;
    if (ok) renameSync(tmp, p);
    else if (existsSync(tmp)) unlinkSync(tmp);
  }
  unlinkSync(dump);
  return ok;
}

/** Tag fields the pipeline manages. `year` = release year of THIS file's
 * version (for edits/remixes: the remix year, NOT the original's). */
export interface TagValues {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  comment?: string;
}

const WAV_ID3: Record<keyof TagValues, string> = {
  title: "TIT2",
  artist: "TPE1",
  album: "TALB",
  genre: "TCON",
  year: "TDRC",
  comment: "COMM",
};

/** Runtime validator — throws with a precise message on bad input. */
export function validateTagValues(vals: TagValues): void {
  for (const [k, v] of Object.entries(vals) as [keyof TagValues, unknown][]) {
    if (v === undefined) continue;
    if (k === "year") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1900 || v > 2100)
        throw new TypeError(`year must be an integer 1900–2100, got ${v}`);
      continue;
    }
    if (typeof v !== "string")
      throw new TypeError(`${k} must be a string, got ${typeof v}`);
    if (k !== "comment" && !v.trim())
      throw new TypeError(`${k} must be non-empty`);
    if (v.length > 500)
      throw new TypeError(`${k} too long (${v.length} chars, max 500)`);
  }
}

export function setFileTags(p: string, vals: TagValues): boolean {
  validateTagValues(vals);
  const pairs = Object.entries(vals).filter(([, v]) => v !== undefined) as [
    keyof TagValues,
    string | number,
  ][];
  if (!pairs.length) return true;
  if (p.toLowerCase().endsWith(".wav")) {
    const sets = pairs
      .map(([k, v]) => {
        if (k === "year") return `a.tags.add(TDRC(encoding=3, text="${v}"))`;
        if (k === "comment")
          return `a.tags.add(COMM(encoding=3, lang="eng", desc="", text=${JSON.stringify(v)}))`;
        return `a.tags.add(${WAV_ID3[k]}(encoding=3, text=${JSON.stringify(v)}))`;
      })
      .join("\n");
    const script = `from mutagen.wave import WAVE
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TCON, TDRC, COMM
a = WAVE(${JSON.stringify(p)})
if not a.tags: a.add_tags()
if not isinstance(a.tags, ID3): a.tags = ID3()
${sets}
a.save()
print("ok")`;
    const pr = Bun.spawnSync({
      cmd: ["uv", "run", "--with", "mutagen", "python", "-c", script],
      stdout: "pipe",
    });
    return new TextDecoder().decode(pr.stdout).trim() === "ok";
  }
  // mp3/m4a: fresh-file rewrite (xattr-safe); date needs TDRC-style value
  const tmp = `${ARCH}/.fa${Date.now()}${p.slice(-4)}`;
  const meta = pairs.flatMap(([k, v]) => [
    "-metadata",
    k === "year" ? `date=${v}` : `${k}=${v}`,
  ]);
  const pr = Bun.spawnSync({
    cmd: [
      "ffmpeg",
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      p,
      "-map",
      "0",
      "-c",
      "copy",
      ...meta,
      tmp,
    ],
    stdout: "pipe",
  });
  if (pr.exitCode === 0 && existsSync(tmp)) {
    unlinkSync(p);
    renameSync(tmp, p);
    return true;
  }
  if (existsSync(tmp)) unlinkSync(tmp);
  return false;
}

// ---------- SoundCloud search (feeds genre + art + permalink) ----------
export interface ScHit {
  url: string;
  title: string;
  uploader: string | null;
  thumb: string | null;
  genre?: string;
  /** SC upload year — for edits/remixes this is the remix year */
  year?: number;
  score: number;
}

function cleanQuery(r: Row): string {
  const artist0 = (r.artist ?? "").split(/[,&]/)[0]?.trim() ?? "";
  const t = r.title
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(
      /\b(final|mstr|master|vip|full|cdq|extended|radio edit|feat\.?|ft\.?)\b/gi,
      " ",
    )
    .replace(/\b\d+(\.\d+)+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${artist0} ${t}`.split(" ").filter(Boolean).slice(0, 8).join(" ");
}

export function scSearch(r: Row): ScHit[] {
  const q = cleanQuery(r);
  if (!q) return [];
  let out = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const pr = Bun.spawnSync({
      cmd: [
        "yt-dlp",
        "--flat-playlist",
        "--print",
        "COL|%(title).60s|%(webpage_url)s|%(uploader)s|%(thumbnails).600s|%(genre)s|%(timestamp)s",
        `scsearch4:${q}`,
      ],
      stdout: "pipe",
      stderr: "pipe",
      timeout: 45_000,
    });
    out = new TextDecoder().decode(pr.stdout);
    if (out.split("\n").some((l) => l.startsWith("COL|"))) break;
    Bun.sleepSync(1200 * (attempt + 1));
  }
  const hits: ScHit[] = [];
  const tWords = words(r.title);
  const artist0 = ((r.artist ?? "unknown").split(/[,&]/)[0] ?? "")
    .trim()
    .toLowerCase();
  for (const line of out.split("\n")) {
    if (!line.startsWith("COL|")) continue;
    const parts = line.slice(4).split("|");
    if (parts.length < 5) continue;
    const [t, url, uploader, , thumbsRaw, genre, tsRaw] = parts;
    if (!url?.includes("soundcloud.com")) continue;
    const hWords = words(t ?? "");
    const overlap = tWords.filter((w) => hWords.includes(w)).length;
    if (overlap < 1) continue; // relevance gate
    const uploaderOK = (uploader ?? "")
      .toLowerCase()
      .includes(artist0.slice(0, 8));
    // SC upload year = the remix/edit's year (not the original's)
    const ts = Number(tsRaw?.trim());
    const year =
      Number.isFinite(ts) &&
      ts > 946_684_800 && // 2000-01-01 UTC
      ts < 4_102_444_800 // 2100-01-01 UTC
        ? new Date(ts * 1000).getUTCFullYear()
        : undefined;
    hits.push({
      url,
      title: t ?? "",
      uploader: uploader || null,
      thumb:
        thumbsRaw?.match(
          /https:\/\/i1\.sndcdn\.com\/artworks[^\s',]+t500x500\.jpg/,
        )?.[0] ?? null,
      genre: genre && genre !== "NA" ? genre : undefined,
      year,
      score: overlap * 2 + (uploaderOK ? 1 : 0),
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

const SC_GENRE_CANON: Record<string, string> = {
  "hip-hop & rap": "Hip-Hop",
  "hip hop": "Hip-Hop",
  rap: "Hip-Hop",
  "dance & edm": "EDM",
  dance: "EDM",
  electronic: "EDM",
  edm: "EDM",
  house: "House",
  "deep house": "Deep House",
  "tech house": "Tech House",
  "bass house": "Bass House",
  "progressive house": "Progressive House",
  techno: "Techno",
  "techno trance": "Trance",
  trance: "Trance",
  "drum & bass": "Drum & Bass",
  dnb: "Drum & Bass",
  "r&b": "R&B",
  "r&b / soul": "R&B",
  "r&b soul": "R&B",
  soul: "R&B",
  rock: "Rock",
  alternative: "Rock",
  pop: "Pop",
};

export function canonGenre(g: string): string {
  const key = g.replace(/^#/, "").toLowerCase().trim();
  return SC_GENRE_CANON[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

// ---------- other art sources ----------
export function twinArt(r: Row): Uint8Array | null {
  const stem = basename(r.file_path)
    .replace(/\.\w+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  for (const f of readdirSync(ARCH)) {
    if (!/\.mp3$/i.test(f)) continue;
    if (
      f
        .replace(/\.mp3$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "") !== stem
    )
      continue;
    const dump = r.file_path + ".twin.jpg";
    const pr = Bun.spawnSync({
      cmd: [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        join(ARCH, f),
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        dump,
      ],
    });
    if (pr.exitCode === 0 && existsSync(dump)) {
      const data = new Uint8Array(require("node:fs").readFileSync(dump));
      unlinkSync(dump);
      if (data.length > 3000) return data;
    }
    if (existsSync(dump)) unlinkSync(dump);
  }
  return null;
}

export async function gatewayArt(
  r: Row,
): Promise<{ bytes: Uint8Array; note: string } | null> {
  const q = encodeURIComponent(
    `${r.artist ?? ""} ${r.title} hypeddit OR hyperfollow`,
  );
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      headers: UA,
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    const re =
      /href="[^"]*(https?:\/\/(?:www\.)?(?:hypeddit|hyperfollow|fruitbat)\.com\/[^"&]+)/g;
    for (const link of [...html.matchAll(re)].map((m) => m[1]).slice(0, 3)) {
      if (!link) continue;
      const og = await pageOgImage(link);
      if (!og) continue;
      const bytes = await fetchImage(og);
      if (bytes) return { bytes, note: link };
    }
  } catch {}
  return null;
}

export async function deezerArt(r: Row): Promise<Uint8Array | null> {
  try {
    const q = encodeURIComponent(`artist:"${r.artist}" track:"${r.title}"`);
    const d = await (
      await fetch(`https://api.deezer.com/search?q=${q}&limit=3`, {
        headers: UA,
      })
    ).json();
    for (const hit of d?.data ?? []) {
      const url = hit.album?.cover_xl ?? hit.album?.cover_big;
      if (!url) continue;
      const bytes = await fetchImage(url);
      if (bytes) return bytes;
    }
  } catch {}
  return null;
}

export async function itunesArt(r: Row): Promise<Uint8Array | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(`${r.artist ?? ""} ${r.title}`)}&media=music&entity=song&limit=3`,
      { headers: UA },
    );
    const d = await res.json();
    for (const hit of d?.results ?? []) {
      const url = hit.artworkUrl100?.replace("100x100", "600x600");
      if (!url) continue;
      const bytes = await fetchImage(url);
      if (bytes) return bytes;
    }
  } catch {}
  return null;
}
