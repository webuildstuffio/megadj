import { existsSync } from "node:fs";
import { basename } from "node:path";
import { analyzeMoods, type MoodResult } from "./models";
import { groundTruth } from "../write/readers";
import { parseMoodStamp } from "../pipeline/pipeline";
import type { ArchiveState, TrackRow } from "../../archive/state";
import { commandLog } from "../../shared/progress";
import { writeJson } from "../../shared/cli-output";

/**
 * megadj mood — ONNX mood/dance/valence into the archive DB ledger.
 *
 * Roadmap rev 6.1 #4: the models run in `fulltags --mood` (which stamps
 * TXXX:MOOD on the FILE — ground truth). This command mirrors those stamps
 * into the `mood` table so CrateDeck/agents get queryable numbers without
 * re-running ONNX inference. When a downloaded track has NO file stamp,
 * this command analyzes it directly (same models, same writer) and then
 * records it — one command covers both fill and sync.
 *
 * Idempotent: ledgered tracks whose file stamp already matches are
 * skipped unless --force. --json emits one summary object (P1).
 */
export interface MoodOptions {
  state: ArchiveState;
  musicDir: string;
  jobs?: number | undefined;
  limit?: number | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
  json?: boolean | undefined;
  /** I49 "sounds like": also emit + ledger the effnet 1280-d embedding
   * per analyzed track (same probe run — no extra model cost). */
  embeddings?: boolean | undefined;
  /** Skip files longer than this (seconds). Long-form mixes/videos can
   *  take 10+ min EACH in ONNX decode+infer and starve the single-worker
   *  batch (the Sep 19 stall: one 3-hour mix blocked a 172-file run for
   *  20+ min with zero output). Default 10 min — DJ tracks, not DJ sets.
   *  0 disables the cap. */
  maxSeconds?: number | undefined;
  onProgress?: (msg: string) => void;
}

/** Sep 19 (user policy): mood analysis targets DJ tracks — a 10-minute
 *  ceiling keeps one multi-hour mix from starving the whole batch. */
const DEFAULT_MAX_MOOD_SECONDS = 10 * 60;

export async function mood(opts: MoodOptions): Promise<void> {
  const log = commandLog(opts);
  const maxSeconds =
    opts.maxSeconds === undefined ? DEFAULT_MAX_MOOD_SECONDS : opts.maxSeconds;
  if (opts.dryRun) log("dry run: probing queue, no ONNX analysis");

  const candidates = opts.state
    .allTracks()
    .filter(
      (t) =>
        t.status === "downloaded" && t.file_path && existsSync(t.file_path),
    );

  // Shared record shape for both passes (file-stamp sync + ONNX analysis).
  const record = (t: TrackRow, m: MoodResult): void => {
    if (opts.dryRun) return;
    opts.state.setMoodRecord({
      videoId: t.video_id,
      dance: m.danceability,
      aggressive: m.moodAggressive,
      happy: m.moodHappy,
      electronic: m.moodElectronic,
      party: m.moodParty,
      valence: m.valence,
      arousal: m.arousal,
      sourcePath: t.file_path!,
    });
    if (opts.embeddings && m.embedding)
      opts.state.setEmbeddingRecord({
        videoId: t.video_id,
        vec: m.embedding,
        sourcePath: t.file_path!,
      });
  };

  // Pass 1 — sync existing file stamps into the ledger (cheap, no ONNX).
  // Embedding request rides along: every file visited here gets its vector
  // computed in pass 2 anyway, so pass-1 files must not miss out (I49).
  // DB-shortcircuit (Sep 20, #278): a track already ledgered (no --force,
  // no embedding ask) skips the per-file groundTruth scan entirely — that
  // scan is ffprobe+mutagen PER FILE, and on a 3.9k-file library with
  // network mounts it was minutes of silent spawning (the "mood wedges"
  // report). Only UNledgered candidates pay the file-read cost.
  const pass1 = syncPass(opts, candidates, record);
  const needAnalysis = buildAnalysisQueue(opts, pass1, candidates);

  // Length cap (Sep 19): probe duration once; over-cap files are counted
  // honestly (`overLengthCap`) instead of wedging the batch — the queue
  // is ONE python worker, so a 3-hour mix previously stalled everything
  // behind it with zero output.
  const runnable: TrackRow[] = [];
  let overLengthCap = 0;
  for (const t of needAnalysis) {
    if (maxSeconds > 0 && (t.duration_s ?? 0) > maxSeconds) {
      overLengthCap++;
      continue;
    }
    runnable.push(t);
  }
  if (overLengthCap > 0)
    log(
      `  skipping ${overLengthCap} file(s) over the ${Math.round(maxSeconds / 60)}-min cap (re-run with --max-seconds 0 to include)`,
    );

  // Dry-run reports the would-be workload WITHOUT spawning ONNX (the old
  // behavior analyzed the whole queue "dry" — a dry-run that takes an
  // hour is not a dry run).
  if (opts.dryRun) {
    log(
      `  would analyze ${runnable.length} file(s), skip ${overLengthCap} over cap`,
    );
    await emitMoodSummary(opts, {
      ...pass1,
      analyzed: 0,
      failed: 0,
      overLengthCap,
    });
    return;
  }

  // Pass 2 — analyze tracks with no (or malformed) file stamps, in
  // chunks: analyzeMoods streams ONE python worker over its whole input,
  // so results only land per completed file — chunking bounds the blast
  // radius of a wedged decode and makes progress visible per chunk.
  let analyzed = 0;
  let failed = 0;
  const CHUNK = 20;
  for (let i = 0; i < runnable.length; i += CHUNK) {
    const chunk = runnable.slice(i, i + CHUNK);
    log(`  mood chunk ${i + 1}-${i + chunk.length} of ${runnable.length}…`);
    const result = await analysisPass(opts, chunk, record, log);
    analyzed += result.analyzed;
    failed += result.failed;
  }

  await emitMoodSummary(opts, {
    ...pass1,
    analyzed,
    failed,
    overLengthCap,
  });
}

