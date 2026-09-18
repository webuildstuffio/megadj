// ingest-one-stages.ts — the gate ladder of ingestOne (#88 item 1):
// each early gate (duration, wav→aiff, player compat, MB fill) is its own
// function mutating a shared IngestGateCtx. ingest.ts's ingestOne is the
// sequencer; the DB register/move tail stays there (it owns opts/log).
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { wavToAiff } from "../../fulltags/convert-aiff";
import type { IngestCounters } from "./ingest-register";
import type { IngestOptions } from "./ingest";
import type { Record_ } from "./ingest-probe";
import type { detectRemix } from "../../fulltags/remix";
import { isHiresOnly, playerCompat } from "../../fulltags/player-compat";
import { guessFromFreeText } from "../../fulltags/genre/genre-vocab";
import { mbRecording } from "../../fulltags/mb_lookup";

export interface IngestGateCtx {
  opts: IngestOptions;
  log: (msg: string) => void;
  rec: Record_;
  counters: IngestCounters;
  minDuration: number;
  title: string;
  artist: string | null;
  album: string | null;
  date: string | null;
  genre: string | null;
  mbidUsed: string | null;
  remixOf: ReturnType<typeof detectRemix>;
  bootleg: boolean;
  /** false = a gate rejected the file; ingestOne returns immediately. */
  proceed: boolean;
}

/** Duration gate: under-min-duration tracks register as skipped_short —
 *  visible in `megadj list` — but are never copied or tagged. */
export function gateDuration(ctx: IngestGateCtx): void {
  const { rec, opts, counters, minDuration } = ctx;
  if (!((rec.probe.durationS ?? Infinity) < minDuration)) return;
  counters.shortSkipped++;
  ctx.log(
    `  ⚠ short (${rec.probe.durationS?.toFixed(0)}s < ${minDuration}s): ${basename(rec.file)} — skipped`,
  );
  if (!opts.dryRun) {
    const shortId = `ext-${createHash("sha1").update(rec.file).digest("hex").slice(0, 12)}`;
    opts.state.upsertTrackFromPlaylist(shortId, 0, ctx.title, "ingest");
    opts.state.markShortSkipped(shortId, rec.file, rec.probe.durationS);
  }
  ctx.proceed = false;
}

/** WAV → AIFF lossless conversion (stream copy, tags ride along).
 *  rekordbox cannot read embedded art from WAVs; AIFF is bit-identical
 *  audio with native art support. Mutates rec.file/probe in place. */
export async function gateWavConversion(ctx: IngestGateCtx): Promise<void> {
  const { rec, opts, counters } = ctx;
  const dot = rec.file.lastIndexOf(".");
  const ext = dot !== -1 ? rec.file.slice(dot).toLowerCase() : "";
  if (ext !== ".wav" || opts.dryRun) return;
  const aiff = await wavToAiff(rec.file);
  if (!aiff) return;
  rec.file = aiff;
  // Same PCM stream in a new container — codec/bit depth are the
  // source's (s16le→s16be etc.), only art presence changes.
  rec.probe = { ...rec.probe, hasArt: true };
  counters.wavConverted++;
  ctx.log(`  ⇄ wav→aiff: ${basename(aiff)}`);
}

/** Player-compat gate — the file must PLAY on the whole booth fleet
 *  (XDJ-XZ / CDJ-3000 / CDJ-2000NXS2 / CDJ-2000). Checked AFTER wav→aiff
 *  so a 96kHz WAV becomes a compliant 96kHz AIFF verdict on the same
 *  probe it will register with. */
export function gatePlayerCompat(ctx: IngestGateCtx): void {
  const { rec, counters } = ctx;
  const compat = playerCompat(rec.probe);
  if (!compat.ok && !isHiresOnly(compat)) {
    counters.compatRejected++;
    ctx.log(
      `  ⛔ player-incompatible (${compat.detail}): ${basename(rec.file)} — left in place`,
    );
    // No DB row on purpose: same treatment as broken files. A `failed`
    // row would be resurrected by `megadj retry` into the download
    // queue; the refusal lives in this log + counter and, if the file
    // ever lands in the archive anyway, the audit's playable gate.
    ctx.proceed = false;
    return;
  }
  if (isHiresOnly(compat)) {
    counters.compatHires++;
    ctx.log(
      `  ⚠ hires-only (${compat.detail}): ${basename(rec.file)} — ingesting; will NOT load on XDJ-XZ / CDJ-2000`,
    );
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** MusicBrainz fill for missing identity fields (politeness-slept), then
 *  the no-"Music"-mint genre normalization (#61): an unknown genre stays
 *  null (fetch fills it later); a real file tag the regex table can't
 *  match survives. Mutates the ctx identity fields in place. */
export async function gateMbFill(ctx: IngestGateCtx): Promise<void> {
  if (!ctx.artist || !ctx.album || !ctx.genre || ctx.genre === "Music") {
    if (ctx.title.length >= 4) {
      await sleep(1100); // MusicBrainz politeness
      const mb = await mbRecording(ctx.artist, ctx.title);
      ctx.artist ||= mb.artist;
      if (!ctx.album && mb.album) ctx.album = mb.album;
      if (!ctx.date && mb.date) ctx.date = mb.date;
      if (!ctx.genre || ctx.genre === "Music")
        ctx.genre = guessFromFreeText([ctx.genre, mb.artistTags, ctx.artist]);
      if (mb.mbid) ctx.mbidUsed = mb.mbid;
    }
  }
  ctx.genre =
    guessFromFreeText([ctx.genre, ctx.artist, ctx.album, ctx.title]) ??
    (ctx.genre && ctx.genre.toLowerCase() !== "music" ? ctx.genre : null);
}
