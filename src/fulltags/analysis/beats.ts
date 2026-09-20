import { existsSync } from "node:fs";
import { basename } from "node:path";
import { analyzeBeats, foldTempo, openBeatSession } from "./beats-analysis";
import type { ArchiveState, TrackRow } from "../../archive/state";
import { commandLog } from "../../shared/progress";
import { writeJson } from "../../shared/cli-output";

/**
 * megadj beats — beat_this analysis into the archive DB ledger.
 *
 * Roadmap rev 5 §2/#2 pivot: beat_this's TEMPO fails the tag-write gate
 * (12/24 within 2% vs rekordbox), so no TBPM tags are ever written here.
 * The BEAT/DOWNBEAT ARRAYS are the payload — they feed structure cues
 * and CrateDeck's grid cross-check, and live in the `beats` table only.
 *
 * Each --jobs worker holds a PERSISTENT beat session (NDJSON to the same
 * uv/beat-this env): the uv resolve + torch import + model load is paid
 * once per worker instead of once per track (~1.5–1.9 s/track measured
 * on the old spawn-per-track path).
 *
 * Idempotent: a track with an existing beat record (any model) is
 * skipped unless --force. --json emits one summary object (P1).
 */
export interface BeatsOptions {
  state: ArchiveState;
  musicDir: string;
  jobs?: number | undefined;
  limit?: number | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
  json?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
  /** Skip beat analysis for tracks longer than this many seconds
   *  (default 600 = 10min; 0 disables). */
  maxSeconds?: number | undefined;
}

const MODEL = "beat-this@1.1.0";
/** Tracks longer than this many seconds skip beat analysis by default —
 *  beat_this cost scales with runtime and a long-mix can dominate a batch
 *  (user request, Sep 11; lowered 15→10min Sep 19 to match the mood cap —
 *  analysis targets DJ TRACKS, not multi-hour sets). 0 disables the cap. */
const DEFAULT_MAX_BEAT_SECONDS = 10 * 60;

export async function beats(opts: BeatsOptions): Promise<void> {
  const log = commandLog(opts);
  const jobs = Math.max(1, opts.jobs ?? 2);

  const candidates = opts.state.downloadedWithFiles();
  const maxBeatSeconds =
    opts.maxSeconds === undefined ? DEFAULT_MAX_BEAT_SECONDS : opts.maxSeconds;
  const todo: TrackRow[] = [];
  let tooLong = 0;
  for (const t of candidates) {
    if (!opts.force && opts.state.beatRecord(t.video_id)) continue;
    // Length cap: a long-mix costs minutes of beat_this and adds nothing a
    // DJ needs from the grid — skipped (visible in the log), not failed.
    if (maxBeatSeconds > 0 && (t.duration_s ?? 0) > maxBeatSeconds) {
      tooLong++;
      log(
        `  ⏭ over ${Math.round(maxBeatSeconds / 60)}min cap (${Math.round((t.duration_s ?? 0) / 60)}min) — beats skipped: ${basename(t.file_path ?? "")}`,
      );
      continue;
    }
    todo.push(t);
  }
  let analyzed = 0;
  let failed = 0;
  let idx = 0;

  const limit = opts.limit ?? todo.length;
  const queue = todo.slice(0, Math.max(0, limit));

  // Missing files fail BEFORE any session work (#180): the old in-worker
  // check ran after `openBeatSession()`, so a queue of ghosts still paid
  // the full uv/torch resolve — under `bun test --parallel=16` that spawn
  // raced the default test timeout (the flake). Also just correct: never
  // load the analysis env for nonexistent audio.
  const present: typeof queue = [];
  for (const t of queue) {
    if (existsSync(t.file_path!)) {
      present.push(t);
      continue;
    }
    failed++;
    log(`  ✗ file missing — ${basename(t.file_path!)}`);
  }

  // A zero-work run must read as SUCCESS, not as a silent mystery —
  // "analyzed 0" once read as a bug (it WAS a bug once, the mood queue
  // reference defect) so the summary states WHY nothing was analyzed.
  const already = candidates.length - todo.length;
  if (queue.length === 0 && !opts.force) {
    log(
      `beats: all ${candidates.length} downloaded tracks are already ledgered — nothing to analyze (use --force to re-analyze)`,
    );
  } else {
    log(
      `beats: ${queue.length} track(s) to analyze (${candidates.length} downloaded, ${already} already ledgered)${opts.dryRun ? " · DRY RUN" : ""}`,
    );
  }

  async function worker() {
    // One persistent session per worker: the env load amortizes across
    // this worker's whole queue; null session (env missing) degrades to
    // per-track nulls exactly like the old one-shot path. Opened LAZILY
    // on the first real item (#180): an empty/ghost queue must never pay
    // the uv/torch resolve — under `bun test --parallel=16` that spawn
    // raced the 5s default test timeout and failed both the beats and
    // the drop (beats-stage) suites.
    let session: Awaited<ReturnType<typeof openBeatSession>> | null = null;
    while (true) {
      const my = idx++;
      if (my >= present.length) break;
      if (!session && !opts.dryRun) session = await openBeatSession();
      const t = present[my]!;
      const path = t.file_path!;
      if (opts.dryRun) {
        log(`  [${my + 1}/${present.length}] (dry) — ${basename(path)}`);
        analyzed++;
        continue;
      }
      try {
        const r = await analyzeBeats(path, session);
        if (!r || !r.beats.length) {
          failed++;
          log(
            `  [${my + 1}/${present.length}] ✗ no beats (env missing or silence) — ${basename(path)}`,
          );
          continue;
        }
        opts.state.setBeatRecord({
          videoId: t.video_id,
          bpmRaw: r.bpm,
          bpmFolded: foldTempo(r.bpm),
          beats: r.beats,
          downbeats: r.downbeats,
          model: MODEL,
          sourcePath: path,
          // GA-01: constant-tempo fit lands in the same row (plan.md).
          bpmFitted: r.bpmFitted,
          residualStd: r.residualStd,
        });
        analyzed++;
        log(
          `  [${my + 1}/${present.length}] ${r.beats.length} beats · ${foldTempo(r.bpm).toFixed(1)} BPM (ledger)${r.bpmFitted ? ` · fitted ${r.bpmFitted.toFixed(2)} (residual ${(r.residualStd ?? 0).toFixed(3)} beats)` : ""} — ${basename(path)}`,
        );
      } catch (err) {
        failed++;
        log(
          `  [${my + 1}/${present.length}] ✗ ${(err as Error).message?.slice(0, 80)} — ${basename(path)}`,
        );
      }
    }
    session?.close();
  }
  await Promise.all(Array.from({ length: jobs }, () => worker()));

  const total = opts.state.beatAnalyzedTracks().length;
  if (analyzed === 0 && failed === 0 && !opts.dryRun) {
    log(
      `\nbeats complete: nothing to do — ${total} already ledgered (run with --force to re-analyze)`,
    );
  } else {
    log(
      `\nbeats complete: ${analyzed} analyzed, ${failed} failed, ${tooLong} over length cap, ${total} ledgered total${opts.dryRun ? " (dry run — nothing written)" : ""}`,
    );
  }
  // Exactly one JSON object on stdout in json mode — the P1 contract,
  // through the awaited seam (#159).
  await writeJson({
    command: "beats",
    analyzed,
    failed,
    overLengthCap: tooLong,
    ledgered: total,
    dryRun: opts.dryRun === true,
  });
}
