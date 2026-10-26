/**
 * bar-rerun.ts — Library rerun: megadj analyze --bars (B2.3).
 *
 * Scaffolding for the library-wide bar-level reanalysis pass. This module
 * manages the rerun queue — determining which tracks need bar analysis,
 * tracking progress, and reporting results.
 *
 * The actual analysis uses the per-patch → per-bar pipeline (bar-curves.ts).
 */
import { round3 } from "../../shared/leaf/fmt";

/** Track's bar-analysis status. */
export type BarAnalysisStatus = "pending" | "analyzed" | "failed" | "skipped";

/** Track analysis queue entry. */
export interface BarRerunEntry {
  readonly trackId: string;
  readonly status: BarAnalysisStatus;
  /** Number of bars analyzed. */
  readonly barCount: number | null;
  /** Analysis timestamp (ISO). */
  readonly analyzedAt: string | null;
  /** Reason for skip/failure. */
  readonly reason: string | null;
}

/** Rerun progress summary. */
export interface BarRerunProgress {
  readonly total: number;
  readonly analyzed: number;
  readonly pending: number;
  readonly failed: number;
  readonly skipped: number;
  readonly percentComplete: number;
}

/**
 * Compute rerun progress from queue entries.
 */
export function computeProgress(entries: readonly BarRerunEntry[]): BarRerunProgress {
  let analyzed = 0;
  let pending = 0;
  let failed = 0;
  let skipped = 0;

  for (const e of entries) {
    switch (e.status) {
      case "analyzed":
        analyzed++;
        break;
      case "pending":
        pending++;
        break;
      case "failed":
        failed++;
        break;
      case "skipped":
        skipped++;
        break;
    }
  }

  const total = entries.length;
  return {
    total,
    analyzed,
    pending,
    failed,
    skipped,
    percentComplete: total > 0 ? round3((analyzed / total) * 100) : 0,
  };
}

/**
 * Determine which tracks need bar-level analysis.
 *
 * Criteria:
 * - Has beats (beat grid from beat_this)
 * - No bar analysis yet OR force flag set
 * - Not over the duration cap
 */
export function buildRerunQueue(
  tracks: readonly {
    trackId: string;
    hasBeats: boolean;
    hasBarAnalysis: boolean;
    durationSeconds: number;
  }[],
  opts: { force?: boolean; maxDurationSeconds?: number } = {},
): BarRerunEntry[] {
  const maxDur = opts.maxDurationSeconds ?? 600; // 10 min default cap

  return tracks.map((t) => {
    if (!t.hasBeats) {
      return {
        trackId: t.trackId,
        status: "skipped" as const,
        barCount: null,
        analyzedAt: null,
        reason: "no beats",
      };
    }

    if (t.durationSeconds > maxDur) {
      return {
        trackId: t.trackId,
        status: "skipped" as const,
        barCount: null,
        analyzedAt: null,
        reason: `over duration cap (${t.durationSeconds}s > ${maxDur}s)`,
      };
    }

    if (t.hasBarAnalysis && opts.force !== true) {
      return {
        trackId: t.trackId,
        status: "analyzed" as const,
        barCount: null,
        analyzedAt: null,
        reason: null,
      };
    }

    return {
      trackId: t.trackId,
      status: "pending" as const,
      barCount: null,
      analyzedAt: null,
      reason: null,
    };
  });
}
