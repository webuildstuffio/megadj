/**
 * art_final.ts — THE production artwork pipeline (consolidates all prior passes).
 *
 * Sources, in order:
 *   1. SoundCloud  — yt-dlp scsearch resolves permalink → t500x500 art + genre
 *   2. mp3-twin    — same-named mp3 in archive with embedded art
 *   3. Deezer      — fuzzy artist+title, cover_xl
 *   4. iTunes      — fuzzy artist+title, 600px
 *   5. AI queue    — leftovers appended to artwork-queue.jsonl for `megadj artwork`
 *
 * Embedding: mp3/m4a → ffmpeg attached_pic; wav → mutagen APIC (keeps tags).
 * PARALLEL: --jobs N workers (default 6). Progress printed per item + ETA.
 *
 * Modes:
 *   bun tools/art_final.ts            # fill only tracks missing art (any ext)
 *   bun tools/art_final.ts --all      # overwrite art everywhere SC hit found
 *   bun tools/art_final.ts --jobs 8
 */
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";

const home = process.env.HOME!;
const ARCH = `${home}/Music/DJ-Imports`;
const db = new Database(`${home}/.local/state/megadj/archive.db`);
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
};

const ALL = process.argv.includes("--all");
const JOBS = Math.max(
  1,
  Number(process.argv[process.argv.indexOf("--jobs") + 1] ?? 6),
);

interface Row {
  video_id: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  file_path: string;
}

