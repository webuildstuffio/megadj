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
import { analyzeBeats, analyzeKey, fingerprintWithDuration, foldTempo } from "./analysis";

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
  only?: Array<"tags" | "genre" | "art" | "year" | "energy" | "fingerprint" | "bpm" | "key">;
  jobs?: number;
  dryRun?: boolean;
  /** Re-embed existing SC art at original resolution. */
  upgradeScArt?: boolean;
  /** CLI-provided hints (fulltags single <file> --title/--artist/--album):
   * fill in what the filename can't say. Only consulted when the file
   * itself lacks the field. */
  hints?: { title?: string; artist?: string; album?: string };
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
export async function enrichTrack(t: TrackInput, opts: PipelineOptions = {}): Promise<TrackResult> {
  const notes: string[] = [];
  let artWritten = false;
  const want = (s: NonNullable<PipelineOptions["only"]>[number]) =>
    !opts.only || opts.only.includes(s);
  const truth = groundTruth(t.path);
  const genreOk = !!truth.genre && truth.genre !== "Music";
  const patch: TagPatch = {};

  // ---------- remix credit (filename/title derived) ----------
  // Stage-gated: a `--fingerprint`-only run must not write remix tags —
  // every mutation belongs to the stage the caller asked for (least
  // surprise for scoped runs; the idempotency stamp still dedupes).
  const titleGuess = truth.title ?? t.title ?? null;
  if (want("tags") && titleGuess && !truth.comment) {
    const remix = detectRemix(titleGuess);
    if (remix) patch.remixer = remix.remixName;
  }

  // ---------- 1. tags: MusicBrainz fills artist/album/date ----------
  // CLI hints fill what the file lacks; hints covering every missing field
  // make the pass deterministic — skip MB entirely (keeps offline runs
  // off the network and the run fast).
  const hinted =
    (!truth.title || Boolean(opts.hints?.title)) &&
    (!truth.artist || Boolean(opts.hints?.artist)) &&
    (!truth.album || Boolean(opts.hints?.album));
  if (want("tags") && (!truth.title || !truth.artist || !truth.album)) {
    if (!truth.title && opts.hints?.title) patch.title = opts.hints.title;
    if (!truth.artist && opts.hints?.artist) patch.artist = opts.hints.artist;
    if (!truth.album && opts.hints?.album) patch.album = opts.hints.album;
    const artist0 =
      (truth.artist ?? t.artist ?? patch.artist ?? "").split(/[,&]/)[0]?.trim() || null;
    const rec = hinted ? null : await mbLookupCached(artist0, titleGuess ?? basename(t.path));
    if (rec) {
      if (!truth.title && !patch.title && rec.title) patch.title = rec.title;
      if (!truth.artist && !patch.artist && rec.artist) patch.artist = rec.artist;
      if (!truth.album && !patch.album && rec.album) patch.album = rec.album;
      if (rec.year) patch.year = rec.year;
      if (rec.mbid) patch.mbid = rec.mbid;
    }
  }

  // ---------- 2+3+4. one SC search feeds genre AND art AND year ----------
  const needGenre = want("genre") && !genreOk;
  const needYear = want("year") && !truth.year && !patch.year;
  const needArt = (want("art") && !truth.art) || (want("art") && opts.upgradeScArt);
  const wantsSc = needGenre || needYear || needArt;

  let scBest: ReturnType<typeof scSearch>[number] | null | undefined;
  if (wantsSc && !opts.dryRun) {
    const effTitle = patch.title ?? truth.title ?? t.title ?? basename(t.path);
    const effArtist = patch.artist ?? truth.artist ?? t.artist ?? null;
    scBest = scSearch({ artist: effArtist, title: effTitle, file_path: t.path })[0] ?? null;
  }

  if (needGenre) {
    const fileGenre = truth.genre && truth.genre !== "Music" ? truth.genre : null;
    const g =
      canonGenre(scBest?.genre ?? "") || (fileGenre && fileGenre !== "Music" ? fileGenre : null);
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
      bytes = og ? await fetchBestScArt(og) : scBest.thumb ? await fetchImage(scBest.thumb) : null;
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
      artWritten = true;
    } else if (opts.artworkQueue) {
      // Note only when the path was newly queued — a re-run finding the
      // path already in the queue is a no-op, not a change.
      if (appendQueue(opts.artworkQueue, artRow)) notes.push("art:queued");
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

  // ---------- fingerprint (chromaprint — content identity) ----------
  // Idempotent: TXXX:ACOUSTID stamp means already done (the fingerprint is
  // deterministic per audio content; a re-run would produce the same value
  // and needlessly rewrite the container).
  if (want("fingerprint") && !opts.dryRun) {
    const existing = readStamp(t.path, "ACOUSTID");
    if (!existing) {
      const { fingerprint } = fingerprintWithDuration(t.path);
      if (fingerprint) {
        patch.fingerprint = fingerprint;
        notes.push(`fingerprint:${fingerprint.slice(0, 8)}…`);
      }
    }
  }

  // ---------- real BPM + downbeats (beat_this) ----------
  // Idempotent: TBPM stamp (read via ffprobe/groundTruth) means done —
  // per-track inference costs seconds and the env load is the real cost.
  if (want("bpm") && !opts.dryRun) {
    if (!truth.bpm) {
      const beats = await analyzeBeats(t.path);
      if (beats) {
        // Fold double/half tempo into the 70–180 DJ window, write as the
        // integer TBPM rekordbox displays; keep precision in the note.
        patch.bpm = Math.round(foldTempo(beats.bpm));
        notes.push(`bpm:${beats.bpm.toFixed(1)}→${patch.bpm}`);
      } else {
        notes.push("bpm:SKIP (beat_this env missing — uv run --with beat-this)");
      }
    }
  }

  // ---------- harmonic key (OpenKeyScan analyzer) ----------
  // Idempotent: TKEY/TXXX:CAMELOT stamp means done. Writes TKEY where the
  // container supports it (AIFF/MP3; WAV RIFF has no key field) plus
  // TXXX:CAMELOT everywhere via the generic stamp path.
  if (want("key") && !opts.dryRun) {
    const existing = readStamp(t.path, "CAMELOT");
    if (!existing && !truth.key) {
      const k = await analyzeKey(t.path);
      if (k) {
        patch.key = k.camelot; // TKEY / m4a freeform initialkey
        patch.camelot = k.camelot; // TXXX:CAMELOT — container-independent
        notes.push(`key:${k.camelot} (${k.key})`);
      } else {
        notes.push("key:SKIP (analyzer missing — clone openkeyscan-analyzer to ~/.local/share)");
      }
    }
  }

  // ---------- write ----------
  // Art embedding writes the file directly (not via the tag patch), so
  // `wrote` covers both paths — the verify re-read must run whenever the
  // file could have changed, and only then.
  const wrote = (!opts.dryRun && Object.keys(patch).length > 0) || artWritten;
  if (!opts.dryRun && Object.keys(patch).length > 0) {
    await writePatch(t.path, patch);
  }

  const after = wrote ? groundTruth(t.path) : truth;
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
    const res = await fetch(`https://musicbrainz.org/ws/2/recording/?query=${q}&fmt=json&limit=1`, {
      headers: {
        "User-Agent": "megadj/0.1 (https://github.com/megadj/megadj)",
      },
      signal: AbortSignal.timeout(8000),
    });
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
            rec["artist-credit"]?.[0]?.artist?.name ?? rec["artist-credit"]?.[0]?.name ?? null,
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
  } catch (e) {
    // MB fill is one optional hint among many (filename + SC tags come
    // first); failure degrades to null but is logged, not swallowed.
    console.error(`MusicBrainz lookup failed for ${key}`, e);
    return null;
  }
}