/** Pass-1 counters (synced from file stamps). */
interface SyncCounts {
  synced: number;
  energySynced: number;
}

/** Pass 1 — for every candidate: mirror the file's energy stamp into the
 *  DB column, and ledger the mood record when a valid stamp exists.
 *  Stamped-but-unembedded tracks are returned for pass 2 (ONNX only). */
function syncPass(
  opts: MoodOptions,
  candidates: TrackRow[],
  record: (t: TrackRow, m: MoodResult) => void,
): SyncCounts & { needEmbedding: TrackRow[] } {
  let synced = 0;
  let energySynced = 0;
  const needEmbedding: TrackRow[] = [];
  for (const t of candidates) {
    // Embedding-gap check is a CHEAP DB read — do it before any file scan.
    // A row that still owes an embedding is the ONE case where an
    // --embeddings run has pass-2 work beyond fresh analysis (and under
    // --embeddings the gap check must run even in dry-run so the probe
    // reports the true would-do queue).
    const owesEmbedding =
      opts.embeddings === true && !opts.state.embeddingRecord(t.video_id);
    // DB short-circuit (#278, and — since #279 — for --embeddings runs
    // too): ledgered means ANALYZED. The old shape let --embeddings
    // disable this, so every ledgered row paid the per-file groundTruth
    // scan and the unstamped ones (the whole RB-mirror cohort) re-queued
    // for FULL ONNX re-analysis — the 3,113-file ~8h storm killed live
    // Sep 20. A ledgered row's only possible remaining work is the
    // embedding gap, and only when the file carries a stamp to re-read.
    if (!owesEmbedding && !opts.force && opts.state.moodRecord(t.video_id))
      continue;
    const truth = groundTruth(t.file_path!);
    // Energy stamp → DB column mirror (same idea as the mood ledger sync:
    // the file is ground truth; the column feeds audit/complete checks).
    if (truth.energy !== null && t.energy === null && !opts.dryRun) {
      opts.state.updateEnergyColumn(t.video_id, truth.energy);
      energySynced++;
    }
    const stamp = truth.mood;
    const m = stamp ? parseMoodStamp(stamp) : undefined;
    if (!m) continue;
    if (owesEmbedding) {
      // stamp exists but no embedding yet — queue for pass 2 (ONNX only).
      // NO stamp (RB-mirror rows) → dropped here AND by the queue filter
      // (ledgered) — refilling THAT gap is a full re-analysis, i.e. a
      // deliberate --force, never an --embeddings side effect (#279).
      needEmbedding.push(t);
      continue;
    }
    if (!opts.force && opts.state.moodRecord(t.video_id)) continue;
    record(t, m);
    synced++;
  }
  return { synced, energySynced, needEmbedding };
}

