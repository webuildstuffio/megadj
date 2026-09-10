// Badge rules — single source computed server-side, rendered client-side.
import type { Badge, Drive, SnapshotData } from "./types";
import { checkApplies, driveTier } from "./check_matrix";

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
  const badges: Badge[] = [];
  if (!drive.mounted) {
    badges.push({ key: "ghost", label: "ghost", tone: "muted" });
    return badges;
  }
  const { snap, corrupt } = parseSnapshotJson(drive.last_snapshot_json);
  if (corrupt) {
    // Corrupt persisted JSON can never read as success (D30-class rule):
    // show a real badge instead of crashing /drives or lying "no data yet".
    badges.push({ key: "attn", label: "snapshot corrupt", tone: "bad" });
  }

  // corruption / junk signals from the latest light scan
  if (snap?.junk) {
    const bad =
      snap.junk.zero_byte.length > 0 || snap.junk.case_collisions.length > 0;
    if (bad) badges.push({ key: "attn", label: "attention", tone: "bad" });
  }

  // hardware-gate freshness. Tier semantics (shared/check_matrix.ts):
  // "changed since verify" freshness is a GIG-tier signal — a shelf's
  // device-DB mtimes churn for player-side reasons that don't touch the
  // audio archive. On the archive tier the honest verdicts are binary:
  // verify FAILED (bad) or verified (archive ready).
  const isArchive = driveTier(drive.role) === "archive";
  const changedAt = Math.max(snap?.db_mtime ?? 0, snap?.pdb_mtime ?? 0);
  if (opts.latestVerify) {
    if (!opts.latestVerify.ok) {
      badges.push({ key: "attn", label: "verify failed", tone: "bad" });
    } else if (isArchive) {
      badges.push({ key: "ready", label: "archive ready", tone: "good" });
    } else if (changedAt > opts.latestVerify.ran_at) {
      badges.push({
        key: "stale",
        label: "changed since verify",
        tone: "warn",
      });
    } else {
      badges.push({ key: "ready", label: "ready", tone: "good" });
    }
  } else if (snap) {
    badges.push({ key: "unknown", label: "never verified", tone: "warn" });
  } else {
    badges.push({ key: "scanning", label: "no data yet", tone: "info" });
  }

  // grid coverage flag (gig tier only — role matrix)
  if (
    checkApplies("grids", drive.role) &&
    snap?.grid_coverage !== undefined &&
    snap.grid_coverage < 1
  ) {
    badges.push({
      key: "stale",
      label: `grids ${Math.round(snap.grid_coverage * 100)}%`,
      tone: snap.grid_coverage < 0.95 ? "warn" : "info",
    });
  }

  // USB link class: a USB2 link is a real hardware cap (≈35 MB/s ceiling) —
  // gig-safe only on USB3. Slow link = warn; unknown link = honest muted info
  // (never faked healthy). One SSOT: server computes, web renders.
  if (drive.link_bps !== null && drive.link_bps !== undefined) {
    if (drive.link_bps >= 5_000_000_000) {
      badges.push({
        key: "ready",
        label: drive.link_bps >= 10_000_000_000 ? "USB3 10G" : "USB3",
        tone: "good",
      });
    } else {
      badges.push({ key: "attn", label: "USB 2.0 link", tone: "warn" });
    }
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
