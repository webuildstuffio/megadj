/**
 * FullTags pipeline — ONE command fills EVERY field on any mp3/wav/aiff/
 * flac/m4a: metadata, genre, artwork, year, remix credits, energy.
 *
 * Ground-truth driven: reads the FILE first (not the DB), fills only what's
 * missing, writes atomically, and is idempotent — safe to re-run any time.
 *
 * Field ladders (first success wins):
 *   title/artist/album/date → MusicBrainz recording lookup
 *   genre    → file → SoundCloud tags (scSearch) → canonical map → AI (conf ≥ 0.7)
 *   year     → file → SC upload timestamp (remix year!) → AI (verify later)
 *   art      → embedded → SC page og:image (original/t1080) → gateways →
 *              mp3-twin → Deezer → iTunes → AI queue (last resort)
 *   energy   → ffmpeg RMS astats → 1–10 scale
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { groundTruth } from "./readers";
import { embedArt, writePatch, isAudioFile } from "./writer";
import { canonGenre, type TagPatch } from "./schema";
import {
  deezerArt,
  fetchBestScArt,
  fetchImage,
  gatewayArt,
  pageOgImage,
  scSearch,
  twinArt,
  type ArtRow,
} from "./art-sources";
import { energyFromLufs, measureRms } from "./probes";
import { detectRemix } from "./remix";

export interface TrackInput {
  /** Absolute path to the audio file. */
  path: string;
  /** Hint metadata (DB row / yt-dlp info / user-supplied). File wins. */
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  year?: number | null;
  comment?: string | null;
}

export interface PipelineOptions {
  /** Where the AI cover queue appends when every online source misses. */
  archiveDir?: string;
  artworkQueue?: string | null;
  /** Stages to run (default: all). */
  only?: Array<"tags" | "genre" | "art" | "year" | "energy">;
  jobs?: number;
  dryRun?: boolean;
  /** Re-embed existing SC art at original resolution. */
  upgradeScArt?: boolean;
  onProgress?: (msg: string) => void;
}

export interface TrackResult {
  path: string;
  notes: string[];
  complete: boolean;
  missing: string[];
}

/** Where AI-cover misses are queued when no explicit queue path is passed. */
export const DEFAULT_QUEUE =
  process.env.FULLTAGS_ARTWORK_QUEUE ??
  `${process.env.HOME}/.local/state/megadj/artwork-queue.jsonl`;

