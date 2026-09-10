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

/** GET /api/hygiene response: rows plus the census the banner renders. */
export interface HygienePayload {
  findings: Finding[];
  counts: {
    open: number;
    confirmed: number;
    safe: number; // open && autoSafe — the auto-apply batch
    review: number; // open && severity==="review"
    byKind: Record<string, number>;
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
