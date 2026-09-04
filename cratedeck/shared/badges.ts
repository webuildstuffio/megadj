// Badge rules — single source computed server-side, rendered client-side.
import type { Badge, Drive, SnapshotData } from "./types";

const DAY = 86_400_000;

export function driveBadges(
  drive: Drive,
  opts: {
    latestVerify?: { ran_at: number; ok: boolean } | null;
    interlock?: boolean;
  } = {},
): Badge[] {
  const badges: Badge[] = [];
  if (!drive.mounted) {
    badges.push({ key: "ghost", label: "ghost", tone: "muted" });
    return badges;
  }
  const snap: SnapshotData | null = drive.last_snapshot_json
    ? JSON.parse(drive.last_snapshot_json)
    : null;

  // corruption / junk signals from the latest light scan
  if (snap?.junk) {
    const bad =
      snap.junk.zero_byte.length > 0 || snap.junk.case_collisions.length > 0;
    if (bad) badges.push({ key: "attn", label: "attention", tone: "bad" });
  }

  // hardware-gate freshness: verified after last library change
  const changedAt = Math.max(snap?.db_mtime ?? 0, snap?.pdb_mtime ?? 0);
  if (opts.latestVerify) {
    if (changedAt > opts.latestVerify.ran_at) {
      badges.push({
        key: "stale",
        label: "changed since verify",
        tone: "warn",
      });
    } else if (opts.latestVerify.ok) {
      badges.push({ key: "ready", label: "ready", tone: "good" });
    } else {
      badges.push({ key: "attn", label: "verify failed", tone: "bad" });
    }
  } else if (snap) {
    badges.push({ key: "unknown", label: "never verified", tone: "warn" });
  } else {
    badges.push({ key: "scanning", label: "no data yet", tone: "info" });
  }

  // grid coverage flag
  if (snap?.grid_coverage !== undefined && snap.grid_coverage < 1) {
    badges.push({
      key: "stale",
      label: `grids ${Math.round(snap.grid_coverage * 100)}%`,
      tone: snap.grid_coverage < 0.95 ? "warn" : "info",
    });
  }
  return badges;
}

export function syncBadge(
  drive: Drive,
  masterSnapshot: SnapshotData | null,
): Badge | null {
  if (drive.role !== "mirror" || !drive.mounted) return null;
  if (!masterSnapshot?.file_count || !drive.last_snapshot_json) {
    return { key: "unknown", label: "sync unknown", tone: "muted" };
  }
  const mine: SnapshotData = JSON.parse(drive.last_snapshot_json);
  if (mine.file_count === undefined)
    return { key: "unknown", label: "sync unknown", tone: "muted" };
  if (mine.file_count >= masterSnapshot.file_count) {
    return { key: "insync", label: "in sync (superset ok)", tone: "good" };
  }
  const missing = masterSnapshot.file_count - mine.file_count;
  return {
    key: "behind",
    label: `behind master (${missing} files)`,
    tone: missing > 20 ? "warn" : "info",
  };
}
