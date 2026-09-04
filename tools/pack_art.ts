/**
 * pack_art.ts — scrape artwork for pack/edit tracks by walking each
 * plausible uploader's SoundCloud pages (profile, tracks, sets) and
 * og:image-scraping every candidate URL. Pack uploads ("Edit Pack (Free
 * Download)") often carry the pack art that individual rips never got.
 *
 * Usage: bun tools/pack_art.ts            # fill art-less tracks
 *        bun tools/pack_art.ts --all      # upgrade all to original res too
 */
import { Database } from "bun:sqlite";
import {
  existsSync,
  readdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { basename, join } from "node:path";

const home = process.env.HOME!;
const ARCH = `${home}/Music/DJ-Imports`;
const db = new Database(`${home}/.local/state/megadj/archive.db`);
const UA =
  "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
const ALL = process.argv.includes("--all");

interface Row {
  video_id: string;
  title: string;
  artist: string | null;
  file_path: string;
  format_id: string | null;
}
const rows = db
  .query(
    "SELECT video_id, title, artist, file_path, format_id FROM tracks WHERE status='downloaded' AND file_path LIKE '~/Music/DJ-Imports/%'",
  )
  .all() as Row[];
const files = new Set(
  readdirSync(ARCH).filter(
    (f) => !f.startsWith(".") && /\.(wav|mp3|m4a)$/i.test(f),
  ),
);

function hasArtWav(p: string): boolean {
  const s = `from mutagen.wave import WAVE
a = WAVE(${JSON.stringify(p)})
print("1" if a.tags and any(k.startswith("APIC") for k in a.tags.keys()) else "0")`;
  const pr = Bun.spawnSync({
    cmd: ["uv", "run", "--with", "mutagen", "python", "-c", s],
    stdout: "pipe",
  });
  return new TextDecoder().decode(pr.stdout).trim() === "1";
}
function hasArt(p: string): boolean {
  if (p.toLowerCase().endsWith(".wav")) return hasArtWav(p);
  const pr = Bun.spawnSync({
    cmd: [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v",
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      p,
    ],
  });
  return pr.exitCode === 0 && pr.stdout.toString().trim().length > 0;
}

/** name variants to try as SC profile slugs */
function artistSlugs(artist: string | null, title: string): string[] {
  const cands = new Set<string>();
  const add = (s: string) => {
    const slug = s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug.length > 2) cands.add(slug);
  };
  if (artist) {
    add(artist);
    for (const part of artist.split(/[,&x]|\bx\b/i).map((s) => s.trim())) {
      if (part) add(part);
    }
  }
  // remixer from title "(X Remix/Edit/Flip/Mash)"
  const m = title.match(/\(([^)]+?)\s*(?:remix|edit|flip|mash|rework|vip)/i);
  if (m) add(m[1]);
  // artist named in title "Artist - Something" or "Something - Artist"
  const dash = title.split(" - ");
  if (dash.length === 2) {
    add(dash[0]);
    add(dash[1]);
  }
  return [...cands];
}

async function ogImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
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

async function pageLinks(profileUrl: string): Promise<string[]> {
  try {
    const res = await fetch(profileUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const path = new URL(profileUrl).pathname.replace(/\/$/, "");
    return [...html.matchAll(new RegExp(`"${path}/([a-zA-Z0-9_-]+)"`, "g"))]
      .map((m) => m[1])
      .filter(
        (s) =>
          ![
            "tracks",
            "albums",
            "sets",
            "likes",
            "comments",
            "followers",
            "following",
          ].includes(s),
      )
      .map((s) => `${profileUrl.replace(/\/$/, "")}/${s}`);
  } catch {
    return [];
  }
}

async function fetchImage(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const b = new Uint8Array(await res.arrayBuffer());
    return b.length > 3000 ? b : null;
  } catch {
    return null;
  }
}

function embed(p: string, bytes: Uint8Array): boolean {
  const dump = p + ".pa.jpg";
  writeFileSync(dump, bytes);
  let ok = false;
  if (p.toLowerCase().endsWith(".wav")) {
    const s = `from mutagen.wave import WAVE
from mutagen.id3 import ID3, APIC
a = WAVE(${JSON.stringify(p)})
old = a.tags and any(k.startswith("APIC") for k in a.tags.keys())
if old: a.tags.delall("APIC")
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
      cmd: ["uv", "run", "--with", "mutagen", "python", "-c", s],
      stdout: "pipe",
    });
    ok = new TextDecoder().decode(pr.stdout).trim() === "ok";
  } else {
    const tmp = p + ".pa";
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

const targets = rows.filter((r) => {
  const fname = r.file_path.split("/").pop() ?? "";
  if (!files.has(fname) || !existsSync(r.file_path)) return false;
  return ALL || !hasArt(r.file_path);
});
console.log(
  `tracks to work on: ${targets.length}${ALL ? " [--all: upgrade too]" : ""}\n`,
);

let got = 0;
const JOBS = 4;
let idx = 0;

async function worker() {
  while (true) {
    const i = idx++;
    if (i >= targets.length) break;
    const r = targets[i]!;
    const words = r.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const slugs = artistSlugs(r.artist, r.title);
    let done = false;

    for (const slug of slugs.slice(0, 6)) {
      if (done) break;
      const profile = `https://soundcloud.com/${slug}`;
      const links = await pageLinks(profile);
      for (const link of links) {
        const tail = decodeURIComponent(link.split("/").pop() ?? "");
        const tailWords = tail
          .replace(/[^a-z0-9]+/g, " ")
          .split(/\s+/)
          .filter(Boolean);
        const overlap = words.filter((w) => tailWords.includes(w)).length;
        if (overlap < 1) continue;
        const og = await ogImage(link);
        if (!og) continue;
        const bytes = await fetchImage(og);
        if (!bytes) continue;
        if (embed(r.file_path, bytes)) {
          got++;
          done = true;
          db.query(
            "UPDATE tracks SET artwork_status='embedded:sc-pack', format_id=? WHERE video_id=?",
          ).run(`sc:${link}`, r.video_id);
          console.log(
            `  [${i + 1}/${targets.length}] ✓ ${r.title.slice(0, 52)} ← ${link.split(".com/")[1]}`,
          );
          break;
        }
      }
    }
    if (!done)
      console.log(
        `  [${i + 1}/${targets.length}] ? no pack art: ${r.title.slice(0, 52)}`,
      );
  }
}

await Promise.all(Array.from({ length: JOBS }, () => worker()));
console.log(`\nembedded: ${got}/${targets.length}`);
db.close();
