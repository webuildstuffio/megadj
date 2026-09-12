// hygiene_reader.ts — read-only window into the megadj archive DB's
// `hygiene_findings` ledger (the shelf-hygiene feature's SSOT). Lifecycle
// + the degrade-to-empty guarantee live in ArchiveLedgerReader (shared
// with the shelf-sweeps ledger — one implementation, not two copies).
import type {
  Finding,
  HygieneBadge,
  HygieneFindingRow,
} from "../shared/hygiene";
import {
  hydrateHygieneFinding,
  hygieneWhere,
  HYGIENE_ORDER_SQL,
} from "../shared/hygiene";
import { ArchiveLedgerReader } from "./archive_ledger_reader";

export interface HygieneCounts {
  open: number;
  confirmed: number;
  safe: number; // open && autoSafe — the batch-apply candidate set
  review: number; // open && severity==="review"
  byKind: Record<string, number>;
  /** open acoustic-twin findings grouped by their size-delta
   *  subcategory (src/hygiene/subcategory.ts) — the bucket-filter +
   *  batch-confirm UI reads this. Findings without a subcategory in
   *  evidence (pre-dates the classifier) count under "unclassified". */
  bySub: Record<string, number>;
}

export class HygieneReader extends ArchiveLedgerReader {
  protected readonly label = "hygiene";

  list(filter?: {
    status?: string | undefined;
    kind?: string | undefined;
    severity?: string | undefined;
  }): Finding[] {
    const { whereSql, params } = hygieneWhere(filter);
    const rows = this.query<HygieneFindingRow>(
      `SELECT * FROM hygiene_findings
       ${whereSql}
       ${HYGIENE_ORDER_SQL}`,
      ...params,
    );
    return rows.flatMap((row) => {
      try {
        return [hydrateHygieneFinding(row)];
      } catch (error) {
        console.error(
          `hygiene finding ${row.id} has corrupt JSON — skipping`,
          error instanceof Error ? error.message : error,
        );
        return [];
      }
    });
  }

  /** The banner census + per-drive badge numbers. Zeros when unavailable. */
  counts(): HygieneCounts {
    const out: HygieneCounts = {
      open: 0,
      confirmed: 0,
      safe: 0,
      review: 0,
      byKind: {},
      bySub: {},
    };
    const rows = this.query<{
      status: string;
      kind: string;
      severity: string;
      auto_safe: 0 | 1;
      evidence: string | null;
      n: number;
    }>(
      `SELECT status, kind, severity, auto_safe, evidence, COUNT(*) AS n
       FROM hygiene_findings GROUP BY status, kind, severity, auto_safe, evidence`,
    );
    for (const r of rows) {
      if (r.status === "open") {
        out.open += r.n;
        if (r.auto_safe === 1) out.safe += r.n;
        if (r.severity === "review") out.review += r.n;
        // acoustic subcategory census (open rows only — applied ones are
        // history, not decisions). Grouped in JS: evidence is free-form
        // JSON, so SQLite can't group on the nested key.
        if (r.kind === "acoustic-twin") {
          let sub = "unclassified";
          try {
            const ev = r.evidence
              ? (JSON.parse(r.evidence) as Record<string, unknown>)
              : {};
            if (typeof ev.subcategory === "string") sub = ev.subcategory;
          } catch (e) {
            // guarded parse (rule: corrupt ledger JSON is a visible
            // "unclassified" bucket, never a 500)
            console.error(
              "hygiene: unparseable evidence JSON",
              e instanceof Error ? e.message : e,
            );
          }
          out.bySub[sub] = (out.bySub[sub] ?? 0) + r.n;
        }
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
