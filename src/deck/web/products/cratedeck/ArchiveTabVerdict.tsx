// ArchiveTabVerdict.tsx — the archive verdict engine + banner (#233
// split from ArchiveTab.tsx): the PURE metrics/issue derivation (no I/O,
// no JSX in the metrics half) plus the VerdictBanner render. ArchiveTab
// keeps the data fetch and the section layout; this module owns the
// "is my library healthy" answer.
import type {
  ArchiveGridCrossCheck,
  ArchiveIngestStatus,
  ArchiveLowqQueue,
  ArchiveMoodProfile,
} from "../../../shared/types";
import { Icon } from "../../ui/icons";
import { Verdict } from "../shared";

export type IngestPayload = ArchiveIngestStatus;
export type MoodPayload = ArchiveMoodProfile;
export type LowqPayload = ArchiveLowqQueue;
export type GridPayload = ArchiveGridCrossCheck;

/** The work queue inputs, derived once from the payloads (pure — no I/O,
 *  no JSX). Shared by the verdict banner and the "Needs work" section. */
export interface ArchiveVerdict {
  issues: { n: number; text: string }[];
  syncRisk: number;
  qualityDebt: number;
  retryBacklog: number;
  unanalyzed: number;
  analyzed: number;
  inArchive: number;
}

/** Raw work-queue metrics pulled off the payloads (pure). */
export interface ArchiveMetrics {
  syncRisk: number;
  qualityDebt: number;
  retryBacklog: number;
  unanalyzed: number;
  analyzed: number;
  inArchive: number;
}

export function archiveMetrics(
  ingest: IngestPayload,
  mood: MoodPayload | null,
  lowq: LowqPayload | null,
  grid: GridPayload | null,
): ArchiveMetrics {
  const syncRisk = grid?.available
    ? grid.off.length + grid.octave.length + grid.drift.length
    : 0;
  const qualityDebt = lowq?.available ? lowq.tracks.length : 0;
  const retryBacklog = ingest.available
    ? (ingest.counts["failed"] ?? 0) + (ingest.counts["gone"] ?? 0)
    : 0;
  const analyzed = mood?.available ? mood.analyzed : 0;
  const inArchive = ingest.available ? (ingest.counts["downloaded"] ?? 0) : 0;
  // unmetered = in the archive but no mood stamp — the analysis backlog
  const unanalyzed =
    inArchive > 0 && mood?.available ? Math.max(0, inArchive - analyzed) : 0;
  return {
    syncRisk,
    qualityDebt,
    retryBacklog,
    unanalyzed,
    analyzed,
    inArchive,
  };
}

/** One issue pill per non-zero metric (table of label fns, #199). */
function metricIssues(m: ArchiveMetrics): { n: number; text: string }[] {
  return [
    m.syncRisk > 0 && {
      n: m.syncRisk,
      text: `${m.syncRisk} track${m.syncRisk === 1 ? "" : "s"} will Beat Sync badly (grid check)`,
    },
    m.qualityDebt > 0 && {
      n: m.qualityDebt,
      text: `${m.qualityDebt} below the quality bar (LOWQ)`,
    },
    m.retryBacklog > 0 && {
      n: m.retryBacklog,
      text: `${m.retryBacklog} failed/gone downloads to retry or drop`,
    },
    m.unanalyzed > 0 && {
      n: m.unanalyzed,
      text: `${m.unanalyzed} not yet mood-analyzed`,
    },
  ].filter((x): x is { n: number; text: string } => Boolean(x));
}

export function deriveVerdict(
  ingest: IngestPayload,
  mood: MoodPayload | null,
  lowq: LowqPayload | null,
  grid: GridPayload | null,
): ArchiveVerdict {
  const metrics = archiveMetrics(ingest, mood, lowq, grid);
  return { issues: metricIssues(metrics), ...metrics };
}

/** The verdict banner + secondary issue pills. */
export function VerdictBanner(props: {
  verdict: ArchiveVerdict;
  inArchive: number;
  analyzed: number;
  moodAvailable: boolean;
}) {
  const { issues } = props.verdict;
  const verdict =
    issues.length === 0
      ? {
          cls: "ok",
          text: "Archive is healthy — everything analyzed, nothing flagged.",
        }
      : {
          cls: "warn",
          text: `${issues[0]!.text}${issues.length > 1 ? ` · +${issues.length - 1} more below` : ""}`,
        };
  return (
    <>
      <Verdict
        cls={verdict.cls === "ok" ? "ok" : "warn"}
        text={verdict.text}
        meta={
          <>
            {props.inArchive.toLocaleString()} in the archive
            {props.moodAvailable && props.analyzed > 0 && (
              <> · {props.analyzed} analyzed</>
            )}
          </>
        }
      />
      {issues.length > 1 && (
        <div class="arch-issues">
          {issues.slice(1).map((i) => (
            <span key={i.text} class="arch-issue">
              <Icon name="dot" size={10} /> {i.text}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
