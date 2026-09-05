import { existsSync } from "node:fs";
import { basename } from "node:path";
import {
  analyzeMoods,
  groundTruth,
  parseMoodStamp,
} from "../../fulltags/src/exports";
import type { ArchiveState, TrackRow } from "../state";

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
  jobs?: number;
  limit?: number;
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
  onProgress?: (msg: string) => void;
}

export async function mood(opts: MoodOptions): Promise<void> {
  const log = opts.json
    ? (m: string) => process.stderr.write(`${m}\n`)
    : (opts.onProgress ?? ((m: string) => console.log(m)));

  const candidates = opts.state
    .allTracks()
    .filter(
      (t) =>
        t.status === "downloaded" && t.file_path && existsSync(t.file_path),
    );

  // Pass 1 — sync existing file stamps into the ledger (cheap, no ONNX).
  let synced = 0;
  const needAnalysis: TrackRow[] = [];
  for (const t of candidates) {
    const stamp = groundTruth(t.file_path!).mood;
    if (!stamp) {
      needAnalysis.push(t);
      continue;
    }
    const m = parseMoodStamp(stamp);
    if (!m) {
      needAnalysis.push(t);
      continue;
    }
    if (!opts.force && opts.state.moodRecord(t.video_id)) continue;
    if (!opts.dryRun) {
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
    }
    synced++;
  }

  // Pass 2 — analyze tracks with no (or malformed) file stamps.
  let analyzed = 0;
  let failed = 0;
  if (needAnalysis.length) {
    const results = await analyzeMoods(needAnalysis.map((t) => t.file_path!));
    for (const t of needAnalysis) {
      const m = results.get(t.file_path!);
      if (!m) {
        failed++;
        continue;
      }
      if (!opts.dryRun) {
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
      }
      analyzed++;
      log(
        `  analyzed dance=${m.danceability.toFixed(2)} V=${m.valence.toFixed(1)} A=${m.arousal.toFixed(1)} — ${basename(t.file_path!)}`,
      );
    }
  }

  const total = opts.state.moodSummary().analyzed;
  log(
    `\nmood complete: ${synced} synced from file stamps, ${analyzed} analyzed, ${failed} failed, ${total} ledgered total${opts.dryRun ? " (dry run — nothing written)" : ""}`,
  );
  console.log(
    JSON.stringify({
      command: "mood",
      synced,
      analyzed,
      failed,
      ledgered: total,
      dryRun: opts.dryRun === true,
    }),
  );
}
