// grid_health_parse.ts — the CLI-summary → wire-payload boundary for the
// grid-health job leg (#167). The summary crosses a subprocess JSON
// boundary: every field is checked, never trusted (the boundary-census
// rule). Buckets are complete (all six) or the payload fails — a partial
// census could silently read as healthy.
import type {
  GridBucket,
  GridHealthPayload,
  GridHealthRow,
} from "../shared/grid-health";

const BUCKETS: GridBucket[] = [
  "A-OK",
  "SHIFT",
  "PHASE",
  "TEMPO",
  "DRIFT",
  "CHAOS",
];

const intOr = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : fallback;

const nullableInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;

const strOr = (v: unknown, fallback: string): string =>
  typeof v === "string" && v !== "" ? v : fallback;

function parseRow(raw: unknown): GridHealthRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.path !== "string" || typeof r.cls !== "string") return null;
  const row: GridHealthRow = {
    id: intOr(r.id, 0),
    path: r.path,
    cls: r.cls as GridHealthRow["cls"],
  };
  if (typeof r.anchorDeltaMs === "number") row.anchorDeltaMs = r.anchorDeltaMs;
  if (typeof r.phaseMs === "number") row.phaseMs = r.phaseMs;
  if (typeof r.phaseBeats === "number") row.phaseBeats = r.phaseBeats;
  if (typeof r.detail === "string") row.detail = r.detail;
  return row;
}

/** Build the wire payload from the CLI's raw summary. Throws on a
 *  malformed summary (the job leg turns that into a failed job — never a
 *  silently empty card). */
export function summarizeGridHealth(
  summary: unknown,
  driveId: string,
  driveName: string,
): GridHealthPayload {
  if (typeof summary !== "object" || summary === null)
    throw new Error("rb-grid-triage summary is not an object");
  const s = summary as Record<string, unknown>;
  if (s.ok !== true)
    throw new Error(
      `rb-grid-triage failed: ${typeof s.error === "string" ? s.error : "unknown error"}`,
    );
  const rawBuckets =
    typeof s.buckets === "object" && s.buckets !== null
      ? (s.buckets as Record<string, unknown>)
      : null;
  if (!rawBuckets)
    throw new Error("rb-grid-triage summary has no buckets object");
  const buckets = Object.fromEntries(
    BUCKETS.map((b) => [b, intOr(rawBuckets[b], 0)]),
  ) as Record<GridBucket, number>;
  const offendersRaw = Array.isArray(s.offenders) ? s.offenders : [];
  const offenders = offendersRaw
    .map(parseRow)
    .filter((r): r is GridHealthRow => r !== null);
  const compareDrive =
    typeof s.compareDrive === "string" && s.compareDrive !== ""
      ? s.compareDrive
      : null;
  return {
    driveId,
    driveName,
    mount: strOr(s.mount, "unknown"),
    ranAt: new Date().toISOString(),
    compareDrive,
    total: intOr(s.total, 0),
    audited: intOr(s.audited, 0),
    buckets,
    synced: s.synced === null ? null : nullableInt(s.synced),
    syncIssues: s.syncIssues === null ? null : nullableInt(s.syncIssues),
    noAnlz: intOr(s.noAnlz, 0),
    noLedger: intOr(s.noLedger, 0),
    noGrid: intOr(s.noGrid, 0),
    offenders,
    ok: true,
  };
}
