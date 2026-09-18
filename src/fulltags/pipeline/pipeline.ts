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
import { groundTruth } from "../write/readers";
import { writePatch } from "../write/writer";
import {
  type TrackCtx,
  stageRemixCredit,
  stageTagsMb,
  stageSoundcloudSearch,
  stageBeatportSearch,
  stageGenre,
  stageYear,
  stageBeatportFields,
  noteIdentityFields,
  stageArt,
  stageEnergy,
  stageFingerprint,
  stageBpm,
  stageKey,
  stageMood,
} from "./pipeline-stages";

export { parseMoodStamp, readAiStamps } from "./pipeline-stamps";

// Types + STAGES moved to the leaf (pipeline-types.ts) — re-exported here
// so every existing `from "./pipeline"` import site stays valid (#88).
export type {
  PipelineOptions,
  Stage,
  TrackInput,
  TrackResult,
} from "./pipeline-types";
export { STAGES } from "./pipeline-types";
import type {
  PipelineOptions,
  TrackInput,
  TrackResult,
} from "./pipeline-types";

export { DEFAULT_QUEUE } from "./pipeline-art";

/**
 * One-track pass. Returns the human-readable change notes.
 *
 * Flat sequencer (#88 item 1): every stage arm lives in
 * pipeline-stages.ts as its own function on a shared TrackCtx — this
 * body is the stage ORDER only, so the CCN census (#198) measures the
 * arms individually instead of one 300-line ladder.
 */
export async function enrichTrack(
  t: TrackInput,
  opts: PipelineOptions = {},
): Promise<TrackResult> {
  const notes: string[] = [];
  let artWritten = false;
  const truth = groundTruth(t.path);
  const ctx: TrackCtx = {
    t,
    opts,
    notes,
    patch: {},
    truth,
    scBest: null,
    bpBest: null,
    artWritten: false,
    titleGuess: truth.title ?? t.title ?? null,
  };

  stageRemixCredit(ctx);
  await stageTagsMb(ctx);
  stageSoundcloudSearch(ctx);
  await stageBeatportSearch(ctx);
  stageGenre(ctx);
  stageYear(ctx);
  stageBeatportFields(ctx);
  noteIdentityFields(ctx);
  await stageArt(ctx);
  await stageEnergy(ctx);
  stageFingerprint(ctx);
  await stageBpm(ctx);
  await stageKey(ctx);
  await stageMood(ctx);
  artWritten = ctx.artWritten;

  // ---------- write ----------
  // Art embedding writes the file directly (not via the tag patch), so
  // `wrote` covers both paths — the verify re-read must run whenever the
  // file could have changed, and only then.
  const wrote =
    (!opts.dryRun && Object.keys(ctx.patch).length > 0) || artWritten;
  if (!opts.dryRun && Object.keys(ctx.patch).length > 0) {
    await writePatch(t.path, ctx.patch);
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
