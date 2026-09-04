// badges_view.ts — server-side badge computation glue (shared rules live in
// shared/badges.ts; this adapts DB state to them).
import type { DB } from "./db";
import type { Drive, SnapshotData } from "../shared/types";
import { driveBadges, syncBadge } from "../shared/badges";

export function driveBadgesView(
  db: DB,
  drive: Drive,
  snaps: Map<string, SnapshotData>,
  masterDriveName: string,
  _mirrorDriveName: string,
) {
  const master = db
    .allDrives()
    .find(
      (d) =>
        d.role === "master" ||
        d.name.toUpperCase() === masterDriveName.toUpperCase(),
    );
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
