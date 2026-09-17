// grid-health.ts — the GA-05c grid-health wire contract (#167), shared by
// the job leg (producer), the route (server), and the web card (UI).
// Imports NOTHING (leaf of the leaf — the fixes.ts/hygiene.ts rule). The
// triage buckets themselves stay owned by src/rekordbox/grid-triage.ts;
// the shapes below mirror its summary verbatim (pinned by the job leg's
// parse test) so the browser never imports server code.

/** Triage bucket names — byte-for-byte the CLI's classes. */
export type GridBucket =
  "A-OK" | "SHIFT" | "PHASE" | "TEMPO" | "DRIFT" | "CHAOS";

export interface GridHealthRow {
  id: number;
  path: string;
  cls:
    GridBucket | "SYNC" | "DRIVE-MISSING" | "NO-ANLZ" | "NO-LEDGER" | "NO-GRID";
  /** Anchor / phase numbers when audited (ms; phaseBeats whole beats). */
  anchorDeltaMs?: number;
  phaseMs?: number;
  phaseBeats?: number;
  detail?: string;
}

/** The GA-05c card's payload: census totals from the CLI's COUNT fields,
 *  never re-derived from the (capped) offender list. */
export interface GridHealthPayload {
  driveId: string;
  driveName: string;
  mount: string;
  /** Wall-clock ISO when the triage ran (freshness line input). */
  ranAt: string;
  /** Compare stick name when the byte-compare was active, else null. */
  compareDrive: string | null;
  total: number;
  audited: number;
  buckets: Record<GridBucket, number>;
  /** Only when --compare was active: identical sidecar count. */
  synced: number | null;
  syncIssues: number | null;
  noAnlz: number;
  noLedger: number;
  noGrid: number;
  /** SYNC issues first, then worst bucket (the CLI's own order), capped. */
  offenders: GridHealthRow[];
  ok: boolean;
  error?: string;
}
