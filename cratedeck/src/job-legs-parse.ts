// job-legs-parse.ts — the PURE summary parsers of the job legs (#207
// split from job_legs.ts): boundary guards + subprocess-summary parsers
// with zero spawn/IO, so they are trivially unit-testable as a leaf.
// job_legs.ts keeps the leg runners (spawn seam) and imports this seam.
import { INTAKE_COUNTER_KEYS, type IntakeResult } from "../shared/types";
import { errMessage as errorText } from "../shared/fmt";

type IntakeCounters = Omit<IntakeResult, "audit" | "auditErrors">;

/** Numeric summaries cross a subprocess JSON boundary; counts are integers. */
export function finiteJobNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("job summary count must be a safe non-negative integer");
  return value;
}
type AuditError = IntakeResult["auditErrors"][number];

function isAuditError(entry: unknown): entry is AuditError {
  return (
    typeof entry === "object" &&
    entry !== null &&
    !Array.isArray(entry) &&
    typeof (entry as Record<string, unknown>).file === "string" &&
    typeof (entry as Record<string, unknown>).missing === "string"
  );
}

export function parseIngestSummary(
  summary: Record<string, unknown> | null,
): IntakeCounters {
  if (summary === null)
    throw new Error("megadj ingest returned a missing JSON summary");
  // Iterate THE key list (cratedeck/shared/types.ts SSOT, issue #159) —
  // a counter added to IntakeResult is parsed automatically; a counter
  // the producer stopped emitting fails HERE with its key named.
  return Object.fromEntries(
    INTAKE_COUNTER_KEYS.map((key) => {
      try {
        return [key, finiteJobNumber(summary[key])] as const;
      } catch (error) {
        throw new Error(
          `megadj ingest summary ${key} is invalid: ${errorText(error)}`,
          { cause: error },
        );
      }
    }),
  ) as IntakeCounters;
}

export function parseAuditSummary(
  output: string,
): Pick<IntakeResult, "audit" | "auditErrors"> {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch (error) {
    throw new Error(`malformed JSON: ${errorText(error)}`, { cause: error });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("audit summary must be an object");
  const row = value as Record<string, unknown>;
  let total: number;
  let complete: number;
  try {
    total = finiteJobNumber(row.total);
  } catch {
    throw new Error("audit summary total must be a safe non-negative integer");
  }
  try {
    complete = finiteJobNumber(row.complete);
  } catch {
    throw new Error(
      "audit summary complete must be a safe non-negative integer",
    );
  }
  if (complete > total)
    throw new Error("audit summary complete cannot exceed total");
  const incomplete = row.incomplete ?? [];
  if (!Array.isArray(incomplete) || !incomplete.every(isAuditError))
    throw new Error("audit summary incomplete rows are invalid");
  return {
    audit: { total, complete },
    auditErrors: incomplete,
  };
}

export function lastFinalLine(output: string): string | undefined {
  return output.split("\n").findLast((line) => line.startsWith("FINAL:"));
}

export function requireSuccessfulExit(
  label: string,
  exitCode: number | null,
  stderr: string,
): void {
  if (exitCode === 0) return;
  const detail = stderr.trim();
  throw new Error(
    `${label} exited ${exitCode ?? "unknown"}${detail ? `: ${detail.slice(-400)}` : ""}`,
  );
}
