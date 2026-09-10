// badge_rules.ts — the individual badge rules, split from badges.ts.
// Each rule: drive/snapshot in → zero or one Badge. The orchestration
// (ghost short-circuit, corrupt handling, ordering) stays in driveBadges.
import type { Badge, Drive, SnapshotData } from "./types";
import { checkApplies } from "./check_matrix";

/** Corruption / junk signals from the latest light scan. */
export function junkBadge(snap: SnapshotData | null): Badge | null {
  if (!snap?.junk) return null;
  const bad =
    snap.junk.zero_byte.length > 0 || snap.junk.case_collisions.length > 0;
  return bad ? { key: "attn", label: "attention", tone: "bad" } : null;
}

/** Hardware-gate freshness. Tier semantics (shared/check_matrix.ts):
 *  "changed since verify" freshness is a GIG-tier signal — a shelf's
 *  device-DB mtimes churn for player-side reasons that don't touch the
 *  audio archive. On the archive tier the honest verdicts are binary:
 *  verify FAILED (bad) or verified (archive ready). */
export function verifyBadge(
  latestVerify: { ran_at: number; ok: boolean } | null,
  snap: SnapshotData | null,
  isArchive: boolean,
): Badge | null {
  const changedAt = Math.max(snap?.db_mtime ?? 0, snap?.pdb_mtime ?? 0);
  if (latestVerify) {
    if (!latestVerify.ok)
      return { key: "attn", label: "verify failed", tone: "bad" };
    if (isArchive)
      return { key: "ready", label: "archive ready", tone: "good" };
    if (changedAt > latestVerify.ran_at)
      return { key: "stale", label: "changed since verify", tone: "warn" };
    return { key: "ready", label: "ready", tone: "good" };
  }
  if (snap) return { key: "unknown", label: "never verified", tone: "warn" };
  return { key: "scanning", label: "no data yet", tone: "info" };
}

/** Grid coverage flag (gig tier only — role matrix). */
export function gridsBadge(
  snap: SnapshotData | null,
  role: Drive["role"],
): Badge | null {
  if (
    !checkApplies("grids", role) ||
    snap?.grid_coverage === undefined ||
    snap.grid_coverage >= 1
  )
    return null;
  return {
    key: "stale",
    label: `grids ${Math.round(snap.grid_coverage * 100)}%`,
    tone: snap.grid_coverage < 0.95 ? "warn" : "info",
  };
}

/** USB link class: a USB2 link is a real hardware cap (≈35 MB/s ceiling) —
 *  gig-safe only on USB3. Slow link = warn; unknown link = no badge (the
 *  absence is the honest "never measured"). One SSOT: server computes, web
 *  renders. */
export function linkBadge(drive: Drive): Badge | null {
  if (drive.link_bps === null || drive.link_bps === undefined) return null;
  if (drive.link_bps >= 5_000_000_000) {
    return {
      key: "ready",
      label: drive.link_bps >= 10_000_000_000 ? "USB3 10G" : "USB3",
      tone: "good",
    };
  }
  return { key: "attn", label: "USB 2.0 link", tone: "warn" };
}
