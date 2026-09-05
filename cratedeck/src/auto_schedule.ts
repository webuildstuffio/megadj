// auto_schedule.ts — decides which jobs should start automatically.
// Pure functions: registry mount events feed shouldAutoScan, the drive's
// last-verify age feeds shouldAutoVerify. The JobEngine's own dedupe
// (activeJobOfKind) + interlock are the safety net; this module only decides
// intent, never runs anything.

export interface AutoScanInput {
  mounted: boolean;
  /** Just flipped ghost → mounted on this sweep? */
  justMounted: boolean;
  /** true if a full scan snapshot exists and is newer than the last light one */
  hasFreshSnapshot: boolean;
}

/** On mount → auto light-scan so the card wakes up without a manual click.
 *  Skip when a fresh snapshot already exists (re-plug without changes). */
export function shouldAutoScan(
  input: AutoScanInput,
  enabled: boolean,
): boolean {
  if (!enabled) return false;
  if (!input.justMounted || !input.mounted) return false;
  return !input.hasFreshSnapshot;
}

export interface AutoVerifyInput {
  mounted: boolean;
  /** Date.now() of the last successful verify, or null = never verified. */
  lastVerifyAt: number | null;
  /** A verify is worthless while a scan/verify/mirror is already queued. */
  hasActiveJob: boolean;
  now: number;
}

/** Weekly auto-verify (ideas.md §C17): a drive whose last verify is older
 *  than intervalDays gets one when it's mounted. Never-verified drives are
 *  prioritized the moment they mount. */
export function shouldAutoVerify(
  input: AutoVerifyInput,
  intervalDays: number,
): boolean {
  if (intervalDays <= 0) return false;
  if (!input.mounted || input.hasActiveJob) return false;
  if (input.lastVerifyAt === null) return true;
  const ageDays = (input.now - input.lastVerifyAt) / 86_400_000;
  return ageDays >= intervalDays;
}

/** Human-readable "why" for the auto-decision, shown in the job message. */
export function autoVerifyReason(
  input: AutoVerifyInput,
  intervalDays: number,
): string {
  if (input.lastVerifyAt === null)
    return "never verified — auto-running first verify";
  const ageDays = Math.floor((input.now - input.lastVerifyAt) / 86_400_000);
  return `last verified ${ageDays}d ago (interval ${intervalDays}d) — auto-verifying`;
}
