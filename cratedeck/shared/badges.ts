// Badge rules — single source computed server-side, rendered client-side.
// The individual rules live in badge_rules.ts (one rule per hardware/sync
// concern); driveBadges is the assembly (ghost short-circuit, corrupt-blob
// surfacing, ordering).
import type { Badge, Drive, SnapshotData } from "./types";
import { driveTier } from "./check_matrix";
import { junkBadge, verifyBadge, gridsBadge, linkBadge } from "./badge_rules";

/** The failure hierarchy. Cards rank badges by this order (server sorts, the
 *  web just renders), so the worst truths always surface first and the rail
 *  never hides a failed verify behind "ready". Unknown order = keep as-is. */
const BADGE_RANK: Record<string, number> = {
  attn: 0, // failing checks / junk / corruption — fix first
  stale: 1, // changed since verify, stale grids
  unknown: 2, // never verified
  behind: 3, // mirror behind master
  scanning: 4, // no data yet
  insync: 5,
  ready: 6,
  ghost: 7,
};

/** Sort badges worst-first, cap at `cap` (rail cards show 3), count the rest.
 *  Stable for equal ranks (insertion order is the server's tiebreak). */
export function rankBadges(
  badges: Badge[],
  cap: number,
): { top: Badge[]; extra: Badge[] } {
  const sorted = [...badges].sort(
    (a, b) => (BADGE_RANK[a.key] ?? 99) - (BADGE_RANK[b.key] ?? 99),
  );
  return { top: sorted.slice(0, cap), extra: sorted.slice(cap) };
}

/** Parse a persisted snapshot blob WITHOUT the crash class: a corrupt blob
 *  must surface as `corrupt: true` (callers render a badge), never throw —
 *  `driveBadges` runs on every /api/status and /api/drives request, and one
 *  bad row used to 500 the whole drive rail. */
export function parseSnapshotJson(json: string | null): {
  snap: SnapshotData | null;
  corrupt: boolean;
} {
  if (!json) return { snap: null, corrupt: false };
  try {
    const parsed = JSON.parse(json) as SnapshotData | null;
    // A blob that parses to a non-object (or null) is corruption too —
    // `snap.junk` access on it would throw downstream.
    if (!parsed || typeof parsed !== "object")
      return { snap: null, corrupt: true };
    return { snap: parsed, corrupt: false };
  } catch {
    return { snap: null, corrupt: true };
  }
}

export function driveBadges(
  drive: Drive,
  opts: {
    latestVerify?: { ran_at: number; ok: boolean } | null;
    interlock?: boolean;
  } = {},
): Badge[] {
  if (!drive.mounted) {
    return [{ key: "ghost", label: "ghost", tone: "muted" }];
  }
  const { snap, corrupt } = parseSnapshotJson(drive.last_snapshot_json);
  const badges: Badge[] = [];
  // Corrupt persisted JSON can never read as success (D30-class rule):
  // show a real badge instead of crashing /drives or lying "no data yet".
  if (corrupt)
    badges.push({ key: "attn", label: "snapshot corrupt", tone: "bad" });

  const isArchive = driveTier(drive.role) === "archive";
  for (const b of [
    junkBadge(snap),
    verifyBadge(opts.latestVerify ?? null, snap, isArchive),
    gridsBadge(snap, drive.role),
    linkBadge(drive),
  ]) {
    if (b) badges.push(b);
  }
  return badges;
}

export function syncBadge(
  drive: Drive,
  masterSnapshot: SnapshotData | null,
): Badge | null {
  if (drive.role !== "mirror" || !drive.mounted) return null;
  const { snap: mine, corrupt } = parseSnapshotJson(drive.last_snapshot_json);
  if (corrupt) return { key: "attn", label: "snapshot corrupt", tone: "bad" };
  if (!masterSnapshot?.file_count || !mine) {
    return { key: "unknown", label: "sync unknown", tone: "muted" };
  }
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
