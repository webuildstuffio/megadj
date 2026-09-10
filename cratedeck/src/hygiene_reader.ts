// hygiene_reader.ts — read-only window into the megadj archive DB's
// `hygiene_findings` ledger (the shelf-hygiene feature's SSOT). Same
// pattern as shelf_sweep_reader.ts: a dedicated readonly Database (it can
// never write the archive), a missing/corrupt DB degrades to empty rows
// — the /api/hygiene family this feeds must answer, never 500.
import { Database } from "bun:sqlite";
import type { Finding, FindingKind, HygieneBadge } from "../shared/hygiene";

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

export class HygieneReader {
  private db: Database | null = null;
  private tried = false;

  constructor(private readonly path: string) {}

  private open(): Database | null {
    if (this.tried) return this.db;
    this.tried = true;
    try {
      this.db = new Database(this.path, { readonly: true, create: false });
    } catch (e) {
      console.error(
        `hygiene: archive DB unavailable at ${this.path}`,
        e instanceof Error ? e.message : e,
      );
      this.db = null;
    }
    return this.db;
  }

  list(filter?: {
    status?: string;
    kind?: string;
    severity?: string;
  }): Finding[] {
    const db = this.open();
    if (!db) return [];
    try {
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
      const rows = db
        .query(
          `SELECT * FROM hygiene_findings
           ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY CASE status
               WHEN 'confirmed' THEN 0 WHEN 'open' THEN 1
               WHEN 'failed' THEN 2 WHEN 'applied' THEN 3 ELSE 4 END,
             severity, kind, created_at`,
        )
        .all(...params) as Row[];
      return rows.map(hydrate);
    } catch (e) {
      // missing table (older archive DB) = "no data", logged, not fatal
      console.error(
        "hygiene: ledger query failed",
        e instanceof Error ? e.message : e,
      );
      return [];
    }
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
    const db = this.open();
    if (!db) return out;
    try {
      const rows = db
        .query(
          `SELECT status, kind, severity, auto_safe, COUNT(*) AS n
           FROM hygiene_findings GROUP BY status, kind, severity, auto_safe`,
        )
        .all() as Array<{
        status: string;
        kind: string;
        severity: string;
        auto_safe: 0 | 1;
        n: number;
      }>;
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
    } catch (e) {
      console.error(
        "hygiene: counts query failed",
        e instanceof Error ? e.message : e,
      );
      return out;
    }
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

  close(): void {
    this.db?.close();
    this.db = null;
    this.tried = false;
  }
}
