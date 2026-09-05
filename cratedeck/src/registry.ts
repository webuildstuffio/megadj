// registry.ts — drive identity, ghost lifecycle, snapshots, sync status.
import { rmSync } from "node:fs";
import type { CrateConfig } from "./config";
import type { DB } from "./db";
import type { Drive, SearchResult, SnapshotData } from "../shared/types";
import { legacySyncVerdict } from "./report";

export type Emit = (channel: string, data: unknown) => void;

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
          name: vol.name,
          capacity_bytes: vol.capacityBytes,
          fs: vol.fs,
          vendor: vol.vendor,
          model: vol.model,
          usb_serial: vol.usbSerial,
          last_port_key: vol.portKey,
          mounted: true,
        });
        this.db.event(id, "first-seen", {
          name: vol.name,
          capacity: vol.capacityBytes,
        });
        this.emit("drives", this.list());
      } else {
        const wasMounted = !!drive.mounted;
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
          drive.vendor !== vol.vendor
        ) {
          this.db.upsertDrive({
            id: drive.id,
            name: vol.name,
            capacity_bytes: vol.capacityBytes,
            fs: vol.fs,
            vendor: vol.vendor,
            model: vol.model,
            usb_serial: vol.usbSerial,
            last_port_key: vol.portKey,
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
      if (!drive.last_snapshot_json) continue;
      const snap: SnapshotData = JSON.parse(drive.last_snapshot_json);
      const matches: SearchResult["matches"] = [];
      for (const pl of snap.playlists ?? []) {
        if (pl.name.toLowerCase().includes(needle)) {
          matches.push({
            type: "playlist",
            name: pl.name,
            entries: pl.entries,
          });
        }
      }
      for (const f of snap.folders ?? []) {
        if (f.name.toLowerCase().includes(needle)) {
          matches.push({ type: "folder", name: f.name, entries: f.files });
        }
      }
      if (matches.length) {
        out.push({
          drive_id: drive.id,
          drive_name: drive.nickname ?? drive.name,
          mounted: !!drive.mounted,
          matches: matches.slice(0, 10),
        });
      }
    }
    return out;
  }

  /** Boot-time scratch sweep: DB copies left by a killed process. */
  sweepScratch(): void {
    try {
      rmSync(this.cfg.scratchDir, { recursive: true, force: true });
    } catch {}
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
