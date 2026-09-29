// fleet-radar-tab.tsx — the new-music radar tab (#148/#300, PRD F10):
// which archived tracks are NOT on each drive yet — the pre-sync
// question. v1.1 (#300): per-drive "Sync" button enqueues a mirror job
// instead of just copying a command. The playing-USB boundary stands:
// the job does shelf-sync + verification, then hands off with a drag
// reminder (user stages USB content). Snapshot freshness rides every
// per-drive row: a stale snapshot reads as stale (amber/red via
// FreshnessLine), never as "drive is current".
import { useMemo, useState } from "preact/hooks";
import type {
  FleetRadar,
  InterlockState,
  RadarResult,
} from "../../../shared/types";
import { api, apiPost, toast } from "../../ui/toast";
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

/** Sync-button disable reason, or null when the action is available.
 *  Only mirror-role drives can be synced — the mirror job copies
 *  MASTER→MIRROR, not an arbitrary per-drive copy (#411). */
function syncDisableReason(
  r: RadarResult,
  locked: boolean,
  syncing: boolean,
): string | null {
  if (syncing) return "sync already queued";
  if (locked) return "rekordbox is running — close it first";
  if (!r.mounted) return "drive not mounted";
  if (r.role !== "mirror") return null; // hide the button entirely below
  return null;
}

/** Whether this drive can EVER show the sync button (role-gate). */
function isSyncEligible(r: RadarResult): boolean {
  return r.role === "mirror";
}

/** One drive's radar card: verdict header + missing list + sync action. */
function RadarDriveCard(props: {
  r: RadarResult;
  locked: boolean;
  onSync: (driveId: string) => void;
  syncing: boolean;
}) {
  const { r, locked, onSync, syncing } = props;
  if (!r.inventoryAvailable) {
    return (
      <div class="card">
        <ListHead
          icon="pulse"
          title={r.driveName}
          n={0}
          hint="This drive's latest scan was a light scan — it carried no track inventory, so the radar can't compute a delta. Run a full scan; a light scan never reads as 'drive is current'."
          lines={[]}
        />
        <div class="note-card">
          <Icon name="pulse" size={20} />
          Light scan only — radar unknown for this drive.{" "}
          <code>deckctl run {r.driveId} scan</code> for the full inventory.
        </div>
        <FreshnessLine
          label="snapshot freshness"
          ages={[{ name: "scan", at: r.snapshotAt }]}
          note={
            <>
              stale snapshot? run <code>deckctl run {r.driveId} scan</code>
            </>
          }
        />
      </div>
    );
  }
  return (
    <div class="card">
      <ListHead
        icon={
          !r.inventoryAvailable
            ? "pulse"
            : r.missingCount > 0
              ? "download"
              : "check"
        }
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
      {r.missingCount > 0 && isSyncEligible(r) && (
        <div class="arch-fix">
          {(() => {
            const reason = syncDisableReason(r, locked, syncing);
            return (
              <>
                <button
                  type="button"
                  class="btn primary sm"
                  disabled={reason !== null}
                  title={
                    reason ??
                    `Mirror master → ${r.driveName} — copies ${r.missingCount} missing track(s)`
                  }
                  onClick={() => onSync(r.driveId)}
                >
                  <Icon name="copy" size={13} />{" "}
                  {syncing ? "Queued…" : "Mirror from master"}
                </button>
                {reason !== null && (
                  <span class="arch-fix-reason">{reason}</span>
                )}
                <span class="arch-fix-alt">
                  or CLI: <code>{radarSyncCommand()}</code>
                </span>
              </>
            );
          })()}
        </div>
      )}
      {r.missingCount > 0 && !isSyncEligible(r) && (
        <div class="arch-fix">
          <span class="arch-fix-alt">
            CLI: <code>{radarSyncCommand()}</code>
          </span>
        </div>
      )}
    </div>
  );
}

export function RadarTab(props: { interlock: InterlockState }) {
  const page = useFetched<FleetRadar>(
    () => api<FleetRadar>("/api/fleet/radar"),
    [],
  );
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [syncingDrive, setSyncingDrive] = useState<string | null>(null);
  const locked = props.interlock.rekordbox_running;

  const drives = useMemo(() => {
    if (page.status !== "ok") return null;
    return onlyMissing
      ? page.data.drives.filter(
          (d) =>
            d.missingCount > 0 || !d.archiveAvailable || !d.inventoryAvailable,
        )
      : page.data.drives;
  }, [page, onlyMissing]);

  const handleSync = async (driveId: string) => {
    const drive =
      page.status === "ok"
        ? page.data.drives.find((d) => d.driveId === driveId)
        : null;
    const label = drive?.driveName ?? driveId;
    const n = drive?.missingCount ?? 0;
    if (
      !confirm(
        `Mirror master → ${label}?\n\n` +
          `This copies ${n} missing track${n === 1 ? "" : "s"} ` +
          `from the master drive (additive, MD5-verified).\n\nContinue?`,
      )
    )
      return;
    setSyncingDrive(driveId);
    try {
      await apiPost(`/api/drives/${encodeURIComponent(driveId)}/jobs`, {
        kind: "mirror",
        origin: "radar",
      });
      toast("Mirror job queued — progress in the job dock below", "ok");
    } catch {
      /* apiPost already toasted the failure */
    } finally {
      setSyncingDrive(null);
    }
  };

  if (page.status !== "ok")
    return <FetchedGate page={page} loading="loading radar…" />;
  const data = page.data;

  return (
    <div>
      <TabIntro
        what="The new-music radar: archived tracks that aren't on each drive yet."
        how="The delta compares megadj's archive ledger against each drive's latest scan snapshot — folded-path matching with an artist-title fallback, so a regrouped track still counts as present. Per-drive counts come from the full comparison; the tables below are capped previews."
        next="Mirror-role drives get a sync button — it copies master → mirror (additive, MD5-verified). Other drives show a CLI hint. The drag step stays manual: you stage USB content. A drive that was never scanned shows no rows — that's 'unknown', not 'current'."
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
        <RadarDriveCard
          key={r.driveId}
          r={r}
          locked={locked}
          onSync={handleSync}
          syncing={syncingDrive === r.driveId}
        />
      ))}
    </div>
  );
}