/** The ONNX queue: every track without a valid file stamp (analysis
 *  needed), plus stamped-but-unembedded tracks when embeddings are on.
 *  --limit caps the ONNX pass (help documents it); pass-1 stamp sync is
 *  cheap and stays whole-file so no stamp is left unsynced.
 *  BUGFIX (Sep 10 2026 "mood analyzes nothing"): when limit is undefined
 *  the ternary handed back the SAME array reference, and the unconditional
 *  `needAnalysis.length = 0` below then wiped the refill source too — the
 *  ONNX pass silently became a no-op on every flagless `megadj mood` run
 *  (the `--limit N` path took `slice(` and worked, hiding the defect).
 *  Copy first (`slice()` unconditionally), then truncate the original. */
function buildAnalysisQueue(
  opts: MoodOptions,
  pass1: SyncCounts & { needEmbedding: TrackRow[] },
  candidates: TrackRow[],
): TrackRow[] {
  const needAnalysis = candidates.filter((t) => {
    // DB short-circuit first (#278): file scans are the expensive part.
    // --embeddings does NOT lift this (#279): a ledgered row is analyzed;
    // its embedding gap (if any) rides through syncPass's stamped-file
    // path, and refilling a no-stamp gap is a --force decision, never an
    // --embeddings side effect. Dry-run probes keep the file scan so the
    // would-do report stays honest.
    if (!opts.force && !opts.dryRun && opts.state.moodRecord(t.video_id))
      return false;
    const truth = groundTruth(t.file_path!);
    return !(truth.mood && parseMoodStamp(truth.mood));
  });
  needAnalysis.push(...pass1.needEmbedding);
  const analysisQueue = needAnalysis.slice(
    0,
    opts.limit === undefined ? needAnalysis.length : Math.max(0, opts.limit),
  );
  needAnalysis.length = 0;
  needAnalysis.push(...analysisQueue);
  return needAnalysis;
}

/** Pass 2 — ONNX analysis for the queue; each result is recorded through
 *  the same `record` seam as pass 1. */
async function analysisPass(
  opts: MoodOptions,
  needAnalysis: TrackRow[],
  record: (t: TrackRow, m: MoodResult) => void,
  log: (msg: string) => void,
): Promise<{ analyzed: number; failed: number }> {
  let analyzed = 0;
  let failed = 0;
  if (!needAnalysis.length) return { analyzed, failed };
  const results = await analyzeMoods(
    needAnalysis.map((t) => t.file_path!),
    {
      withEmbedding: opts.embeddings === true,
    },
  );
  for (const t of needAnalysis) {
    const m = results.get(t.file_path!);
    if (!m) {
      failed++;
      continue;
    }
    record(t, m);
    analyzed++;
    log(
      `  analyzed dance=${m.danceability.toFixed(2)} V=${m.valence.toFixed(1)} A=${m.arousal.toFixed(1)} — ${basename(t.file_path!)}`,
    );
  }
  return { analyzed, failed };
}

/** Summary line + the --json payload. A zero-work run must read as
 *  SUCCESS (same contract as beats/cues): "analyzed 0" once WAS a real
 *  bug (the queue reference defect), so the summary now states why
 *  nothing ran. */
async function emitMoodSummary(
  opts: MoodOptions,
  counts: SyncCounts & {
    analyzed: number;
    failed: number;
    overLengthCap: number;
  },
): Promise<void> {
  const log = commandLog(opts);
  const { synced, analyzed, failed, energySynced, overLengthCap } = counts;
  const total = opts.state.moodSummary().analyzed;
  const embedded = opts.embeddings
    ? opts.state.embeddingCorpus().length
    : undefined;
  const capNote =
    overLengthCap > 0 ? `, ${overLengthCap} over length cap (skipped)` : "";
  if (
    synced === 0 &&
    analyzed === 0 &&
    failed === 0 &&
    energySynced === 0 &&
    overLengthCap === 0 &&
    !opts.dryRun
  ) {
    log(
      `\nmood complete: nothing to do — all ${total} tracks already ledgered (run with --force to re-analyze)`,
    );
  } else {
    log(
      `\nmood complete: ${synced} synced from file stamps, ${analyzed} analyzed, ${failed} failed, ${energySynced} energy columns synced${capNote}, ${total} ledgered total${opts.dryRun ? " (dry run — nothing written)" : ""}${embedded !== undefined ? `, ${embedded} embedded` : ""}`,
    );
  }
  await writeJson({
    command: "mood",
    synced,
    analyzed,
    failed,
    energySynced,
    overLengthCap,
    ledgered: total,
    ...(embedded !== undefined ? { embedded } : {}),
    dryRun: opts.dryRun === true,
  });
}