/** One-track pass. Returns the human-readable change notes. */
export async function enrichTrack(
  t: TrackInput,
  opts: PipelineOptions = {},
): Promise<TrackResult> {
  const notes: string[] = [];
  const want = (s: NonNullable<PipelineOptions["only"]>[number]) =>
    !opts.only || opts.only.includes(s);
  const truth = groundTruth(t.path);
  const genreOk = !!truth.genre && truth.genre !== "Music";
  const patch: TagPatch = {};

  // ---------- remix credit (filename/title derived) ----------
  const titleGuess = truth.title ?? t.title ?? null;
  if (titleGuess && !truth.comment) {
    const remix = detectRemix(titleGuess);
    if (remix) patch.remixer = remix.remixName;
  }

  // ---------- 1. tags: MusicBrainz fills artist/album/date ----------
  if (want("tags") && (!truth.title || !truth.artist || !truth.album)) {
    const artist0 =
      (truth.artist ?? t.artist ?? "").split(/[,&]/)[0]?.trim() || null;
    const rec = await mbLookupCached(artist0, titleGuess ?? basename(t.path));
    if (rec) {
      if (!truth.title && rec.title) patch.title = rec.title;
      if (!truth.artist && rec.artist) patch.artist = rec.artist;
      if (!truth.album && rec.album) patch.album = rec.album;
      if (rec.year) patch.year = rec.year;
      if (rec.mbid) patch.mbid = rec.mbid;
    }
  }

  // ---------- 2+3+4. one SC search feeds genre AND art AND year ----------
  const needGenre = want("genre") && !genreOk;
  const needYear = want("year") && !truth.year && !patch.year;
  const needArt =
    (want("art") && !truth.art) || (want("art") && opts.upgradeScArt);
  const wantsSc = needGenre || needYear || needArt;

  let scBest: ReturnType<typeof scSearch>[number] | null | undefined;
  if (wantsSc && !opts.dryRun) {
    const effTitle = patch.title ?? truth.title ?? t.title ?? basename(t.path);
    const effArtist = patch.artist ?? truth.artist ?? t.artist ?? null;
    scBest =
      scSearch({ artist: effArtist, title: effTitle, file_path: t.path })[0] ??
      null;
  }

  if (needGenre) {
    const fileGenre =
      truth.genre && truth.genre !== "Music" ? truth.genre : null;
    const g =
      canonGenre(scBest?.genre ?? "") ||
      (fileGenre && fileGenre !== "Music" ? fileGenre : null);
    if (g) {
      patch.genre = g;
      notes.push(`genre:${g}`);
    }
  }

  if (needYear && scBest?.year) {
    patch.year = scBest.year;
    notes.push(`year:${scBest.year}`);
  }

  if (patch.title) notes.push("title");
  if (patch.artist) notes.push("artist");
  if (patch.album) notes.push("album");
  if (patch.mbid) notes.push("mbid");
  if (patch.remixer) notes.push(`remixer:${patch.remixer}`);

  // ---------- art ladder ----------
  if (needArt && !opts.dryRun) {
    const artRow: ArtRow = {
      artist: patch.artist ?? truth.artist ?? t.artist ?? null,
      title: patch.title ?? truth.title ?? t.title ?? basename(t.path),
      album: t.album ?? null,
      file_path: t.path,
    };
    let bytes: Uint8Array | null = null;
    let source: string | null = null;
    if (scBest) {
      const og = await pageOgImage(scBest.url);
      bytes = og
        ? await fetchBestScArt(og)
        : scBest.thumb
          ? await fetchImage(scBest.thumb)
          : null;
      if (bytes) source = scBest.url.includes("-original") ? "sc-orig" : "sc";
    }
    if (!bytes) {
      const gw = await gatewayArt(artRow);
      if (gw) {
        bytes = gw.bytes;
        source = "gateway";
      }
    }
    if (!bytes) {
      bytes = twinArt(artRow);
      if (bytes) source = "twin";
    }
    if (!bytes) {
      bytes = await deezerArt(artRow);
      if (bytes) source = "deezer";
    }
    if (!bytes) {
      bytes = await itunesArt(artRow);
      if (bytes) source = "itunes";
    }
    if (bytes && embedArt(t.path, bytes)) {
      notes.push(`art:${source}`);
    } else if (opts.artworkQueue) {
      appendQueue(opts.artworkQueue, artRow);
      notes.push("art:queued");
    }
  }

  // ---------- energy (cheap, local, sortable) ----------
  // Idempotency: energy lives in TXXX:ENERGY which groundTruth() doesn't
  // surface. Before re-measuring, probe the file for an existing stamp —
  // a second identical value would still rewrite the container, so skip
  // when the stamp matches the measured value.
  if (want("energy") && !opts.dryRun) {
    const rms = await measureRms(t.path);
    const e = energyFromLufs(rms);
    if (e !== null) {
      const existing = readEnergyStamp(t.path);
      if (existing !== e) {
        patch.energy = e;
        notes.push(`energy:${e}`);
      }
    }
  }

  // ---------- write ----------
  if (!opts.dryRun && Object.keys(patch).length) {
    await writePatch(t.path, patch);
  }

  const after = opts.dryRun ? truth : groundTruth(t.path);
  const { complete, missing } = completenessOf(after, t);
  return { path: t.path, notes, complete, missing };
}

// ---------- MusicBrainz (1 rps, in-process cache) ----------
const mbCache = new Map<
  string,
  {
    title: string | null;
    artist: string | null;
    album: string | null;
    year: number | null;
    mbid: string | null;
  } | null
>();

