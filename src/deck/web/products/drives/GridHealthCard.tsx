// GridHealthCard.tsx — the GA-05c grid-health card (#167): the drive
// page's bridge between the triage engine (`megadj rb-grid-triage`) and
// the human repair loop. Spec (docs/fulltags/grid-audit-plan.md GA-05c):
// VERDICT banner (two-thirds UX law), fix-first work queue worst-first
// with a Copy button carrying the exact megadj fix command per item, then
// raw detail. Census totals come from the payload's COUNT fields, never
// from summing the displayed (capped) offender list; the ledger freshness
// line keeps a stale run from reading as a current verdict.
import { useState } from "preact/hooks";
import type {
  GridHealthPayload,
  GridHealthRow,
} from "../../../shared/grid-health";
import { api } from "../../ui/toast";
import { useFetched, FetchedGate } from "../../ui/useFetched";
import { Card, DataTable, ListHead, type DataTableColumn } from "../../ui/data";
import { Icon } from "../../ui/icons";
import { Verdict } from "../shared";
import { FreshnessLine } from "../../ui/freshness";

/** THE fix-command producer (#167 acceptance: per-item copyable command
 *  from a producer function, not a template string in the row). SYNC
 *  issues get a re-export — the analysis classes get a triage-targeted
 *  re-analyze via the ledger's beats pass. */
export function gridFixCommand(row: GridHealthRow): string {
  if (row.cls === "SYNC") return "megadj rb-export";
  if (row.cls === "NO-LEDGER" || row.cls === "TEMPO" || row.cls === "CHAOS")
    return "megadj beats --force";
  if (row.cls === "NO-ANLZ") return "megadj rb-grid-triage"; // visibility gap: re-read the collection sidecar
  return "megadj rb-grid-triage"; // SHIFT/PHASE/DRIFT: repair lands with GA-06
}

/** Worst-first queue order: SYNC (wrong bytes on the drive — the only
 *  class whose fix is NOT analysis) first, then bucket severity
 *  (CHAOS > DRIFT > TEMPO > PHASE > SHIFT), then visibility gaps. */
const SEVERITY: Record<GridHealthRow["cls"], number> = {
  SYNC: 0,
  CHAOS: 1,
  DRIFT: 2,
  TEMPO: 3,
  PHASE: 4,
  SHIFT: 5,
  "NO-GRID": 6,
  "NO-ANLZ": 7,
  "NO-LEDGER": 8,
  "DRIVE-MISSING": 9,
  "A-OK": 10,
};

export function gridWorkQueue(rows: GridHealthRow[]): GridHealthRow[] {
  return rows.toSorted(
    (a, b) => SEVERITY[a.cls] - SEVERITY[b.cls] || a.path.localeCompare(b.path),
  );
}

/** The verdict per the two-thirds UX law: one line, the worst thing
 *  first, COUNT truth in the meta. */
export function gridHealthVerdict(p: GridHealthPayload): {
  cls: "ok" | "warn";
  text: string;
  meta: string;
} {
  const flagged =
    p.buckets.SHIFT +
    p.buckets.PHASE +
    p.buckets.TEMPO +
    p.buckets.DRIFT +
    p.buckets.CHAOS;
  const sync = p.syncIssues ?? 0;
  if (p.audited === 0 && flagged === 0 && sync === 0)
    return {
      cls: "warn",
      text: "Nothing audited yet — no ledger grids or no ANLZ sidecars to compare. Run `megadj beats` first.",
      meta: `${p.total} rows`,
    };
  if (flagged === 0 && sync === 0 && p.noAnlz === 0 && p.noGrid === 0)
    return {
      cls: "ok",
      text: `All ${p.audited} audited grids agree — Beat Sync is safe.`,
      meta: `${p.buckets["A-OK"]} A-OK of ${p.total}`,
    };
  const parts = [`${flagged} of ${p.audited} audited grids need work`];
  if (sync > 0)
    parts.push(`${sync} out-of-sync sidecars (re-export, don't re-analyze)`);
  if (p.noLedger > 0) parts.push(`${p.noLedger} not in the beats ledger`);
  if (p.noAnlz > 0) parts.push(`${p.noAnlz} without a collection sidecar`);
  return {
    cls: "warn",
    text: parts.join(" · "),
    meta: `${p.buckets["A-OK"]} A-OK · ${p.buckets.SHIFT} shift · ${p.buckets.PHASE} phase · ${p.buckets.TEMPO} tempo · ${p.buckets.DRIFT} drift · ${p.buckets.CHAOS} chaos`,
  };
}

