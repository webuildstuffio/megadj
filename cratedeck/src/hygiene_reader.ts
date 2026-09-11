// hygiene_reader.ts — read-only window into the megadj archive DB's
// `hygiene_findings` ledger (the shelf-hygiene feature's SSOT). Lifecycle
// + the degrade-to-empty guarantee live in ArchiveLedgerReader (shared
// with the shelf-sweeps ledger — one implementation, not two copies).
import type { Finding, FindingKind, HygieneBadge } from "../shared/hygiene";
import { hygieneWhere, HYGIENE_ORDER_SQL } from "../shared/hygiene";
import { ArchiveLedgerReader } from "./archive_ledger_reader";

export interface HygieneCounts {
  open: number;
  confirmed: number;
  safe: number; // open && autoSafe — the batch-apply candidate set
  review: number; // open && severity==="review"
  byKind: Record<string, number>;
}

interface Row {
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

function hydrate(r: Row): Finding {
  return {
    id: r.id,
    kind: r.kind,
    severity: r.severity as Finding["severity"],
    status: r.status as Finding["status"],
    paths: JSON.parse(r.paths) as string[],
    bytes: JSON.parse(r.bytes) as number[],
    md5s: r.md5s ? (JSON.parse(r.md5s) as (string | null)[]) : [],
    fps: r.fps ? (JSON.parse(r.fps) as (string | null)[]) : [],
    evidence: r.evidence
      ? (JSON.parse(r.evidence) as Record<string, unknown>)
      : {},
    proposedAction: JSON.parse(r.proposed_action) as Finding["proposedAction"],
    keeperPath: r.keeper_path,
    walkToken: r.walk_token,
    autoSafe: r.auto_safe === 1,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    appliedAt: r.applied_at,
    validation: r.validation
      ? (JSON.parse(r.validation) as Finding["validation"])
      : null,
  } as Finding;
}

export class HygieneReader extends ArchiveLedgerReader {
  protected readonly label = "hygiene";

  list(filter?: {
    status?: string | undefined;
    kind?: string | undefined;
    severity?: string | undefined;
  }): Finding[] {
    const { whereSql, params } = hygieneWhere(filter);
    const rows = this.query<Row>(
      `SELECT * FROM hygiene_findings
       ${whereSql}
       ${HYGIENE_ORDER_SQL}`,
      ...params,
    );
    return rows.map(hydrate);
  }

  /** The banner census + per-drive badge numbers. Zeros when unavailable. */
  counts(): HygieneCounts {
    const out: HygieneCounts = {
      open: 0,
      confirmed: 0,
      safe: 0,
      review: 0,
      byKind: {},
    };
    const rows = this.query<{
      status: string;
      kind: string;
      severity: string;
      auto_safe: 0 | 1;
      n: number;
    }>(
      `SELECT status, kind, severity, auto_safe, COUNT(*) AS n
       FROM hygiene_findings GROUP BY status, kind, severity, auto_safe`,
    );
    for (const r of rows) {
      if (r.status === "open") {
        out.open += r.n;
        if (r.auto_safe === 1) out.safe += r.n;
        if (r.severity === "review") out.review += r.n;
      }
      if (r.status === "confirmed") out.confirmed += r.n;
      out.byKind[r.kind] = (out.byKind[r.kind] ?? 0) + r.n;
    }
    return out;
  }

  badge(): HygieneBadge {
    const c = this.counts();
    return {
      open: c.open,
      safe: c.safe,
      review: c.review,
      info: 0, // info-severity checks (stale-pointer/orphan) ship later
    };
  }
}