async function mbLookupCached(
  artist: string | null,
  title: string,
): Promise<{
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  mbid: string | null;
} | null> {
  const key = `${artist ?? ""}::${title.toLowerCase()}`;
  if (mbCache.has(key)) return mbCache.get(key) ?? null;
  const q = artist
    ? `artist:"${encodeURIComponent(artist)}" AND recording:"${encodeURIComponent(title)}"`
    : `recording:"${encodeURIComponent(title)}"`;
  try {
    const res = await fetch(
      `https://musicbrainz.org/ws/2/recording/?query=${q}&fmt=json&limit=1`,
      {
        headers: {
          "User-Agent": "megadj/0.1 (https://github.com/megadj/megadj)",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    let out: {
      title: string | null;
      artist: string | null;
      album: string | null;
      year: number | null;
      mbid: string | null;
    } | null = null;
    if (res.ok) {
      const data = (await res.json()) as {
        recordings?: Array<{
          title?: string;
          id?: string;
          "artist-credit"?: Array<{
            name?: string;
            artist?: { name?: string };
          }>;
          releases?: Array<{ title?: string; date?: string }>;
        }>;
      };
      const rec = data.recordings?.[0];
      if (rec) {
        const date = rec.releases?.[0]?.date ?? null;
        const year = date ? Number(date.match(/\d{4}/)?.[0]) : NaN;
        out = {
          title: rec.title ?? null,
          artist:
            rec["artist-credit"]?.[0]?.artist?.name ??
            rec["artist-credit"]?.[0]?.name ??
            null,
          album: rec.releases?.[0]?.title ?? null,
          year: Number.isInteger(year) && year > 1900 ? year : null,
          mbid: rec.id ?? null,
        };
      }
    }
    mbCache.set(key, out);
    // Be polite to MusicBrainz: 1 rps even for misses.
    await new Promise((r) => setTimeout(r, 1050));
    return out;
  } catch {
    return null;
  }
}

async function itunesArt(r: ArtRow): Promise<Uint8Array | null> {
  const { itunesArtwork } = await import("./art-sources");
  const url = await itunesArtwork(r.artist ?? "", r.album ?? r.title);
  if (!url) return null;
  return fetchImage(url);
}

function appendQueue(queuePath: string, r: ArtRow): void {
  const { appendFile } =
    require("node:fs/promises") as typeof import("node:fs/promises");
  void appendFile(
    queuePath,
    JSON.stringify({
      path: r.file_path,
      title: r.title,
      artist: r.artist,
      album: r.album ?? null,
      reason: "no-online-cover",
    }) + "\n",
  ).catch(() => {});
}

function dirname(p: string): string {
  return p.replace(/\/[^/]*$/, "") || "/";
}

/** Read the TXXX:ENERGY stamp (mutagen) — null when absent. */
function readEnergyStamp(p: string): number | null {
  const script = `import json
p = ${JSON.stringify(p)}
val = None
try:
    if p.lower().endswith(".wav"):
        from mutagen.wave import WAVE
        a = WAVE(p)
    elif p.lower().endswith((".aiff", ".aif")):
        from mutagen.aiff import AIFF
        a = AIFF(p)
    else:
        from mutagen.mp3 import MP3
        from mutagen.flac import FLAC
        if p.lower().endswith(".flac"):
            a = FLAC(p)
        else:
            a = MP3(p)
    tags = a.tags
    if tags is not None:
        for k in tags.keys():
            if k.startswith("TXXX") and getattr(tags.get(k), "desc", "") == "ENERGY":
                val = str(tags.get(k).text[0])
                break
except Exception:
    pass
print(json.dumps({"energy": val}))`;
  const pr = Bun.spawnSync({
    cmd: ["uv", "run", "--with", "mutagen", "python", "-c", script],
    stdout: "pipe",
  });
  try {
    const last = new TextDecoder().decode(pr.stdout).trim().split("\n").at(-1);
    const v = last ? (JSON.parse(last).energy as string | null) : null;
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
void dirname;

function completenessOf(
  truth: ReturnType<typeof groundTruth>,
  hint: TrackInput,
): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!truth.art) missing.push("art");
  if (!truth.title && !hint.title) missing.push("title");
  if (!truth.artist && !hint.artist) missing.push("artist");
  if (!truth.album && !hint.album) missing.push("album");
  if (!truth.genre || truth.genre === "Music") missing.push("genre");
  if (!truth.year) missing.push("year");
  return { complete: missing.length === 0, missing };
}

// ---------- batch runner ----------
export interface BatchSummary {
  total: number;
  complete: number;
  notes: number;
  results: TrackResult[];
}

/** Walk a folder (or accept explicit files) and enrich everything found. */
export async function enrichAll(
  files: string[],
  opts: PipelineOptions = {},
): Promise<BatchSummary> {
  const log = opts.onProgress ?? ((m: string) => console.log(m));
  const jobs = Math.max(1, opts.jobs ?? 4);
  const results: TrackResult[] = [];
  let idx = 0;
  async function worker() {
    while (true) {
      const my = idx++;
      if (my >= files.length) break;
      const f = files[my]!;
      try {
        const r = await enrichTrack({ path: f }, opts);
        results.push(r);
        if (r.notes.length)
          log(
            `  [${my + 1}/${files.length}] ${r.notes.join(" ")} — ${basename(f)}`,
          );
        else if (opts.dryRun)
          log(`  [${my + 1}/${files.length}] (dry) — ${basename(f)}`);
      } catch (err) {
        log(
          `  [${my + 1}/${files.length}] ✗ ${(err as Error).message?.slice(0, 90)} — ${basename(f)}`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: jobs }, () => worker()));
  return {
    total: files.length,
    complete: results.filter((r) => r.complete).length,
    notes: results.filter((r) => r.notes.length).length,
    results,
  };
}

/** List audio files under a folder (non-recursive helper for the CLI). */
export function listAudio(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => !f.startsWith(".") && isAudioFile(join(dir, f)))
    .map((f) => join(dir, f));
}
