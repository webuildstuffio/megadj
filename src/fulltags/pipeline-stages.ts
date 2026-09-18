// pipeline-stages.ts — the per-stage arms of enrichTrack (#88 item 1).
// Each arm owns exactly one stage's want-decision + write-decision and
// mutates the shared TrackCtx the orchestrator passes in. enrichTrack
// (pipeline.ts) is the flat sequencer; every branch lives HERE, one
// function per stage, so each stays under the #198 census ceiling on its
// own. Behavior-preserving: the stage order and note strings are pinned
// by the pipeline tests.
import type {
  BpLookupFn,
  PipelineOptions,
  Stage,
  TrackInput,
} from "./pipeline-types";
import { scSearch } from "./sources/sc-search";
import { canonGenre, type TagPatch } from "./write/schema";
import { detectRemix } from "./sources/remix";
import {
  beatportLookup,
  bpGenre,
  bpStamp,
  type BpTrack,
} from "./sources/beatport";
import { appendQueue, artLadder, scArt } from "./pipeline-art";
import { parseMoodStamp, readEnergyStamp, readStamp } from "./pipeline-stamps";
import { energyFromLufs, measureRms } from "./media-probe";
import { analyzeBeats, foldTempo } from "./analysis/beats-analysis";
import { analyzeKey } from "./analysis/key-analysis";
import { fingerprintWithDuration } from "./analysis/fingerprint";
import { analyzeMoods, moodStamp } from "./analysis/models";
import { mbLookupCached } from "./sources/mb_lookup";
import { embedArt } from "./write/writer";
import { type Truth } from "./write/readers";
import { basename } from "node:path";

/** Mutable stage context: one track's accumulated patch + notes, plus
 *  the ground truth and the source hits later stages consume. */
export interface TrackCtx {
  t: TrackInput;
  opts: PipelineOptions;
  notes: string[];
  patch: TagPatch;
  truth: Truth;
  /** SC/Beatport hits — fetched once (search), consumed by several stages. */
  scBest: ReturnType<typeof scSearch>[number] | null;
  bpBest: BpTrack | null;
  /** Set by the art arm when it wrote bytes directly (not via patch). */
  artWritten: boolean;
  titleGuess: string | null;
}

/** want("tags")-style stage gate. */
export const want = (opts: PipelineOptions, s: Stage): boolean =>
  !opts.only || opts.only.includes(s);

/** Effective title/artist used for every online lookup (patch wins over
 *  file truth over CLI hints over filename). */
export function effTitleOf(ctx: TrackCtx): string {
  return (
    ctx.patch.title ?? ctx.truth.title ?? ctx.t.title ?? basename(ctx.t.path)
  );
}

export function effArtistOf(ctx: TrackCtx): string | null {
  return ctx.patch.artist ?? ctx.truth.artist ?? ctx.t.artist ?? null;
}

// ---------- remix credit (filename/title derived) ----------
export function stageRemixCredit(ctx: TrackCtx): void {
  // Stage-gated: a `--fingerprint`-only run must not write remix tags —
  // every mutation belongs to the stage the caller asked for (least
  // surprise for scoped runs; the idempotency stamp still dedupes).
  if (want(ctx.opts, "tags") && ctx.titleGuess && !ctx.truth.comment) {
    const remix = detectRemix(ctx.titleGuess);
    if (remix) ctx.patch.remixer = remix.remixName;
  }
}

// ---------- 1. tags: MusicBrainz fills artist/album/date ----------
export async function stageTagsMb(ctx: TrackCtx): Promise<void> {
  const { truth, opts, patch, t } = ctx;
  // CLI hints fill what the file lacks; hints covering every missing field
  // make the pass deterministic — skip MB entirely (keeps offline runs
  // off the network and the run fast).
  const hinted =
    (!truth.title || Boolean(opts.hints?.title)) &&
    (!truth.artist || Boolean(opts.hints?.artist)) &&
    (!truth.album || Boolean(opts.hints?.album));
  if (!(want(opts, "tags") && (!truth.title || !truth.artist || !truth.album)))
    return;
  if (!truth.title && opts.hints?.title) patch.title = opts.hints.title;
  if (!truth.artist && opts.hints?.artist) patch.artist = opts.hints.artist;
  if (!truth.album && opts.hints?.album) patch.album = opts.hints.album;
  const artist0 =
    (truth.artist ?? t.artist ?? patch.artist ?? "").split(/[,&]/)[0]?.trim() ||
    null;
  const rec = hinted
    ? null
    : await mbLookupCached(artist0, ctx.titleGuess ?? basename(t.path));
  if (rec) {
    if (!truth.title && !patch.title && rec.title) patch.title = rec.title;
    if (!truth.artist && !patch.artist && rec.artist) patch.artist = rec.artist;
    if (!truth.album && !patch.album && rec.album) patch.album = rec.album;
    if (rec.year) patch.year = rec.year;
    if (rec.mbid) patch.mbid = rec.mbid;
  }
}

