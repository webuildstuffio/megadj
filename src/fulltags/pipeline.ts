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
 *
 * Split per concern (#90 diet): stamp readers live in pipeline-stamps.ts,
 * the art ladder + AI queue in pipeline-art.ts — this file is the stage
 * orchestration only.
 */
import { basename } from "node:path";
import { groundTruth } from "./readers";
import { embedArt, writePatch } from "./writer";
import { canonGenre, type TagPatch } from "./schema";
import { scSearch } from "./sc-search";
import { energyFromLufs, measureRms } from "./media-probe";
import { detectRemix } from "./remix";
import { analyzeBeats, foldTempo } from "./beats-analysis";
import { analyzeKey } from "./key-analysis";
import { fingerprintWithDuration } from "./fingerprint";
import { analyzeMoods, moodStamp } from "./models";
import { mbLookupCached } from "./mb_lookup";
import { beatportLookup, bpGenre, bpStamp, type BpTrack } from "./beatport";
import { appendQueue, artLadder, scArt } from "./pipeline-art";
import { parseMoodStamp, readEnergyStamp, readStamp } from "./pipeline-stamps";

export { parseMoodStamp, readAiStamps } from "./pipeline-stamps";

/** Injectable Beatport lookup (tests swap this; null = skip the source). */
export type BpLookupFn = (q: {
  artist: string | null;
  title: string;
  durationS?: number | undefined;
}) => Promise<BpTrack | null>;

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

/** The enrichment/analysis stages, in pipeline order. Single source of
 *  truth: PipelineOptions.only, the CLI --stage parser, and the
 *  megadj-side re-exports all derive from this array (adding a stage
 *  updates every consumer by construction, not by memory). */
export const STAGES = [
  "tags",
  "genre",
  "art",
  "year",
  "energy",
  "fingerprint",
  "bpm",
  "key",
  "mood",
] as const;

export type Stage = (typeof STAGES)[number];

export interface PipelineOptions {
  /** Where the AI cover queue appends when every online source misses. */
  archiveDir?: string;
  artworkQueue?: string | null;
  /** Stages to run (default: all). */
  only?: Stage[];
  jobs?: number;
  dryRun?: boolean;
  /** Re-embed existing SC art at original resolution. */
  upgradeScArt?: boolean;
  /** Test seam: override the Beatport lookup. Default is the real
   * catalog client (beatport.ts); pass a stub for offline tests. */
  beatportLookupFn?: BpLookupFn | undefined;
  /** CLI-provided hints (fulltags single <file> --title/--artist/--album):
   * fill in what the filename can't say. Only consulted when the file
   * itself lacks the field. */
  hints?: {
    title?: string | undefined;
    artist?: string | undefined;
    album?: string | undefined;
  };
  onProgress?: (msg: string) => void;
}

export interface TrackResult {
  path: string;
  notes: string[];
  complete: boolean;
  missing: string[];
}

export { DEFAULT_QUEUE } from "./pipeline-art";

/** One-track pass. Returns the human-readable change notes. */
export async function enrichTrack(
  t: TrackInput,
  opts: PipelineOptions = {},
): Promise<TrackResult> {
  const notes: string[] = [];
  let artWritten = false;
  const want = (s: Stage) => !opts.only || opts.only.includes(s);
  const truth = groundTruth(t.path);
  const genreOk = Boolean(truth.genre) && truth.genre !== "Music";
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
      (truth.artist ?? t.artist ?? patch.artist ?? "")
        .split(/[,&]/)[0]
        ?.trim() || null;
    const rec = hinted
      ? null
      : await mbLookupCached(artist0, titleGuess ?? basename(t.path));
    if (rec) {
      if (!truth.title && !patch.title && rec.title) patch.title = rec.title;
      if (!truth.artist && !patch.artist && rec.artist)
        patch.artist = rec.artist;
      if (!truth.album && !patch.album && rec.album) patch.album = rec.album;
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

  // ---------- Beatport vote (second in every ladder, behind SC) ----------
  // One catalog search feeds label/mix/remixer identity, genre, year, ISRC
  // AND art. Ranks SECOND behind SoundCloud everywhere: when SC produced a
  // credible hit for a field, Beatport does not overwrite it — Beatport
  // fills what SC missed and adds the DJ fields only it carries (label,
  // mix name, remixers, ISRC). Explicit test seam; dry runs stay offline.
  const bpLookup = opts.beatportLookupFn ?? beatportLookup;
  let bpBest: BpTrack | null = null;
  const wantBp =
    !opts.dryRun &&
    (needGenre ||
      needYear ||
      needArt ||
      (want("tags") && (!truth.label || !truth.mixName || !truth.isrc)));
  if (wantBp) {
    const effTitle = patch.title ?? truth.title ?? t.title ?? basename(t.path);
    const effArtist = patch.artist ?? truth.artist ?? t.artist ?? null;
    bpBest = await bpLookup({
      artist: effArtist,
      title: effTitle,
      durationS: truth.durationS ?? undefined,
    });
  }

  if (needGenre) {
    const fileGenre =
      truth.genre && truth.genre !== "Music" ? truth.genre : null;
    const g =
      canonGenre(scBest?.genre ?? "") ||
      (fileGenre && fileGenre !== "Music" ? fileGenre : null) ||
      // Beatport runs third: SC tag → file → Beatport store genre
      (bpBest ? bpGenre(bpBest) : null);
    if (g) {
      patch.genre = g;
      notes.push(`genre:${g}`);
    }
  }

  if (needYear && scBest?.year) {
    patch.year = scBest.year;
    notes.push(`year:${scBest.year}`);
  }
  // Beatport publish date = the official release year (fills when SC's
  // upload timestamp missed — remixes still prefer the SC year above).
  if (needYear && !scBest?.year && bpBest?.year) {
    patch.year = bpBest.year;
    notes.push(`year:${bpBest.year} (bp)`);
  }

  // ---------- Beatport identity fields (label / mix / remixer / ISRC) ----------
  // Only fields NO other source carries — never overwrite SC-derived or
  // file-present values. Provenance stamp rides in TXXX:BP-FIELDS so a
  // Beatport-filled tag is always auditable.
  if (want("tags") && bpBest) {
    const bpFields: [string, string | number | null][] = [];
    if (!truth.label && !patch.label && bpBest.label) {
      patch.label = bpBest.label;
      bpFields.push(["label", bpBest.label]);
    }
    if (
      !truth.mixName &&
      !patch.mixName &&
      bpBest.mixName &&
      !/^original mix$/i.test(bpBest.mixName)
    ) {
      patch.mixName = bpBest.mixName;
      bpFields.push(["mix", bpBest.mixName]);
    }
    if (!truth.isrc && !patch.isrc && bpBest.isrc) {
      patch.isrc = bpBest.isrc;
      bpFields.push(["isrc", bpBest.isrc]);
    }
    if (
      !patch.remixer &&
      !truth.remixer &&
      !detectRemix(titleGuess ?? "") &&
      bpBest.remixers.length > 0
    ) {
      // Fills only when the file carries no credit AND the title suggests
      // none (the filename inference above runs first in the ladder —
      // see fulltags/README.md); never overwrites a written credit.
      patch.remixer = bpBest.remixers.join(", ");
      bpFields.push(["remixer", bpBest.remixers.join(", ")]);
    }
    const stamp = bpStamp(bpFields);
    if (stamp) {
      patch.beatport = stamp;
      notes.push(`bp:${stamp.split("; ").length} fields`);
    }
  }

  if (patch.title) notes.push("title");
  if (patch.artist) notes.push("artist");
  if (patch.album) notes.push("album");
  if (patch.mbid) notes.push("mbid");
  if (patch.remixer) notes.push(`remixer:${patch.remixer}`);

  // ---------- art ladder ----------
  if (needArt && !opts.dryRun) {
    const artRow = {
      artist: patch.artist ?? truth.artist ?? t.artist ?? null,
      title: patch.title ?? truth.title ?? t.title ?? basename(t.path),
      album: t.album ?? null,
      file_path: t.path,
    };
    let bytes: Uint8Array | null = null;
    let source: string | null = null;
    if (scBest) {
      bytes = await scArt(scBest);
      if (bytes) source = scBest.url.includes("-original") ? "sc-orig" : "sc";
    }
    if (!bytes) {
      const rung = await artLadder(artRow, bpBest);
      bytes = rung.bytes;
      source = rung.source;
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
  //
  // ENERGY 2.0 (roadmap #4): when the mood stamp carries model-derived
  // danceability + arousal, blend them with the RMS score
  // (0.5·rms + 0.3·dance + 0.2·arousal-scaled) — perceptual energy tracks
  // the model view, not just loudness. RMS-only files keep the old value.
  if (want("energy") && !opts.dryRun) {
    const rms = await measureRms(t.path);
    let e = energyFromLufs(rms);
    const moodStampVal = readStamp(t.path, "MOOD");
    if (e !== null && moodStampVal) {
      const m = parseMoodStamp(moodStampVal);
      if (m) {
        const arousalNorm = Math.min(1, Math.max(0, (m.arousal - 1) / 8));
        const e2 = 0.5 * e + 0.3 * m.danceability * 10 + 0.2 * arousalNorm * 10;
        e = Math.round(e2 * 10) / 10;
      }
    }
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
        notes.push(
          "bpm:SKIP (beat_this env missing — uv run --with beat-this)",
        );
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
        notes.push(
          "key:SKIP (analyzer missing — clone openkeyscan-analyzer to ~/.local/share)",
        );
      }
    }
  }

  // ---------- mood / dance / valence (ONNX heads — roadmap #4) ----------
  // Idempotent: TXXX:MOOD stamp means done. One python spawn per track here
  // (enrichTrack is per-track); enrichBatchMoods batches when running solo.
  if (want("mood") && !opts.dryRun) {
    const existing = readStamp(t.path, "MOOD");
    if (!existing) {
      const m = (await analyzeMoods([t.path])).get(t.path);
      if (m) {
        patch.mood = moodStamp(m);
        notes.push(
          `mood:dance=${m.danceability.toFixed(2)} party=${m.moodParty.toFixed(2)} V=${m.valence.toFixed(1)} A=${m.arousal.toFixed(1)}`,
        );
      } else {
        notes.push(
          "mood:SKIP (models missing — FULLTAGS ensure-models, or onnxruntime env broken)",
        );
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
