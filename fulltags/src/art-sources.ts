/**
 * FullTags artwork sources — every online cover source in priority order.
 * Ladder (first success wins):
 *   SC search → SC page og:image (original/t1080 res) → hype gateways
 *   (hypeddit/hyperfollow) → mp3-twin → Deezer → iTunes → AI queue (caller).
 *
 * Migrated from tools/fetch_lib.ts + src/commands/embed.ts; identical
 * behavior, one home.
 */
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { existsSync, readFileSync, unlinkSync } from "node:fs";

export const UA = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
};

export interface ArtRow {
  artist: string | null;
  title: string;
  album?: string | null;
  file_path: string;
}

export function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

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

/** A SoundCloud permalink found in any tag value (usually comment). */
export function soundcloudUrlInTags(
  tags: Record<string, string>,
): string | null {
  for (const v of Object.values(tags)) {
    const m = /https?:\/\/(www\.)?soundcloud\.com\/[^\s"'<>]+/.exec(v);
    if (m?.[0]) return m[0];
  }
  return null;
}

/** Biggest artwork from a SoundCloud track/playlist page (oembed → og:image). */
export async function soundcloudArtwork(
  pageUrl: string,
): Promise<string | null> {
  try {
    const oembed = await fetch(
      `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(pageUrl)}`,
    );
    if (oembed.ok) {
      const data = (await oembed.json()) as { thumbnail_url?: string };
      if (data.thumbnail_url) {
        // t500x500 is the largest oEmbed serves; original art hides in the page.
        return data.thumbnail_url.replace(/-(large|t\d+x\d+)\./, "-t500x500.");
      }
    }
    const page = await fetch(pageUrl, { headers: { "User-Agent": UA["User-Agent"] } });
    if (page.ok) {
      const html = await page.text();
      const og = /property="og:image" content="([^"]+)"/.exec(html);
      if (og?.[1]) return og[1].replace(/-(large|t\d+x\d+)\./, "-t500x500.");
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function itunesArtwork(
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

export async function deezerArt(r: ArtRow): Promise<Uint8Array | null> {
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

export async function gatewayArt(
  r: ArtRow,
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

/** Find art on an mp3 twin (same stem, .mp3) — Bandcamp rips carry art. */
export function twinArt(r: ArtRow): Uint8Array | null {
  const archiveDir = dirname(r.file_path);
  const stem = basename(r.file_path)
    .replace(/\.\w+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  for (const f of readdirSync(archiveDir)) {
    if (!/\.mp3$/i.test(f)) continue;
    if (
      f.replace(/\.mp3$/i, "").toLowerCase().replace(/[^a-z0-9]/g, "") !== stem
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
        join(archiveDir, f),
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        dump,
      ],
    });
    if (pr.exitCode === 0 && existsSync(dump)) {
      const data = new Uint8Array(readFileSync(dump));
      unlinkSync(dump);
      if (data.length > 3000) return data;
    }
    if (existsSync(dump)) unlinkSync(dump);
  }
  return null;
}

function dirname(p: string): string {
  return p.replace(/\/[^/]*$/, "") || "/";
}

// ---------- SoundCloud search (feeds genre + art + year in one call) ----------
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

export interface SearchRow {
  artist: string | null;
  title: string;
  file_path: string;
}

function cleanQuery(r: SearchRow): string {
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

export function scSearch(r: SearchRow): ScHit[] {  const q = cleanQuery(r);
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
  const artist0 = (r.artist ?? "unknown").split(/[,&]/)[0]?.trim().toLowerCase() ?? "";
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
