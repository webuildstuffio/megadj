// badges_view.ts — server-side badge computation glue (shared rules live in
// shared/badges.ts; this adapts DB state to them).
import type { DB } from "./db";
import type { Drive, SnapshotData } from "../shared/types";
import { driveBadges, syncBadge, parseSnapshotJson } from "../shared/badges";

export function driveBadgesView(
  db: DB,
  drive: Drive,
  _snaps: Map<string, SnapshotData>,
  _masterDriveName: string,
  _mirrorDriveName: string,
) {
  // parseSnapshotJson (not bare JSON.parse): a corrupt master blob must
  // surface as a badge, never 500 the /drives list it rides on.
  const master = db.masterDrive();
  const masterSnap = master
    ? parseSnapshotJson(master.last_snapshot_json).snap
    : null;
  const badges = driveBadges(drive, {
    latestVerify: db.latestVerify(drive.id),
  });
  const sync = syncBadge(drive, masterSnap);
  if (sync) badges.push(sync);
  return badges;
}