function gridColumns(): DataTableColumn<GridHealthRow>[] {
  return [
    {
      key: "cls",
      head: "class",
      min: 86,
      grow: 0,
      cell: (r) => (
        <span
          class={`arch-pill ${r.cls === "A-OK" ? "ok" : r.cls === "SYNC" || r.cls === "CHAOS" || r.cls === "DRIFT" ? "bad" : "warn"}`}
        >
          {r.cls.toLowerCase()}
        </span>
      ),
      sortValue: (r) => SEVERITY[r.cls],
    },
    {
      key: "path",
      head: "track",
      grow: 1.8,
      cell: (r) => <code>{r.path.replace(/^\/Contents\//, "")}</code>,
      sortValue: (r) => r.path,
    },
    {
      key: "detail",
      head: "detail",
      grow: 1.2,
      cell: (r) =>
        r.anchorDeltaMs !== undefined
          ? `anchor ${Math.round(r.anchorDeltaMs)} ms · ${r.phaseBeats ?? 0} beat(s)`
          : (r.detail ?? "—"),
      sortValue: (r) => r.detail ?? "",
    },
    {
      key: "fix",
      head: "fix",
      grow: 1.4,
      cell: (r) => <code class="hyg-cmd">{gridFixCommand(r)}</code>,
      sortValue: (r) => gridFixCommand(r),
    },
  ];
}

const queueCopy = (rows: GridHealthRow[]): string[] =>
  rows.map(
    (r) =>
      `${r.cls}: ${r.path.replace(/^\/Contents\//, "")} — fix: ${gridFixCommand(r)}`,
  );

/** The card. `drive` names the drive whose snapshot context renders the
 *  scan button; the payload rides /api/grid-health. */
export function GridHealthCard(props: { drive: string }) {
  const page = useFetched<GridHealthPayload | null>(
    () =>
      api<GridHealthPayload | null>(
        `/api/grid-health?drive=${encodeURIComponent(props.drive)}`,
      ),
    [],
  );
  const [scanning, setScanning] = useState(false);

  if (page.status !== "ok")
    return <FetchedGate page={page} loading="loading grid health…" />;
  const p = page.data;

  const scan = async () => {
    setScanning(true);
    try {
      await api(
        `/api/grid-health/scan?drive=${encodeURIComponent(props.drive)}`,
        {
          method: "POST",
        },
      );
    } finally {
      setScanning(false);
    }
  };

  return (
    <Card>
      <ListHead
        icon="pulse"
        title="Grid health"
        n={p ? p.offenders.length : 0}
        hint="Two-step verdict per track: SYNC (the drive's sidecar differs from the collection — re-export) vs analysis (the grid itself is wrong — SHIFT/PHASE/TEMPO/DRIFT/CHAOS buckets, `megadj rb-grid-triage`). Totals come from the full census; the table shows the worst-first queue."
        lines={p ? queueCopy(gridWorkQueue(p.offenders)) : []}
      />
      {!p ? (
        <>
          <div class="note-card">
            <Icon name="pulse" size={20} />
            No triage run recorded yet — run one to bucket every shelf grid
            (SYNC vs analysis problems, A-OK … CHAOS).
          </div>
          <div class="arch-fix">
            <button
              type="button"
              class="btn sm"
              disabled={scanning}
              onClick={scan}
            >
              {scanning ? "Queuing…" : "Run triage"}
            </button>{" "}
            <code>deckctl run SHELF1 grid-health</code>
          </div>
        </>
      ) : (
        <>
          {(() => {
            const v = gridHealthVerdict(p);
            return <Verdict cls={v.cls} text={v.text} meta={v.meta} />;
          })()}
          <DataTable
            columns={gridColumns()}
            rows={gridWorkQueue(p.offenders)}
            cap={40}
            ariaLabel="Grid health work queue"
            copyLines={queueCopy}
            copyName="Grid health work queue"
          />
          {p.offenders.length <
            p.buckets.SHIFT +
              p.buckets.PHASE +
              p.buckets.TEMPO +
              p.buckets.DRIFT +
              p.buckets.CHAOS +
              (p.syncIssues ?? 0) && (
            <div class="arch-legend">
              <span>
                <em>queue truncated</em> — full census in the counts above;{" "}
                <code>deckctl</code> JSON carries the complete sample
              </span>
            </div>
          )}
          <FreshnessLine
            label="triage freshness"
            ages={[{ name: "triage", at: p.ranAt }]}
            note={
              <>
                stale? run <code>deckctl run {props.drive} grid-health</code>
              </>
            }
          />
          <div class="arch-fix">
            SYNC rows fix: re-export the affected playlists. Analysis rows wait
            on the GA-06 repair writer — do NOT hand-edit grids.
          </div>
        </>
      )}
    </Card>
  );
}
