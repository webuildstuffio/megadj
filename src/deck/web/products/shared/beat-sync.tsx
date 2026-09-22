// beat-sync.tsx — the beat-grid cross-check breaker cluster (#89/#90
// page-skeleton pass; extracted from products/shared/index.tsx). The ArchiveTab
// and FullTagsPage "Beat Sync breakers" cards rendered byte-identical
// markup — this is the ONE implementation (rows, columns, copy, card).
// Verdict classes (plan GA-04/GA-05): octave > drift > off, severity
// order for pill + row tone; `driftMs` is positional drift across the
// track (the v1 card couldn't show it because the old verdict compared
// counts, not positions).
import type { ComponentChildren } from "preact";
import { Card, ListHead, DataTable, type DataTableColumn } from "../../ui/data";

/** delta % between the beat_this ledger BPM and rekordbox's BPM (1dp). */
export function gridDeltaPct(ledgerBpm: number, rbBpm: number): number {
  return rbBpm > 0
    ? Math.round((Math.abs(ledgerBpm - rbBpm) / rbBpm) * 1000) / 10
    : 0;
}

/** Producer row → the shared GridBreaker render row (flat: delta precomputed,
 *  verdict as a class). Lives here so ArchiveTab and FullTagsPage can't
 *  drift; the wire type is archive-owned.
 *  Drift rows (positional) and octave rows are both severity-"bad". */
export function mkBreaker(
  t: {
    video_id: string;
    title: string | null;
    ledgerBpm: number;
    rbBpm: number;
    driftMs: number;
  },
  cls: GridBreaker["cls"],
): GridBreaker {
  return {
    videoId: t.video_id,
    title: t.title,
    cls,
    ledgerBpm: t.ledgerBpm,
    rbBpm: t.rbBpm,
    deltaPct: gridDeltaPct(t.ledgerBpm, t.rbBpm),
    driftMs: t.driftMs,
  };
}

/** Collect breakers from a grid-cross-check payload in severity order:
 *  octave first (wrong pulse), then drift (positional slide), then
 *  tempo-off — the shared table renders it in the given order. Accepts the
 *  raw wire shape (octave/drift/off arrays) or `unavailable`. */
export function collectBreakers(
  grid:
    | {
        available: boolean;
        octave: Parameters<typeof mkBreaker>[0][];
        drift: Parameters<typeof mkBreaker>[0][];
        off: Parameters<typeof mkBreaker>[0][];
      }
    | null
    | undefined,
): GridBreaker[] {
  if (!grid?.available) return [];
  return [
    ...grid.octave.map((t) => mkBreaker(t, "octave")),
    ...grid.drift.map((t) => mkBreaker(t, "drift")),
    ...grid.off.map((t) => mkBreaker(t, "off")),
  ];
}

/** One beat-grid cross-check track as a DataTable row spec. */
export interface GridBreaker {
  videoId: string;
  title: string | null;
  cls: "octave" | "drift" | "off";
  ledgerBpm: number;
  rbBpm: number;
  deltaPct: number;
  driftMs: number;
}

export function beatSyncColumns(): DataTableColumn<GridBreaker>[] {
  return [
    {
      key: "track",
      head: "track",
      grow: 1.6,
      cell: (t: GridBreaker) => <b>{t.title ?? t.videoId}</b>,
      sortValue: (t: GridBreaker) => (t.title ?? t.videoId).toLowerCase(),
    },
    {
      key: "verdict",
      head: "verdict",
      min: 72,
      grow: 0,
      cell: (t: GridBreaker) => {
        if (t.cls === "octave")
          return <span class="arch-pill bad">octave</span>;
        if (t.cls === "drift") return <span class="arch-pill bad">drift</span>;
        return <span class="arch-pill warn">off</span>;
      },
      sortValue: (t: GridBreaker) => (t.cls === "off" ? 1 : 0),
    },
    {
      key: "grid",
      head: "grid",
      align: "end",
      min: 62,
      grow: 0,
      cell: (t: GridBreaker) => t.ledgerBpm,
      sortValue: (t: GridBreaker) => t.ledgerBpm,
    },
    {
      key: "rb",
      head: "rekordbox",
      align: "end",
      min: 78,
      grow: 0,
      cell: (t: GridBreaker) => Math.round(t.rbBpm * 10) / 10,
      sortValue: (t: GridBreaker) => t.rbBpm,
    },
    {
      key: "delta",
      head: "delta",
      grow: 1,
      cell: (t: GridBreaker) => (
        <span class="covdelta">
          <i
            class={t.cls === "off" ? "warn" : "bad"}
            style={{ width: `${Math.min(t.deltaPct * 8, 100)}%` }}
          />
          <em>
            {t.cls === "octave"
              ? "×2"
              : t.cls === "drift"
                ? `${Math.round(t.driftMs)} ms`
                : `${t.deltaPct}%`}
          </em>
        </span>
      ),
      sortValue: (t: GridBreaker) =>
        t.cls === "drift" ? t.driftMs : t.deltaPct,
    },
  ];
}

/** Build the copy payload for a Beat Sync breakers table. */
export const beatSyncCopy = (rows: GridBreaker[]): string[] =>
  rows.map((t) => {
    const tail =
      t.cls === "octave"
        ? " (OCTAVE)"
        : t.cls === "drift"
          ? ` (drift ${Math.round(t.driftMs)} ms)`
          : "";
    return `${t.title ?? t.videoId} — grid ${t.ledgerBpm} vs RB ${Math.round(t.rbBpm * 10) / 10} BPM${tail}`;
  });

/** BeatSyncBreakersCard — the whole "Beat Sync breakers" card (ListHead +
 *  DataTable + fix footnote) as ONE shared component. The ArchiveTab and
 *  FullTagsPage renders were byte-identical except the hint's tail and the
 *  footnote copy — both now pass through as props so the card can't drift
 *  again (jscpd flagged an 85-line clone here; this is the fix). */
export function BeatSyncBreakersCard(props: {
  breakers: GridBreaker[];
  syncRisk: number;
  hint: string;
  fixNote: ComponentChildren;
}) {
  return (
    <Card>
      <ListHead
        icon="pulse"
        title="Beat Sync breakers"
        n={props.syncRisk}
        hint={props.hint}
        lines={beatSyncCopy(props.breakers)}
      />
      <DataTable
        columns={beatSyncColumns()}
        rows={props.breakers}
        cap={40}
        ariaLabel="Beat Sync breakers"
        rowTone={(t) => (t.cls === "off" ? "" : "bad")}
        copyLines={beatSyncCopy}
        copyName="Beat Sync breakers"
      />
      <div class="arch-fix">fix: {props.fixNote}</div>
    </Card>
  );
}
