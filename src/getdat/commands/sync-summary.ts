// sync-summary.ts — the sync run's report tail (#211 split from
// sync.ts): the run-row finish + human summary lines + the P1 --json
// payload. The command body stays flag-parse → flow → summarize. The
// --json seam goes through the awaited writeJson path (never raw
// console.log JSON — the pipe-EOF boundary rule).
import { writeJson } from "../../shared/cli-output";
import type { SyncTotals } from "./sync";

/** Phase 4: run row + human/JSON summary (moved verbatim, #211). */
export async function finishRun(
  opts: {
    state: {
      finishRun: (
        runId: number,
        s: {
          attempted: number;
          downloaded: number;
          gone: number;
          failed: number;
          bytesDownloaded: number;
        },
      ) => unknown;
      statusCounts: () => Record<string, number>;
    };
    json?: boolean | undefined;
    dryRun?: boolean | undefined;
  },
  log: (msg: string) => void,
  runId: number | null,
  totals: SyncTotals,
): Promise<void> {
  if (runId !== null) {
    opts.state.finishRun(runId, {
      attempted: totals.attempted,
      downloaded: totals.downloaded,
      gone: totals.gone,
      failed: totals.failed,
      bytesDownloaded: totals.bytes,
    });
  }
  log(
    `\nrun complete: ${totals.downloaded} downloaded, ${totals.notMusic} not-music, ${totals.gone} gone, ${totals.failed} failed, ${(totals.bytes / 1e6).toFixed(1)} MB`,
  );
  const counts = opts.state.statusCounts();
  log(
    `archive: ${counts["downloaded"] ?? 0} downloaded / ${counts["gone"] ?? 0} gone / ${counts["failed"] ?? 0} failed / ${counts["pending"] ?? 0} pending / ${counts["skipped_not_music"] ?? 0} not-music`,
  );
  if (opts.json) {
    // P1 (--json on every command): one summary object on stdout, last.
    await writeJson({
      command: "sync",
      dryRun: opts.dryRun ?? false,
      runId,
      attempted: totals.attempted,
      downloaded: totals.downloaded,
      notMusic: totals.notMusic,
      gone: totals.gone,
      failed: totals.failed,
      bytesDownloaded: totals.bytes,
      // Dry runs only ever "would download" — give agents the queue size
      // a real run would have attempted.
      wouldAttempt: opts.dryRun ? totals.attempted : undefined,
      archive: {
        downloaded: counts["downloaded"] ?? 0,
        gone: counts["gone"] ?? 0,
        failed: counts["failed"] ?? 0,
        pending: counts["pending"] ?? 0,
        skippedNotMusic: counts["skipped_not_music"] ?? 0,
      },
    });
  }
}
