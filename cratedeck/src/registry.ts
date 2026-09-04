// registry.ts — drive identity, ghost lifecycle, snapshots, sync status.
import { rmSync } from "node:fs";
import type { CrateConfig } from "./config";
import type { DB } from "./db";
import type { Drive, SearchResult, SnapshotData } from "../shared/types";
import { scanVolume } from "./scan";

export type Emit = (channel: string, data: unknown) => void;

export class Registry {
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
        if (!wasMounted) {
          const fresh = this.db.getDrive(drive.id)!;
          this.db.event(drive.id, "mounted", {
            port: vol.portKey,
            plug_count: fresh.plug_count,
          });
          this.emit("drives", this.list());
        }
      }
      seen.add(vol.volumeUuid ?? id);
    }

    // ghost anything that vanished
    for (const drive of this.db.allDrives()) {
      const key = drive.volume_uuid ?? drive.id;
      if (drive.mounted && !seen.has(key)) {
        const wasDirty = true; // volume gone without eject — we can't know; log as-is
        this.db.setMounted(drive.id, false);
        this.db.event(drive.id, wasDirty ? "unmounted-dirty" : "unmounted", {});
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
    const master = this.db
      .allDrives()
      .find((d) => d.name.toUpperCase() === this.cfg.masterDrive.toUpperCase());
    let sync: { verdict: string; missing?: number } | null = null;
    if (
      drive.role === "mirror" ||
      drive.name.toUpperCase() === this.cfg.mirrorDrive.toUpperCase()
    ) {
      const masterSnap: SnapshotData | null = master?.last_snapshot_json
        ? JSON.parse(master.last_snapshot_json)
        : null;
      if (!masterSnap?.file_count || !snap?.file_count) {
        sync = { verdict: "unknown" };
      } else if (snap.file_count >= masterSnap.file_count) {
        sync = { verdict: "in-sync" };
      } else {
        sync = {
          verdict: "behind",
          missing: masterSnap.file_count - snap.file_count,
        };
      }
    }
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
