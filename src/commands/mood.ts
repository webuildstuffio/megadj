import { existsSync } from "node:fs";
import { basename } from "node:path";
import {
  analyzeMoods,
  groundTruth,
  parseMoodStamp,
  type MoodResult,
} from "../../fulltags/src/exports";
import type { ArchiveState, TrackRow } from "../state";
import { commandLog } from "../progress";

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
  onProgress?: (msg: string) => void;
}

export async function mood(opts: MoodOptions): Promise<void> {
  const log = commandLog(opts);

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
  let synced = 0;
  const needAnalysis: TrackRow[] = [];
  const needEmbedding: TrackRow[] = [];
  for (const t of candidates) {
    const stamp = groundTruth(t.file_path!).mood;
    const m = stamp ? parseMoodStamp(stamp) : undefined;
    if (!m) {
      needAnalysis.push(t);
      continue;
    }
    if (
      opts.embeddings &&
      !opts.dryRun &&
      !opts.state.embeddingRecord(t.video_id)
    ) {
      // stamp exists but no embedding yet — queue for pass 2 (ONNX only)
      needEmbedding.push(t);
      continue;
    }
    if (!opts.force && opts.state.moodRecord(t.video_id)) continue;
    record(t, m);
    synced++;
  }
  needAnalysis.push(...needEmbedding);
  // --limit caps the ONNX pass (help documents it); pass-1 stamp sync is
  // cheap and stays whole-file so no stamp is left unsynced.
  // BUGFIX (Sep 10 2026 "mood analyzes nothing"): when limit is undefined
  // the ternary handed back the SAME array reference, and the unconditional
  // `needAnalysis.length = 0` below then wiped the refill source too — the
  // ONNX pass silently became a no-op on every flagless `megadj mood` run
  // (the `--limit N` path took `slice()` and worked, hiding the defect).
  // Copy first (`slice()` unconditionally), then truncate the original.
  const analysisQueue = needAnalysis.slice(
    0,
    opts.limit === undefined ? needAnalysis.length : Math.max(0, opts.limit),
  );
  needAnalysis.length = 0;
  needAnalysis.push(...analysisQueue);

  // Pass 2 — analyze tracks with no (or malformed) file stamps.
  let analyzed = 0;
  let failed = 0;
  if (needAnalysis.length) {
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
  }

  const total = opts.state.moodSummary().analyzed;
  const embedded = opts.embeddings
    ? opts.state.embeddingCorpus().length
    : undefined;
  log(
    `\nmood complete: ${synced} synced from file stamps, ${analyzed} analyzed, ${failed} failed, ${total} ledgered total${opts.dryRun ? " (dry run — nothing written)" : ""}${embedded !== undefined ? `, ${embedded} embedded` : ""}`,
  );
  console.log(
    JSON.stringify({
      command: "mood",
      synced,
      analyzed,
      failed,
      ledgered: total,
      ...(embedded !== undefined ? { embedded } : {}),
      dryRun: opts.dryRun === true,
    }),
  );
}
