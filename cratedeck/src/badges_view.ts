// badges_view.ts — server-side badge computation glue (shared rules live in
// shared/badges.ts; this adapts DB state to them).
import type { DB } from "./db";
import type { Drive, SnapshotData } from "../shared/types";
import { driveBadges, syncBadge } from "../shared/badges";

export function driveBadgesView(
  db: DB,
  drive: Drive,
  _snaps: Map<string, SnapshotData>,
  _masterDriveName: string,
  _mirrorDriveName: string,
) {
  const master = db.masterDrive();
  const masterSnap = master?.last_snapshot_json
    ? (JSON.parse(master.last_snapshot_json) as SnapshotData)
    : null;
  const badges = driveBadges(drive, {
    latestVerify: db.latestVerify(drive.id),
  });
  const sync = syncBadge(drive, masterSnap);
  if (sync) badges.push(sync);
  return badges;
}