// ---------- 2+3+4. one SC search feeds genre AND art AND year ----------
export function scNeedsOf(ctx: TrackCtx): {
  needGenre: boolean;
  needYear: boolean;
  needArt: boolean;
} {
  const { opts, truth, patch } = ctx;
  const genreOk = Boolean(truth.genre) && truth.genre !== "Music";
  return {
    needGenre: want(opts, "genre") && !genreOk,
    needYear: want(opts, "year") && !truth.year && !patch.year,
    needArt:
      (want(opts, "art") && !truth.art) ||
      (want(opts, "art") && Boolean(opts.upgradeScArt)),
  };
}

export function stageSoundcloudSearch(ctx: TrackCtx): void {
  const { opts } = ctx;
  const { needGenre, needYear, needArt } = scNeedsOf(ctx);
  const wantsSc = needGenre || needYear || needArt;
  if (!(wantsSc && !opts.dryRun)) return;
  ctx.scBest =
    scSearch({
      artist: effArtistOf(ctx),
      title: effTitleOf(ctx),
      file_path: ctx.t.path,
    })[0] ?? null;
}

// ---------- Beatport vote (second in every ladder, behind SC) ----------
export async function stageBeatportSearch(ctx: TrackCtx): Promise<void> {
  const { opts, truth } = ctx;
  const { needGenre, needYear, needArt } = scNeedsOf(ctx);
  const bpLookup: BpLookupFn = opts.beatportLookupFn ?? beatportLookup;
  const wantBp =
    !opts.dryRun &&
    (needGenre ||
      needYear ||
      needArt ||
      (want(opts, "tags") && (!truth.label || !truth.mixName || !truth.isrc)));
  if (!wantBp) return;
  ctx.bpBest = await bpLookup({
    artist: effArtistOf(ctx),
    title: effTitleOf(ctx),
    durationS: ctx.truth.durationS ?? undefined,
  });
}

export function stageGenre(ctx: TrackCtx): void {
  const { needGenre } = scNeedsOf(ctx);
  if (!needGenre) return;
  const { truth, scBest, bpBest } = ctx;
  const fileGenre = truth.genre && truth.genre !== "Music" ? truth.genre : null;
  const g =
    canonGenre(scBest?.genre ?? "") ||
    (fileGenre && fileGenre !== "Music" ? fileGenre : null) ||
    // Beatport runs third: SC tag → file → Beatport store genre
    (bpBest ? bpGenre(bpBest) : null);
  if (g) {
    ctx.patch.genre = g;
    ctx.notes.push(`genre:${g}`);
  }
}

export function stageYear(ctx: TrackCtx): void {
  const { needYear } = scNeedsOf(ctx);
  const { scBest, bpBest } = ctx;
  if (needYear && scBest?.year) {
    ctx.patch.year = scBest.year;
    ctx.notes.push(`year:${scBest.year}`);
  }
  // Beatport publish date = the official release year (fills when SC's
  // upload timestamp missed — remixes still prefer the SC year above).
  if (needYear && !scBest?.year && bpBest?.year) {
    ctx.patch.year = bpBest.year;
    ctx.notes.push(`year:${bpBest.year} (bp)`);
  }
}

// ---------- Beatport identity fields (label / mix / remixer / ISRC) ----------
export function stageBeatportFields(ctx: TrackCtx): void {
  // Only fields NO other source carries — never overwrite SC-derived or
  // file-present values. Provenance stamp rides in TXXX:BP-FIELDS so a
  // Beatport-filled tag is always auditable.
  const { truth, bpBest, opts, patch } = ctx;
  if (!(want(opts, "tags") && bpBest)) return;
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
    !detectRemix(ctx.titleGuess ?? "") &&
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
    ctx.notes.push(`bp:${stamp.split("; ").length} fields`);
  }
}

// ---------- art ladder ----------
export async function stageArt(ctx: TrackCtx): Promise<void> {
  const { needArt } = scNeedsOf(ctx);
  const { opts } = ctx;
  if (!(needArt && !opts.dryRun)) return;
  const artRow = {
    artist: effArtistOf(ctx),
    title: effTitleOf(ctx),
    album: ctx.t.album ?? null,
    file_path: ctx.t.path,
  };
  let bytes: Uint8Array | null = null;
  let source: string | null = null;
  if (ctx.scBest) {
    bytes = await scArt(ctx.scBest);
    if (bytes) source = ctx.scBest.url.includes("-original") ? "sc-orig" : "sc";
  }
  if (!bytes) {
    const rung = await artLadder(artRow, ctx.bpBest);
    bytes = rung.bytes;
    source = rung.source;
  }
  if (bytes && embedArt(ctx.t.path, bytes)) {
    ctx.notes.push(`art:${source}`);
    ctx.artWritten = true;
  } else if (opts.artworkQueue) {
    // Note only when the path was newly queued — a re-run finding the
    // path already in the queue is a no-op, not a change.
    if (appendQueue(opts.artworkQueue, artRow)) ctx.notes.push("art:queued");
  }
}