// ---------- art detection ----------
const wavArtCache = new Map<string, boolean>();
function hasArt(p: string): boolean {
  const ext = p.slice(p.lastIndexOf(".")).toLowerCase();
  if (ext === ".wav") {
    if (wavArtCache.has(p)) return wavArtCache.get(p)!;
    const pr = Bun.spawnSync({
      cmd: [
        "uv",
        "run",
        "--with",
        "mutagen",
        "python",
        "-c",
        `from mutagen.wave import WAVE
a = WAVE(${JSON.stringify(p)})
ks = a.tags.keys() if a.tags else []
print("has_art" if any(k.startswith("APIC") for k in ks) else "no_art")`,
      ],
      stdout: "pipe",
    });
    const ok = new TextDecoder().decode(pr.stdout).trim() === "has_art";
    wavArtCache.set(p, ok);
    return ok;
  }
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

// ---------- source 1: SoundCloud via yt-dlp ----------
interface ScHit {
  webpage_url: string;
  thumbnail: string | null;
  uploader: string | null;
  title: string;
  genre?: string;
}

function cleanQuery(artist: string, title: string): string {
  const artist0 = (artist ?? "Unknown").split(/[,&]/)[0].trim();
  const t = title
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(
      /\b(final|mstr|master|vip|full|cdq|og file|extended|radio edit|feat\.?|ft\.?)\b/gi,
      " ",
    )
    .replace(/\b\d+(\.\d+)+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${artist0} ${t}`.split(" ").filter(Boolean).slice(0, 8).join(" ");
}

async function scSearch(artist: string, title: string): Promise<ScHit[]> {
  const q = cleanQuery(artist, title);
  let out = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const pr = Bun.spawnSync({
      cmd: [
        "yt-dlp",
        "--flat-playlist",
        "--print",
        "COL|%(title).60s|%(webpage_url)s|%(uploader)s|%(thumbnails).600s|%(genre)s",
        `scsearch4:${q}`,
      ],
      stdout: "pipe",
      stderr: "pipe",
      timeout: 45_000,
    });
    out = new TextDecoder().decode(pr.stdout);
    if (out.split("\n").some((l) => l.startsWith("COL|"))) break;
    await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }
  const hits: ScHit[] = [];
  for (const line of out.split("\n")) {
    if (!line.startsWith("COL|")) continue;
    const parts = line.slice(4).split("|");
    if (parts.length < 5) continue;
    const [t, url, uploader, , thumbsRaw, genre] = parts;
    if (!url.includes("soundcloud.com")) continue;
    const m = thumbsRaw?.match(
      /https:\/\/i1\.sndcdn\.com\/artworks[^\s',]+t500x500\.jpg/,
    );
    hits.push({
      webpage_url: url,
      thumbnail: m?.[0] ?? null,
      uploader: uploader || null,
      title: t,
      genre: genre && genre !== "NA" ? genre : undefined,
    });
  }
  return hits;
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function matchScore(hit: ScHit, r: Row): number {
  const tWords = words(r.title);
  const hWords = words(hit.title);
  const titleOverlap = tWords.filter((w) => hWords.includes(w)).length;
  const artist0 = (r.artist ?? "unknown").split(/[,&]/)[0].trim().toLowerCase();
  const artistOK = (hit.uploader ?? "")
    .toLowerCase()
    .includes(artist0.slice(0, 8));
  return titleOverlap * 2 + (artistOK ? 1 : 0);
}

async function fetchImage(url: string): Promise<Uint8Array | null> {
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

/**
 * hypedditSource — these DJ gateways embed og:image with the release cover
 * and usually carry the SC/YouTube landing links. Feeds the raw gateway URL
 * back for provenance.
 */
async function hypedditSource(
  r: Row,
): Promise<{ bytes: Uint8Array; note: string } | null> {
  // No URL in DB: try DuckDuckGo HTML for "<artist> <title> hypeddit"
  const q = encodeURIComponent(`${r.artist} ${r.title} hypeddit OR hyperfollow`);
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    const re =
      /href="[^"]*(https?:\/\/(?:www\.)?(?:hypeddit|hyperfollow|fruitbat)\.com\/[^"&]+)/g;
    const links = [...html.matchAll(re)].map((m) => m[1]);
    for (const link of links.slice(0, 3)) {
      try {
        const page = await fetch(link, { headers: UA, signal: AbortSignal.timeout(10000) });
        if (!page.ok) continue;
        const body = await page.text();
        const og =
          body.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)?.[1] ??
          body.match(/<meta\s+content="([^"]+)"\s+property="og:image"/)?.[1];
        if (!og) continue;
        const bytes = await fetchImage(og);
        if (bytes) return { bytes, note: link };
      } catch {}
    }
  } catch {}
  return null;
}

async function soundcloudSource(
  r: Row,
): Promise<{ bytes: Uint8Array; note: string; genre?: string } | null> {
  const hits = await scSearch(r.artist, r.title);
  if (!hits.length) return null;
  let best: ScHit | null = null;
  let bestScore = 0;
  for (const h of hits) {
    const s = matchScore(h, r);
    if (s > bestScore) {
      bestScore = s;
      best = h;
    }
  }
  if (!best || !best.thumbnail) return null;
  const bytes = await fetchImage(best.thumbnail);
  return bytes ? { bytes, note: `sc:${best.webpage_url}`, genre: best.genre } : null;
}

// ---------- source 2: gateway pages (hypeddit / hyperfollow) ----------
// ---------- source 3: mp3 twin ----------
function twinArt(r: Row): Uint8Array | null {
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
    const mp3 = join(ARCH, f);
    const dump = r.file_path + ".twin.jpg";
    const pr = Bun.spawnSync({
      cmd: [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        mp3,
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

// ---------- sources 4+5: deezer / itunes ----------
async function deezerSource(r: Row): Promise<Uint8Array | null> {
  try {
    const q = encodeURIComponent(`artist:"${r.artist}" track:"${r.title}"`);
    const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=3`, {
      headers: UA,
    });
    const d = await res.json();
    for (const hit of d?.data ?? []) {
      const url = hit.album?.cover_xl ?? hit.album?.cover_big;
      if (!url) continue;
      const bytes = await fetchImage(url);
      if (bytes) return bytes;
    }
  } catch {}
  return null;
}

async function itunesSource(r: Row): Promise<Uint8Array | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(`${r.artist} ${r.title}`)}&media=music&entity=song&limit=3`,
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

// ---------- embedding ----------
function embedArt(p: string, bytes: Uint8Array): boolean {
  const isWav = p.toLowerCase().endsWith(".wav");
  const dump = p + ".final.jpg";
  require("node:fs").writeFileSync(dump, bytes);
  let ok = false;
  if (isWav) {
    const script = `
from mutagen.wave import WAVE
from mutagen.id3 import ID3, APIC
a = WAVE(${JSON.stringify(p)})
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
    const tmp = p + ".final.out";
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

