// registry.ts — drive identity, ghost lifecycle, snapshots, sync status.
import { rmSync } from "node:fs";
import type { CrateConfig } from "./config";
import type { DB } from "./db";
import type { Drive, SearchResult, SnapshotData } from "../shared/types";
import { legacySyncVerdict } from "./report";

export type Emit = (channel: string, data: unknown) => void;

/** The drive-row fields that come straight off a mounted volume — both
 * upsert paths (first-seen and reconcile) write this same projection. */
function volPatch(
  vol: import("./detect").MountedVolume,
): Partial<Drive> & Pick<Drive, "name"> {
  return {
    name: vol.name,
    capacity_bytes: vol.capacityBytes,
    fs: vol.fs,
    vendor: vol.vendor,
    model: vol.model,
    usb_serial: vol.usbSerial,
    last_port_key: vol.portKey,
    link_bps: vol.linkBps,
  };
}

export class Registry {
  /** Drive ids that flipped ghost → mounted on the most recent sweep.
   *  Consumed (and cleared) by the auto-scheduler in index.ts. */
  justMountedIds = new Set<string>();

  constructor(
    private cfg: CrateConfig,
    private db: DB,
    private emit: Emit,
  ) {}

  /** Called by detect on every sweep. Reconciles mounted volumes ↔ registry. */
  async reconcile(
    current: Awaited<ReturnType<typeof import("./detect").listMountedVolumes>>,
  ): Promise<void> {
    const seen = new Set<string>();
    for (const vol of current) {
      const id = identity(vol.volumeUuid, vol.name, vol.capacityBytes);
      let drive = vol.volumeUuid
        ? this.db.getDriveByUuid(vol.volumeUuid)
        : null;
      if (!drive) drive = this.db.getDrive(id);
      if (!drive) {
        drive = { id, volume_uuid: vol.volumeUuid, name: vol.name } as Drive;
        this.db.upsertDrive({
          id,
          volume_uuid: vol.volumeUuid,
          ...volPatch(vol),
          mounted: true,
        });
        this.db.event(id, "first-seen", {
          name: vol.name,
          capacity: vol.capacityBytes,
        });
        this.emit("drives", this.list());
      } else {
        const wasMounted = Boolean(drive.mounted);
        // No-op write guard: the reconcile sweep fires every few seconds; a
        // stable drive used to rewrite the full row each time (WAL churn).
        // `last_seen_at` is now only bumped on real changes or mount flips.
        if (
          !wasMounted ||
          drive.name !== vol.name ||
          drive.capacity_bytes !== vol.capacityBytes ||
          drive.fs !== vol.fs ||
          drive.usb_serial !== vol.usbSerial ||
          drive.last_port_key !== vol.portKey ||
          drive.model !== vol.model ||
          drive.vendor !== vol.vendor ||
          drive.link_bps !== vol.linkBps
        ) {
          this.db.upsertDrive({
            id: drive.id,
            ...volPatch(vol),
            mounted: true,
          });
        }
        if (!wasMounted) {
          this.db.bumpPlugCount(drive.id); // accurate session count
          const fresh = this.db.getDrive(drive.id)!;
          this.db.event(drive.id, "mounted", {
            port: vol.portKey,
            plug_count: fresh.plug_count,
          });
          this.justMountedIds.add(drive.id); // auto-scheduler picks this up
          this.emit("drives", this.list());
        }
      }
      seen.add(vol.volumeUuid ?? id);
    }

    // ghost anything that vanished
    for (const drive of this.db.allDrives()) {
      const key = drive.volume_uuid ?? drive.id;
      if (drive.mounted && !seen.has(key)) {
        // volume gone without a clean eject marker — recorded as dirty so
        // the timeline shows why a verify is worthwhile after re-mount
        this.db.setMounted(drive.id, false);
        this.db.event(drive.id, "unmounted-dirty", {});
        this.emit("drives", this.list());
      }
    }
  }

  list(): Drive[] {
    return this.db.allDrives().map((d) => ({
      ...d,
      state: d.mounted ? ("mounted" as const) : ("ghost" as const),
    }));
  }

  /** Full detail: drive + latest snapshot + sync verdict vs master. */
  detail(driveId: string): {
    drive: Drive;
    snapshot: SnapshotData | null;
    sync: { verdict: string; missing?: number } | null;
    master_name: string;
  } | null {
    const drive = this.db.getDrive(driveId);
    if (!drive) return null;
    const snap: SnapshotData | null = drive.last_snapshot_json
      ? JSON.parse(drive.last_snapshot_json)
      : null;
    const master = this.db.masterDrive();
    const isMirror =
      drive.role === "mirror" ||
      drive.name.toUpperCase() === this.cfg.mirrorDrive.toUpperCase();
    const masterSnap: SnapshotData | null = master?.last_snapshot_json
      ? JSON.parse(master.last_snapshot_json)
      : null;
    const sync: { verdict: string; missing?: number } | null = isMirror
      ? legacySyncVerdict(true, snap?.file_count, masterSnap?.file_count)
      : null;
    return {
      drive: { ...drive, state: drive.mounted ? "mounted" : "ghost" },
      snapshot: snap,
      sync,
      master_name: this.cfg.masterDrive,
    };
  }

  rename(driveId: string, nickname: string | null): void {
    const drive = this.db.getDrive(driveId);
    if (!drive) throw new Error("unknown drive");
    this.db.setNickname(driveId, nickname);
    this.db.event(driveId, "rename", { nickname });
    this.emit("drives", this.list());
  }

  search(q: string): SearchResult[] {
    const needle = q.toLowerCase();
    const out: SearchResult[] = [];
    for (const drive of this.db.allDrives()) {
      // drive name/nickname match: the whole drive is the hit — ⌘K should
      // find "DJMASTER" by name, not only playlists inside it
      const label = drive.nickname ?? drive.name;
      const driveHit =
        drive.name.toLowerCase().includes(needle) ||
        (drive.nickname ?? "").toLowerCase().includes(needle);
      const snap = drive.last_snapshot_json
        ? (JSON.parse(drive.last_snapshot_json) as SnapshotData)
        : null;
      const matches: SearchResult["matches"] = [];
      for (const pl of snap?.playlists ?? []) {
        if (pl.name.toLowerCase().includes(needle)) {
          matches.push({
            type: "playlist",
            name: pl.name,
            entries: pl.entries,
          });
        }
      }
      for (const f of snap?.folders ?? []) {
        if (f.name.toLowerCase().includes(needle)) {
          matches.push({ type: "folder", name: f.name, entries: f.files });
        }
      }
      if (driveHit) {
        matches.unshift({
          type: "drive",
          name: label,
          entries: snap?.track_count ?? 0,
        });
      }
      if (matches.length) {
        out.push({
          drive_id: drive.id,
          drive_name: label,
          mounted: Boolean(drive.mounted),
          matches: matches.slice(0, 10),
        });
      }
    }
    return out;
  }

  /** Boot-time scratch sweep: DB copies left by a killed process.
   *  A leftover scratch dir is expected after a crash (that's why we sweep),
   *  but any other failure (permissions, disk) must be visible. */
  sweepScratch(): void {
    try {
      rmSync(this.cfg.scratchDir, { recursive: true, force: true });
    } catch (e) {
      console.error(`scratch sweep failed for ${this.cfg.scratchDir}`, e);
    }
  }
}

export function identity(
  volumeUuid: string | null,
  name: string,
  capacity: number,
): string {
  if (volumeUuid) return volumeUuid;
  // fallback fingerprint (cheap sticks w/o UUID): name+capacity+fs-ish
  return `fp:${name}:${capacity}`;
}