async function itunesArt(r: ArtRow): Promise<Uint8Array | null> {
  const { itunesArtwork } = await import("./art-sources");
  const url = await itunesArtwork(r.artist ?? "", r.album ?? r.title);
  if (!url) return null;
  return fetchImage(url);
}

function appendQueue(queuePath: string, r: ArtRow): boolean {
  const { existsSync, readFileSync } = require("node:fs") as typeof import("node:fs");
  try {
    // Dedupe: a path already queued (by path) must not re-queue on every
    // re-run — the queue is consumed by megadj artwork, duplicates just
    // burn AI generations.
    if (existsSync(queuePath)) {
      const seen = readFileSync(queuePath, "utf8");
      if (seen.includes(JSON.stringify(r.file_path))) return false;
    }
    const { appendFile } = require("node:fs/promises") as typeof import("node:fs/promises");
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
    return true;
  } catch {
    // queue is best-effort — never fail the pipeline over it
    return false;
  }
}

/**
 * Read TXXX frames (mutagen) in one spawn: pass descriptions, get values.
 * Shared by the energy stamp and AI-provenance reads — same format
 * dispatch, one python script, never throws.
 */
function readTxxx(p: string, descs: string[]): Record<string, string | null> {
  const script = `import json
p = ${JSON.stringify(p)}
wanted = ${JSON.stringify(descs)}
vals = {d: None for d in wanted}
try:
    a = None
    if p.lower().endswith(".wav"):
        from mutagen.wave import WAVE
        a = WAVE(p)
    elif p.lower().endswith((".aiff", ".aif")):
        from mutagen.aiff import AIFF
        a = AIFF(p)
    elif p.lower().endswith((".m4a", ".m4b")):
        from mutagen.mp4 import MP4
        a = MP4(p)
        tags = a.tags
        if tags is not None:
            for key, v in tags.items():
                if not key.startswith("----:"):
                    continue
                desc = key.rsplit(":", 1)[-1]
                if desc in vals and vals[desc] is None:
                    try:
                        vals[desc] = bytes(v[0]).decode("utf-8")
                    except Exception:
                        pass
    elif p.lower().endswith(".flac"):
        from mutagen.flac import FLAC
        a = FLAC(p)
        tags = a.tags
        if tags is not None:
            # ffmpeg writes these as Vorbis comments in lowercase
            # (energy=6), never TXXX — match keys case-insensitively
            # and unwrap the single-element list mutagen returns.
            upper = {k.upper(): k for k in tags.keys()}
            for d in wanted:
                k = upper.get(d.upper())
                if k is not None and vals[d] is None:
                    v = tags.get(k)
                    vals[d] = str(v[0]) if isinstance(v, list) and v else str(v)
    else:
        from mutagen.mp3 import MP3
        a = MP3(p)
    # ID3-family containers (WAV RIFF/INFO:ID3 chunk, AIFF ID3 chunk, MP3):
    # all expose a.tags as an ID3 dict with TXXX frames keyed by desc.
    # REGRESSION NOTE: the WAV/AIFF branches used to open the file and read
    # NOTHING — every stamp probe (ACOUSTID/CAMELOT/ENERGY/AI-*) returned
    # null on 73 archive WAVs, so fingerprint/key/energy re-runs rewrote
    # all of them forever (idempotency was mp3/flac/m4a-only).
    if a is not None and getattr(a, "tags", None) is not None:
        tags = a.tags
        try:
            for k in tags.keys():
                if str(k).startswith("TXXX"):
                    desc = getattr(tags.get(k), "desc", "")
                    if desc in vals and vals[desc] is None:
                        vals[desc] = str(tags.get(k).text[0])
        except Exception:
            pass
except Exception:
    pass
print(json.dumps(vals))`;
  const pr = Bun.spawnSync({
    cmd: ["uv", "run", "--with", "mutagen", "python", "-c", script],
    stdout: "pipe",
  });
  try {
    const last = new TextDecoder().decode(pr.stdout).trim().split("\n").at(-1);
    return last
      ? (JSON.parse(last) as Record<string, string | null>)
      : Object.fromEntries(descs.map((d) => [d, null]));
  } catch {
    return Object.fromEntries(descs.map((d) => [d, null]));
  }
}

/** Read the TXXX:ENERGY stamp (mutagen) — null when absent. */
function readEnergyStamp(p: string): number | null {
  const { ENERGY: v } = readTxxx(p, ["ENERGY"]);
  const n = v === null || v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Generic stamp read: any TXXX/freeform/vorbis stamp by description
 * (ACOUSTID, CAMELOT, …). Null when absent. */
function readStamp(p: string, desc: string): string | null {
  const out = readTxxx(p, [desc]);
  return out[desc] ?? null;
}

/** AI provenance stamps on a file: {aiGenre, aiYear} = "value|confidence",
 * null when not AI-filled (mutagen TXXX read; never throws). */
export function readAiStamps(p: string): {
  aiGenre: string | null;
  aiYear: string | null;
} {
  const { "AI-GENRE": genre, "AI-YEAR": year } = readTxxx(p, ["AI-GENRE", "AI-YEAR"]);
  return { aiGenre: genre ?? null, aiYear: year ?? null };
}

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
          log(`  [${my + 1}/${files.length}] ${r.notes.join(" ")} — ${basename(f)}`);
        else if (opts.dryRun) log(`  [${my + 1}/${files.length}] (dry) — ${basename(f)}`);
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
