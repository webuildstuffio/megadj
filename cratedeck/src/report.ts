// report.ts — health checks + one-JSON dossier per drive. Pure functions:
// takes DB state + latest snapshot, returns verdicts. No I/O here.
// The individual check builders live in report_checks.ts (file-length
// guard); this module keeps the ReportInput contract + the aggregators.
import type {
  DriveReport,
  CheckStatus,
  HealthCheck,
  OverallHealth,
  ReportSummary,
  SyncVerdict,
} from "../shared/types";
import { BUILDERS } from "./report_checks";
import type { ReportInput } from "./report_types";

// ReportInput is canonically defined in the leaf report_types.ts; re-export
// keeps every existing `from "./report"` import working unchanged.
export type { ReportInput } from "./report_types";

export function buildChecks(input: ReportInput): HealthCheck[] {
  return BUILDERS.flatMap((build) => build(input) ?? []);
}

export function buildReport(input: ReportInput): DriveReport {
  return {
    drive: input.drive,
    snapshot: input.snapshot,
    checks: buildChecks(input),
    sync: syncVerdict(input),
    master_name: input.masterName,
    generated_at: Date.now(),
  };
}

/** Compact per-drive row for list views (rail cards): verdict + score.
 *  One call for all drives replaces the UI's N+1 report fetches. The score
 *  is a real fraction ("7 of 9 checks passed"), not a binary yes/no —
 *  warnings earn 0.6, honest unknowns 0.3, failures 0. */
export function buildReportSummary(checks: HealthCheck[]): ReportSummary {
  const tally = (s: CheckStatus) => checks.filter((c) => c.status === s).length;
  const pass = tally("pass");
  const warned = tally("warn");
  const failed = tally("fail");
  const unknown = tally("unknown");
  return {
    overall: overall(checks),
    pass_rate: checks.length
      ? checks.reduce(
          (s, c) =>
            s +
            (c.status === "pass"
              ? 1
              : c.status === "warn"
                ? 0.6
                : c.status === "unknown"
                  ? 0.3
                  : 0),
          0,
        ) / checks.length
      : 0,
    passed: pass,
    checks: checks.length,
    failed,
    warned,
    unknown,
  };
}

function syncVerdict(input: ReportInput): DriveReport["sync"] {
  const { snapshot: snap, masterSnapshot: m, isMirror } = input;
  if (!isMirror) return null;
  if (!m?.file_count || !snap?.file_count) return { verdict: "unknown" };
  return snap.file_count >= m.file_count
    ? { verdict: "in-sync" }
    : { verdict: "behind", missing: m.file_count - snap.file_count };
}

/** Legacy/detail-level sync verdict (registry.detail). Same honest rules:
 *  mirror-only, count-based, and a mirror can only be in-sync or behind —
 *  it is never "in-sync" simply because it has ≥ as many rows as master. */
export function legacySyncVerdict(
  isMirror: boolean,
  snapCount: number | undefined,
  masterCount: number | undefined,
): { verdict: SyncVerdict; missing?: number } {
  if (!isMirror) return { verdict: "unknown" };
  if (!masterCount || !snapCount) return { verdict: "unknown" };
  return snapCount >= masterCount
    ? { verdict: "in-sync" }
    : { verdict: "behind", missing: masterCount - snapCount };
}

/** Overall verdict: worst status wins, but "unknown" is degraded-honest —
 *  a drive with all-unknown checks reports "unknown", never a fake "healthy".
 *  Warnings outweigh unknowns (attention), failures always win. */
export function overall(checks: HealthCheck[]): OverallHealth {
  if (!checks.length) return "unknown";
  if (checks.some((c) => c.status === "fail")) return "critical";
  if (checks.some((c) => c.status === "warn")) return "attention";
  if (checks.every((c) => c.status === "unknown")) return "unknown";
  return "healthy";
}