// ---------- energy (cheap, local, sortable) ----------
export async function stageEnergy(ctx: TrackCtx): Promise<void> {
  const { opts, t, patch } = ctx;
  if (!(want(opts, "energy") && !opts.dryRun)) return;
  // Idempotency: energy lives in TXXX:ENERGY which groundTruth() doesn't
  // surface. Before re-measuring, probe the file for an existing stamp —
  // a second identical value would still rewrite the container, so skip
  // when the stamp matches the measured value.
  //
  // ENERGY 2.0 (roadmap #4): when the mood stamp carries model-derived
  // danceability + arousal, blend them with the RMS score
  // (0.5·rms + 0.3·dance + 0.2·arousal-scaled) — perceptual energy tracks
  // the model view, not just loudness. RMS-only files keep the old value.
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
      ctx.notes.push(`energy:${e}`);
    }
  }
}

// ---------- fingerprint (chromaprint — content identity) ----------
export function stageFingerprint(ctx: TrackCtx): void {
  const { opts, t, patch } = ctx;
  if (!(want(opts, "fingerprint") && !opts.dryRun)) return;
  // Idempotent: TXXX:ACOUSTID stamp means already done (the fingerprint is
  // deterministic per audio content; a re-run would produce the same value
  // and needlessly rewrite the container).
  const existing = readStamp(t.path, "ACOUSTID");
  if (existing) return;
  const { fingerprint } = fingerprintWithDuration(t.path);
  if (fingerprint) {
    patch.fingerprint = fingerprint;
    ctx.notes.push(`fingerprint:${fingerprint.slice(0, 8)}…`);
  }
}

// ---------- real BPM + downbeats (beat_this) ----------
export async function stageBpm(ctx: TrackCtx): Promise<void> {
  const { opts, t, patch, truth } = ctx;
  if (!(want(opts, "bpm") && !opts.dryRun)) return;
  if (truth.bpm) return;
  // Idempotent: TBPM stamp (read via ffprobe/groundTruth) means done —
  // per-track inference costs seconds and the env load is the real cost.
  const beats = await analyzeBeats(t.path);
  if (beats) {
    // Fold double/half tempo into the 70–180 DJ window, write as the
    // integer TBPM rekordbox displays; keep precision in the note.
    patch.bpm = Math.round(foldTempo(beats.bpm));
    ctx.notes.push(`bpm:${beats.bpm.toFixed(1)}→${patch.bpm}`);
  } else {
    ctx.notes.push(
      "bpm:SKIP (beat_this env missing — uv run --with beat-this)",
    );
  }
}

// ---------- harmonic key (OpenKeyScan analyzer) ----------
export async function stageKey(ctx: TrackCtx): Promise<void> {
  const { opts, t, patch, truth } = ctx;
  if (!(want(opts, "key") && !opts.dryRun)) return;
  // Idempotent: TKEY/TXXX:CAMELOT stamp means done. Writes TKEY where the
  // container supports it (AIFF/MP3; WAV RIFF has no key field) plus
  // TXXX:CAMELOT everywhere via the generic stamp path.
  const existing = readStamp(t.path, "CAMELOT");
  if (existing || truth.key) return;
  const k = await analyzeKey(t.path);
  if (k) {
    patch.key = k.camelot; // TKEY / m4a freeform initialkey
    patch.camelot = k.camelot; // TXXX:CAMELOT — container-independent
    ctx.notes.push(`key:${k.camelot} (${k.key})`);
  } else {
    ctx.notes.push(
      "key:SKIP (analyzer missing — clone openkeyscan-analyzer to ~/.local/share)",
    );
  }
}

// ---------- mood / dance / valence (ONNX heads — roadmap #4) ----------
export async function stageMood(ctx: TrackCtx): Promise<void> {
  const { opts, t, patch } = ctx;
  if (!(want(opts, "mood") && !opts.dryRun)) return;
  // Idempotent: TXXX:MOOD stamp means done. One python spawn per track here
  // (enrichTrack is per-track); enrichBatchMoods batches when running solo.
  const existing = readStamp(t.path, "MOOD");
  if (existing) return;
  const m = (await analyzeMoods([t.path])).get(t.path);
  if (m) {
    patch.mood = moodStamp(m);
    ctx.notes.push(
      `mood:dance=${m.danceability.toFixed(2)} party=${m.moodParty.toFixed(2)} V=${m.valence.toFixed(1)} A=${m.arousal.toFixed(1)}`,
    );
  } else {
    ctx.notes.push(
      "mood:SKIP (models missing — FULLTAGS ensure-models, or onnxruntime env broken)",
    );
  }
}

/** Field-presence notes for the patch's identity fields (after all arms). */
export function noteIdentityFields(ctx: TrackCtx): void {
  const { patch, notes } = ctx;
  if (patch.title) notes.push("title");
  if (patch.artist) notes.push("artist");
  if (patch.album) notes.push("album");
  if (patch.mbid) notes.push("mbid");
  if (patch.remixer) notes.push(`remixer:${patch.remixer}`);
}
