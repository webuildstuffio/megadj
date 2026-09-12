// shared/hygiene.ts — the shelf-hygiene findings wire contract (docs/
// shelf-hygiene-2026-09-09.md §4/§5). Split from shared/types.ts (file-
// length cap): this file imports NOTHING (leaf of the leaf — same rule
// types.ts obeys), and types.ts re-exports it so every existing
// `../shared/types` import keeps compiling without drift.

/** What class of problem a finding reports (the §4.2 check table). */
export type FindingKind =
  | "byte-twin"
  | "acoustic-twin"
  | "folder-variant"
  | "spelling-typo"
  | "truncated-name"
  | "zero-byte"
  | "appledouble-junk"
  | "stale-pointer"
  | "orphan-audio"
  | "re-download";

/** Evidence tier. ONLY `safe` findings may ever be auto-applied —
 *  everything else needs an explicit human confirm (§4.2 severity tiers). */
export type Severity = "safe" | "likely" | "review" | "info";

/** The finding status machine: open → confirmed → applied | failed, or
 *  open → dismissed. A re-run with CHANGED evidence re-opens a dismissed
 *  finding; identical evidence never re-surfaces it. */
export type FindingStatus =
  | "open" // detected, undecided
  | "confirmed" // user said yes (pending apply)
  | "dismissed" // user said no — stays down unless evidence changes
  | "applied" // executed (moved to quarantine)
  | "failed"; // apply attempted, errored (kept for inspection)

/** What the apply step would do. Quarantine/clean are the only auto-safe
 *  actions; everything else is a human-gated operation. */
export type ProposedAction =
  | { type: "quarantine-loser" }
  | { type: "merge-folders"; into: string; renames: Record<string, string> }
  | { type: "rename"; to: string }
  | { type: "delete-corrupt" }
  | { type: "clean-junk" }
  | { type: "info" }
  | { type: "re-download"; query: string };

/** Post-apply validation receipt (§4.3 step 5): the green "0 orphans"
 *  proof, or the amber mismatch list that triggers one-click revert. */
export interface ValidationReceipt {
  ranAt: string;
  keepersPresent: number;
  keepersMissing: string[];
  fpMismatches: string[];
  shelfDelta: { before: number; after: number; quarantined: number };
  ok: boolean;
}

/** One reviewable finding. Immutable evidence + mutable status: a re-run
 *  may refresh evidence, but only evidence CHANGES re-open a dismissed
 *  finding (status never flaps on identical re-detection). */
export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  status: FindingStatus;
  /** every path involved. [0] = keeper/proposal, rest = losers/sources */
  paths: string[];
  /** parallel to paths */
  bytes: number[];
  /** computed lazily at apply time, upserted back into the ledger */
  md5s: (string | null)[];
  /** fpcalc, cached from shelf_fingerprints */
  fps: (string | null)[];
  /** check-specific extras: bitrate, token-set, edit distance… */
  evidence: Record<string, unknown>;
  proposedAction: ProposedAction;
  keeperPath: string | null;
  /** volume sentinel at detection time — apply aborts when it changed */
  walkToken: string;
  /** severity==="safe" && the action is quarantine/clean — the only rows
   *  the "Apply N safe" button may ever batch */
  autoSafe: boolean;
  createdAt: string;
  decidedAt: string | null;
  appliedAt: string | null;
  validation: ValidationReceipt | null;
}

/** Database-shaped hygiene finding. Both archive readers receive these rows
 * directly from SQLite, so their JSON-to-contract translation lives here. */
export interface HygieneFindingRow {
  id: string;
  kind: FindingKind;
  severity: string;
  status: string;
  paths: string;
  bytes: string;
  md5s: string | null;
  fps: string | null;
  evidence: string | null;
  proposed_action: string;
  keeper_path: string | null;
  walk_token: string;
  auto_safe: 0 | 1;
  created_at: string;
  decided_at: string | null;
  applied_at: string | null;
  validation: string | null;
}

/**
 * Hydrate a persisted hygiene row into the wire contract.
 *
 * JSON.parse deliberately remains visible to callers: their ledger boundary
 * catches corrupt rows and skips only the bad record, preserving the rest of
 * the queue rather than turning a partial corrupt ledger into a failure.
 */
export function hydrateHygieneFinding(row: HygieneFindingRow): Finding {
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity as Finding["severity"],
    status: row.status as Finding["status"],
    paths: JSON.parse(row.paths) as string[],
    bytes: JSON.parse(row.bytes) as number[],
    md5s: row.md5s ? (JSON.parse(row.md5s) as (string | null)[]) : [],
    fps: row.fps ? (JSON.parse(row.fps) as (string | null)[]) : [],
    evidence: row.evidence
      ? (JSON.parse(row.evidence) as Record<string, unknown>)
      : {},
    proposedAction: JSON.parse(
      row.proposed_action,
    ) as Finding["proposedAction"],
    keeperPath: row.keeper_path,
    walkToken: row.walk_token,
    autoSafe: row.auto_safe === 1,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    appliedAt: row.applied_at,
    validation: row.validation
      ? (JSON.parse(row.validation) as ValidationReceipt)
      : null,
  };
}

/** ffprobe sidecar for one side of an A/B compare (GET
 *  /api/hygiene/stats). Nulls mean "unavailable", never zero. */
export interface HygieneAudioStats {
  path: string;
  exists: boolean;
  bytes: number;
  /** seconds, 1 decimal */
  durationS: number | null;
  bitrateKbps: number | null;
  codec: string | null;
  sampleRate: number | null;
  error?: string | undefined;
}

/** GET /api/hygiene response: rows plus the census the banner renders. */
export interface HygienePayload {
  findings: Finding[];
  counts: {
    open: number;
    confirmed: number;
    safe: number; // open && autoSafe — the auto-apply batch
    review: number; // open && severity==="review"
    byKind: Record<string, number>;
    /** open acoustic-twin findings by size-delta subcategory
     *  (metadata-diff | re-encode | quality-diff | oddball |
     *  unclassified) — drives the bucket batch-confirm strip. */
    bySub: Record<string, number>;
  };
  walkToken: string | null;
}

/** Per-shelf-drive hygiene badge (driveListPayload `hygiene` field). */
export interface HygieneBadge {
  open: number;
  safe: number;
  review: number;
  info: number;
}

/** SQLite filter fragments shared by every hygiene_findings reader (the
 *  engine's HygieneStore.list and CrateDeck's HygieneReader.list carried
 *  byte-identical WHERE/ORDER BY blocks until jscpd flagged the clone).
 *  HygieneReaders pass their filters here so the status priority (worst
 *  first: confirmed → open → failed → applied → dismissed) and the
 *  parameterized WHERE builder stay defined ONCE, next to the contract. */
export function hygieneWhere(
  filter:
    | {
        status?: string | undefined;
        kind?: string | undefined;
        severity?: string | undefined;
      }
    | undefined,
): { whereSql: string; params: string[] } {
  const where: string[] = [];
  const params: string[] = [];
  if (filter?.status) {
    where.push("status = ?");
    params.push(filter.status);
  }
  if (filter?.kind) {
    where.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter?.severity) {
    where.push("severity = ?");
    params.push(filter.severity);
  }
  return {
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

/** Worst-first status ordering for hygiene_findings queries (see hygieneWhere). */
export const HYGIENE_ORDER_SQL = `ORDER BY CASE status
    WHEN 'confirmed' THEN 0 WHEN 'open' THEN 1
    WHEN 'failed' THEN 2 WHEN 'applied' THEN 3 ELSE 4 END,
  severity, kind, created_at`;
