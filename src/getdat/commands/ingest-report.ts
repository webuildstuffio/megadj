/**
 * GetDat ingest — report half (#88 item 3): the run summary (human
 * segments + the P1 --json payload). The payload is keyed over THE counter
 * list (src/deck/shared/types.ts, issue #159) so a key added to
 * IntakeResult fails typecheck here until produced, and cratedeck's
 * parser needs no hand-copied twin list.
 */
import { basename } from "node:path";
import { commandLog } from "../../shared/progress";
import { writeJson } from "../../shared/cli-output";
import type { IntakeCounterKey } from "../../deck/shared/types";
import { counterSummary, type IngestCounters } from "./ingest-register";

export interface IngestRunStats {
  files: number;
  folderDupes: number;
  archiveDupes: number;
  upgrades: number;
  broken: string[];
  minDuration: number;
}

/** The human summary: [segment, condition] pairs — a segment only joins
 * the line when its condition holds, so a zero counter stays silent. */
export async function emitIngestReport(
  opts: { json?: boolean | undefined; dryRun?: boolean | undefined },
  counters: IngestCounters,
  run: IngestRunStats,
  quarantineDir: string,
): Promise<void> {
  const log = commandLog(opts);
  const dupesTotal = run.folderDupes + run.archiveDupes;
  const segments: [string, boolean][] = [
    [`${counters.tagged} retagged`, true],
    [`${counters.artAdded} artwork embedded`, true],
    [`${counters.wavConverted} wav→aiff`, counters.wavConverted > 0],
    [
      `${counters.compatRejected} PLAYER-INCOMPATIBLE (left in place)`,
      counters.compatRejected > 0,
    ],
    [
      `${counters.compatHires} hires-only (no XDJ-XZ/CDJ-2000)`,
      counters.compatHires > 0,
    ],
    [
      `${counters.artQueued} artwork QUEUED for image-maker`,
      counters.artQueued > 0,
    ],
    [
      `${counters.artSkippedWav} wav skipped for art`,
      counters.artSkippedWav > 0,
    ],
    [
      `${counters.shortSkipped} skipped (<${run.minDuration}s)`,
      counters.shortSkipped > 0,
    ],
    [`${counters.unchanged} already clean`, true],
    [`${run.folderDupes} in-folder dupes`, true],
    [
      `${run.archiveDupes} archive dupes (${run.upgrades} quality upgrades)`,
      true,
    ],
    [`${run.broken.length} BROKEN (left in place)`, run.broken.length > 0],
    [
      `${counters.writeFailed} TAG-WRITE FAILED (left in place, see ✗ lines)`,
      counters.writeFailed > 0,
    ],
  ];
  const doneLine = segments
    .filter(([, keep]) => keep)
    .map(([text]) => text)
    .join(", ");
  log(`\ndone: ${doneLine}`);

  if (opts.dryRun) log("(dry run — nothing written)");
  else if (dupesTotal > 0) log(`duplicates moved to: ${quarantineDir}`);
  if (run.broken.length > 0)
    log(`broken files:\n  ${run.broken.map((b) => basename(b)).join("\n  ")}`);

  if (!opts.json) return;
  // P1 (--json on every command): one summary object on stdout, LAST.
  // Awaited here — fire-and-forget console.log truncated piped output
  // (#53's EOF class).
  await writeIngestJson(counters, run, opts.dryRun ?? false);
}

/** The --json payload (async tail of the report seam). */
async function writeIngestJson(
  counters: IngestCounters,
  run: IngestRunStats,
  dryRun: boolean,
): Promise<void> {
  const summary = {
    // run-derived counters (not in IngestCounters — computed by the caller)
    files: run.files,
    folderDupes: run.folderDupes,
    archiveDupes: run.archiveDupes,
    upgrades: run.upgrades,
    broken: run.broken.length,
    // counter-backed keys, derived: IngestCounters ∩ INTAKE_COUNTER_KEYS
    ...counterSummary(counters),
  } satisfies Record<IntakeCounterKey, number>;
  await writeJson({ command: "ingest", dryRun, ...summary });
}
