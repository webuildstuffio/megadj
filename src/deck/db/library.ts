import type { Drive, SnapshotData, VerifyReport } from "../shared/types";
import type { LedgerRow as ArchiveLedgerRow } from "../megaset/sweep";
import type {
  ManifestRow,
  PlaylistEntryRow,
  TrackRow,
} from "../fleet/coverage";
import { FleetStore } from "../fleet/db";
import { DBCore } from "./core";

/** Archive-ledger, fleet, drive, and snapshot responsibilities. */
export class DBLibrary extends DBCore {
  private fleetStore?: FleetStore;

  private get fleet(): FleetStore {
    this.fleetStore ??= new FleetStore(this.sqlite);
    return this.fleetStore;
  }

  archiveLedger(): Map<string, ArchiveLedgerRow> {
    return this.ledger.all();
  }

  upsertArchiveLedger(row: ArchiveLedgerRow): void {
    this.ledger.upsert(row);
  }

  fleetInventories(driveIds?: string[]): Map<string, TrackRow[]> {
    return this.fleet.inventories(driveIds);
  }

  fleetPlaylistEntries(driveIds?: string[]): Map<string, PlaylistEntryRow[]> {
    return this.fleet.playlistEntries(driveIds);
  }

  fleetManifests(driveIds?: string[]): Map<string, ManifestRow[]> {
    return this.fleet.manifests(driveIds);
  }

  masterDrive(): Drive | null {
    return this.allDrives().find((drive) => drive.role === "master") ?? null;
  }

  getDrive(id: string): Drive | null {
    return this.driveStore.get(id);
  }

  getDriveByUuid(uuid: string): Drive | null {
    return this.driveStore.getByUuid(uuid);
  }

  allDrives(): Drive[] {
    return this.driveStore.all();
  }

  upsertDrive(drive: Partial<Drive> & { id: string }): void {
    this.driveStore.upsert(
      drive,
      this.masterName,
      this.mirrorName,
      this.shelfName,
    );
  }

  setMounted(id: string, mounted: boolean): void {
    this.driveStore.setMounted(id, mounted);
  }

  setVerifyReport(id: string, report: VerifyReport | null): void {
    this.driveStore.setVerifyReport(id, report);
  }

  getVerifyReport(id: string): VerifyReport | null {
    return this.driveStore.getVerifyReport(id);
  }

  bumpPlugCount(id: string): void {
    const current = this.getDrive(id);
    const first = current?.plug_count ? 0 : 1;
    this.driveStore.bumpPlugCount(id);
    if (first) this.driveStore.bumpFirstSeen(id);
  }

  setNickname(id: string, nickname: string | null): void {
    this.driveStore.setNickname(id, nickname);
  }

  setPhoto(id: string, path: string): void {
    this.driveStore.setPhoto(id, path);
  }

  setSnapshot(id: string, snapshot: SnapshotData): void {
    if (this.driveStore.snapshotUnchanged(id, snapshot)) return;
    this.driveStore.putSnapshot(id, snapshot);
    this.fleet.sync(id, snapshot);
    this.driveStore.pruneFor(id);
  }

  latestSnapshots(): Map<string, SnapshotData> {
    return this.driveStore.latestSnapshots();
  }

  snapshots(driveId: string): SnapshotData[] {
    return this.driveStore.snapshots(driveId);
  }
}
