// fleet-radar-tab.tsx — the new-music radar tab (#148, PRD F10): which
// archived tracks are NOT on each drive yet — the pre-sync question.
// Read-only + copy-to-clipboard: the PRD's v1 action is a copy button
// carrying the exact megadj command, never an automatic write (the
// playing-USB boundary stands). Snapshot freshness rides every per-drive
// row: a stale snapshot reads as stale (amber/red via FreshnessLine),
// never as "drive is current".
import { useMemo, useState } from "preact/hooks";
import type { FleetRadar, RadarResult } from "../../../shared/types";
import { api } from "../../ui/toast";
import { useFetched, FetchedGate } from "../../ui/useFetched";
import { DataTable, ListHead, type DataTableColumn } from "../../ui/data";
import { TabIntro } from "../../ui/InfoTip";
import { Icon } from "../../ui/icons";
import { Verdict } from "../shared";
import { FreshnessLine } from "../../ui/freshness";

/** THE producer for the radar's fix command (#148 acceptance: from a
 *  producer function, not a template string in the component). The shelf
 *  master is the only sync target — `megadj shelf-sync` is additive,
 *  MD5-verified, and never touches the playing USB. */
export const radarSyncCommand = (): string => "megadj shelf-sync";

type RadarRow = RadarResult["missing"][number];

function radarColumns(): DataTableColumn<RadarRow>[] {
  return [
    {
      key: "track",
      head: "track",
      grow: 1.6,
      cell: (t) => (
        <b>
          {t.artist ? `${t.artist} — ` : ""}
          {t.title ?? t.path}
        </b>
      ),
      sortValue: (t) =>
        `${t.artist ?? ""} ${t.title ?? t.path}`.trim().toLowerCase(),
    },
    {
      key: "path",
      head: "archive path",
      grow: 1.4,
      cell: (t) => <code>{t.path}</code>,
      sortValue: (t) => t.path,
    },
    {
      key: "seen",
      head: "archived",
      align: "end",
      min: 96,
      grow: 0,
      cell: (t) => (t.firstSeenAt ? t.firstSeenAt.slice(0, 10) : "unknown"),
      sortValue: (t) => t.firstSeenAt ?? "",
    },
  ];
}

const radarCopy = (rows: RadarRow[]): string[] =>
  rows.map((t) => `${t.artist ? `${t.artist} — ` : ""}${t.title ?? t.path}`);

/** One drive's radar card: verdict header + missing list. */
function RadarDriveCard(props: { r: RadarResult }) {
  const { r } = props;
  return (
    <div class="card">
      <ListHead
        icon={r.missingCount > 0 ? "download" : "check"}
        title={r.driveName}
        n={r.missingCount}
        hint={
          r.archiveAvailable
            ? `${r.missingCount} of ${r.archiveTracks} archived tracks not on this drive (drive inventory: ${r.driveTracks}). The delta compares against the latest snapshot — check the freshness line below before trusting a zero.`
            : "The archive DB is absent — the radar can't compare anything for this drive."
        }
        lines={radarCopy(r.missing)}
      />
      <DataTable
        columns={radarColumns()}
        rows={r.missing}
        cap={40}
        ariaLabel={`Tracks not on ${r.driveName}`}
        copyLines={radarCopy}
        copyName={`${r.driveName} radar`}
      />
      <FreshnessLine
        label="snapshot freshness"
        ages={[{ name: "scan", at: r.snapshotAt }]}
        note={
          <>
            stale snapshot? run <code>deckctl run {r.driveId} scan</code>
          </>
        }
      />
      {r.missingCount > 0 && (
        <div class="arch-fix">
          fix: <code>{radarSyncCommand()}</code> copies the archive to the shelf
          master (additive, MD5-verified)
        </div>
      )}
    </div>
  );
}

export function RadarTab() {
  const page = useFetched<FleetRadar>(
    () => api<FleetRadar>("/api/fleet/radar"),
    [],
  );
  const [onlyMissing, setOnlyMissing] = useState(true);
  const drives = useMemo(() => {
    if (page.status !== "ok") return null;
    return onlyMissing
      ? page.data.drives.filter(
          (d) => d.missingCount > 0 || !d.archiveAvailable,
        )
      : page.data.drives;
  }, [page, onlyMissing]);

  if (page.status !== "ok")
    return <FetchedGate page={page} loading="loading radar…" />;
  const data = page.data;

  return (
    <div>
      <TabIntro
        what="The new-music radar: archived tracks that aren't on each drive yet."
        how="The delta compares megadj's archive ledger against each drive's latest scan snapshot — folded-path matching with an artist-title fallback, so a regrouped track still counts as present. Per-drive counts come from the full comparison; the tables below are capped previews."
        next="The fix is always the same copyable command: sync the shelf, then drag from the shelf volume. A drive that was never scanned shows no rows — that's 'unknown', not 'current'."
      />
      <Verdict
        cls={
          !data.archiveAvailable
            ? "warn"
            : data.totalMissing > 0
              ? "warn"
              : "ok"
        }
        text={data.summary}
        meta={
          data.archiveAvailable
            ? `${data.archiveTracks.toLocaleString()} archived · ${data.drives.length} drive${data.drives.length === 1 ? "" : "s"} compared`
            : undefined
        }
      />
      {data.drives.length > 1 && (
        <label class="pl-tools" data-testid="radar-toggle">
          <input
            type="checkbox"
            checked={onlyMissing}
            onChange={(e) =>
              setOnlyMissing((e.target as HTMLInputElement).checked)
            }
          />{" "}
          show only drives with gaps
        </label>
      )}
      {drives && drives.length === 0 && (
        <div class="note-card">
          <Icon name="check" size={20} />
          Every scanned drive matches the archive — nothing to sync.
        </div>
      )}
      {drives?.map((r) => (
        <RadarDriveCard key={r.driveId} r={r} />
      ))}
    </div>
  );
}
