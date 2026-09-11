import { existsSync } from "node:fs";
import { basename } from "node:path";
import { analyzeBeats, foldTempo } from "../../fulltags/src/analysis";
import type { ArchiveState, TrackRow } from "../archive/state";
import { commandLog } from "../progress";

/**
 * megadj beats — beat_this analysis into the archive DB ledger.
 *
 * Roadmap rev 5 §2/#2 pivot: beat_this's TEMPO fails the tag-write gate
 * (12/24 within 2% vs rekordbox), so no TBPM tags are ever written here.
 * The BEAT/DOWNBEAT ARRAYS are the payload — they feed structure cues
 * and CrateDeck's grid cross-check, and live in the `beats` table only.
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
   *  (default 900 = 15min; 0 disables). */
  maxSeconds?: number | undefined;
}

const MODEL = "beat-this@1.1.0";
/** Tracks longer than this many seconds skip beat analysis by default —
 *  beat_this cost scales with runtime and a 40-minute long-mix can dominate
 *  a batch (user request, Sep 11). 0 disables the cap. */
const DEFAULT_MAX_BEAT_SECONDS = 15 * 60;

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
  const limit = opts.limit ?? todo.length;
  const queue = todo.slice(0, Math.max(0, limit));

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

  let analyzed = 0;
  let failed = 0;
  let idx = 0;
  async function worker() {
    while (true) {
      const my = idx++;
      if (my >= queue.length) break;
      const t = queue[my]!;
      const path = t.file_path!;
      if (opts.dryRun) {
        log(`  [${my + 1}/${queue.length}] (dry) — ${basename(path)}`);
        analyzed++;
        continue;
      }
      if (!existsSync(path)) {
        failed++;
        log(`  [${my + 1}/${queue.length}] ✗ file missing — ${basename(path)}`);
        continue;
      }
      try {
        const r = await analyzeBeats(path);
        if (!r || !r.beats.length) {
          failed++;
          log(
            `  [${my + 1}/${queue.length}] ✗ no beats (env missing or silence) — ${basename(path)}`,
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
          `  [${my + 1}/${queue.length}] ${r.beats.length} beats · ${foldTempo(r.bpm).toFixed(1)} BPM (ledger)${r.bpmFitted ? ` · fitted ${r.bpmFitted.toFixed(2)} (residual ${(r.residualStd ?? 0).toFixed(3)} beats)` : ""} — ${basename(path)}`,
        );
      } catch (err) {
        failed++;
        log(
          `  [${my + 1}/${queue.length}] ✗ ${(err as Error).message?.slice(0, 80)} — ${basename(path)}`,
        );
      }
    }
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
  // Exactly one JSON object on stdout in json mode — the P1 contract.
  console.log(
    JSON.stringify({
      command: "beats",
      analyzed,
      failed,
      overLengthCap: tooLong,
      ledgered: total,
      dryRun: opts.dryRun === true,
    }),
  );
}
