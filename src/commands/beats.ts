import { existsSync } from "node:fs";
import { basename } from "node:path";
import { analyzeBeats, foldTempo } from "../../fulltags/src/analysis";
import type { ArchiveState, TrackRow } from "../state";

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
  jobs?: number;
  limit?: number;
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
  onProgress?: (msg: string) => void;
}

const MODEL = "beat-this@1.1.0";

export async function beats(opts: BeatsOptions): Promise<void> {
  // P1 (--json on every command): human progress goes to stderr in json
  // mode — stdout carries exactly one JSON object. Same fix class as
  // sync/enrich/organize/adopt before it.
  const log = opts.json
    ? (m: string) => process.stderr.write(`${m}\n`)
    : (opts.onProgress ?? ((m: string) => console.log(m)));
  const jobs = Math.max(1, opts.jobs ?? 2);

  const candidates = opts.state
    .allTracks()
    .filter((t) => t.status === "downloaded" && t.file_path);
  const todo: TrackRow[] = [];
  for (const t of candidates) {
    if (!opts.force && opts.state.beatRecord(t.video_id)) continue;
    todo.push(t);
  }
  const limit = opts.limit ?? todo.length;
  const queue = todo.slice(0, Math.max(0, limit));

  log(
    `beats: ${queue.length} track(s) to analyze (${candidates.length} downloaded, ${candidates.length - todo.length} already ledgered)${opts.dryRun ? " · DRY RUN" : ""}`,
  );

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
        });
        analyzed++;
        log(
          `  [${my + 1}/${queue.length}] ${r.beats.length} beats · ${foldTempo(r.bpm).toFixed(1)} BPM (ledger) — ${basename(path)}`,
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
  log(
    `\nbeats complete: ${analyzed} analyzed, ${failed} failed, ${total} ledgered total${opts.dryRun ? " (dry run — nothing written)" : ""}`,
  );
  // Exactly one JSON object on stdout in json mode — the P1 contract.
  console.log(
    JSON.stringify({
      command: "beats",
      analyzed,
      failed,
      ledgered: total,
      dryRun: opts.dryRun === true,
    }),
  );
}