// ---------- worker pool ----------
interface Job {
  row: Row;
  needArt: boolean;
}

async function processJob(
  job: Job,
): Promise<{ ok: boolean; source: string; scUrl?: string; genre?: string }> {
  const { row } = job;
  // 1. SoundCloud (art + genre)
  const sc = await soundcloudSource(row);
  if (sc && embedArt(row.file_path, sc.bytes)) {
    return {
      ok: true,
      source: "soundcloud",
      scUrl: sc.note.replace(/^sc:/, ""),
      genre: sc.genre,
    };
  }
  // 2. gateway pages (hypeddit/hyperfollow) — where DJ free downloads live
  const hy = await hypedditSource(row);
  if (hy && embedArt(row.file_path, hy.bytes)) {
    return { ok: true, source: "gateway", scUrl: hy.note };
  }
  // 3. twin
  const twin = twinArt(row);
  if (twin && embedArt(row.file_path, twin)) {
    return { ok: true, source: "mp3-twin" };
  }
  // 4. deezer
  const dz = await deezerSource(row);
  if (dz && embedArt(row.file_path, dz)) {
    return { ok: true, source: "deezer" };
  }
  // 5. itunes
  const it = await itunesSource(row);
  if (it && embedArt(row.file_path, it)) {
    return { ok: true, source: "itunes" };
  }
  return { ok: false, source: "none" };
}

async function main() {
  const rows = db
    .query(
      "SELECT video_id, title, artist, album, genre, file_path FROM tracks WHERE status='downloaded' AND file_path LIKE '~/Music/DJ-Imports/%'",
    )
    .all() as Row[];

  const jobs: Job[] = [];
  let haveArt = 0;
  for (const r of rows) {
    if (!existsSync(r.file_path)) continue;
    const art = hasArt(r.file_path);
    if (art && !ALL) {
      haveArt++;
      continue;
    }
    jobs.push({ row: r, needArt: !art });
  }

  const t0 = Date.now();
  console.log(
    `art_final: ${rows.length} tracks | have art: ${haveArt} | to process: ${jobs.length} | jobs: ${JOBS}${ALL ? " [overwrite]" : ""}\n`,
  );

  let idx = 0;
  let okCount = 0;
  let failCount = 0;
  const queueLeft: Row[] = [];
  const scUrls: Array<[string, string]> = [];

  async function worker(wid: number) {
    while (true) {
      const i = idx++;
      if (i >= jobs.length) break;
      const job = jobs[i];
      const name = `${job.row.artist} - ${job.row.title}`.slice(0, 60);
      const res = await processJob(job);
      if (res.ok) {
        okCount++;
        db.query("UPDATE tracks SET artwork_status=? WHERE video_id=?").run(
          `embedded:${res.source}`,
          job.row.video_id,
        );
        if (res.scUrl) scUrls.push([job.row.video_id, res.scUrl]);
        if (res.genre) {
          db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(
            res.genre,
            job.row.video_id,
          );
        }
        console.log(`  [${i + 1}/${jobs.length}] ✓ ${res.source}: ${name}`);
      } else {
        failCount++;
        queueLeft.push(job.row);
        console.log(`  [${i + 1}/${jobs.length}] ? no cover: ${name}`);
      }
    }
  }
  await Promise.all(Array.from({ length: JOBS }, (_, i) => worker(i)));

  // persist sc permalinks for provenance
  for (const [vid, url] of scUrls) {
    db.query("UPDATE tracks SET format_id=? WHERE video_id=?").run(
      `sc:${url}`,
      vid,
    );
  }

  if (queueLeft.length) {
    const { appendFile } = await import("node:fs/promises");
    const lines = queueLeft
      .filter((r) => r.artist && r.title)
      .map((r) =>
        JSON.stringify({
          path: r.file_path,
          title: r.title,
          artist: r.artist,
          album: r.album,
          reason: "no-cover-found",
        }),
      );
    if (lines.length)
      await appendFile(
        `${home}/.local/state/megadj/artwork-queue.jsonl`,
        lines.join("\n") + "\n",
      );
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\nDONE in ${secs}s — embedded: ${okCount} | no cover (→AI queue): ${queueLeft.length} | already had art: ${haveArt}`,
  );
  db.close();
}

await main();
