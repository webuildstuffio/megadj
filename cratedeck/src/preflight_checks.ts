// preflight_checks.ts — the individual preflight check builders, split from
// preflight.ts. Each builder: measured rows in → one HealthCheck (or null
// when there's no data — unknowns never block). The orchestration (role
// matrix filter, aggregation, report wire-up) stays in preflight.ts.
//
// PreflightInput is DEFINED here (leaf seam, per the AGENTS.md split rule:
// a split-out module types its parent-input against a leaf seam, never
// against the parent) and preflight.ts re-exports it — madge counts a
// type-only back-edge as a cycle.
import type { HealthCheck, SnapshotData } from "../shared/types";
import { fmtBytes } from "../shared/fmt";
import type { Drive } from "../shared/types";
import type { PlayerSpec } from "./players";

/** Everything a check needs, all measured upstream (DB rows, snapshots). */
export interface PreflightInput {
  drive: Drive;
  snapshot: SnapshotData | null;
  latestVerify: { ran_at: number; ok: boolean } | null;
  bench: { ran_at: number; seq_mbps: number }[];
  latestChecksum: { ran_at: number; changed: number } | null;
  ledgerFiles: number;
  masterSnapshot: SnapshotData | null;
  isMirror: boolean;
  now: number;
  /** N75/N78: hardware compatibility verdict (omit to skip the check). */
  players?: {
    ok: PlayerSpec[];
    blocked: { player: PlayerSpec; reason: string }[];
    unknown: boolean;
  };
}

const DAY = 86_400_000;

/** Free-space gate. rekordbox needs headroom for ANLZ + DB WAL writes; a
 *  full stick fails gig night even when every track reads fine. */
export function spaceCheck(snap: SnapshotData | null): HealthCheck | null {
  if (snap?.free_bytes == null) return null;
  const cap = snap.capacity_bytes ?? 0;
  if (!cap) return null;
  const freePct = snap.free_bytes / cap;
  const pct = Math.round(freePct * 100);
  return {
    id: "space",
    label: "Free space",
    status: freePct < 0.05 ? "fail" : freePct < 0.15 ? "warn" : "pass",
    detail: `${pct}% free (${fmtBytes(snap.free_bytes)} of ${fmtBytes(cap)})`,
    fix:
      freePct < 0.15
        ? "rekordbox needs headroom for ANLZ + DB WAL — prune or offload"
        : undefined,
  };
}

/** Verify freshness + result. Tier semantics (shared/check_matrix.ts):
 *  verify applies to EVERY tier — a failed verify is a real integrity
 *  fact. Only the freshness sub-verdict is gig-specific: a shelf's
 *  device-DB mtimes churn for player-side reasons that don't touch the
 *  audio archive, so "changed since verify" would warn forever on correct
 *  state. */
export function verifyCheck(
  latestVerify: PreflightInput["latestVerify"],
  snap: SnapshotData | null,
  now: number,
  role: PreflightInput["drive"]["role"],
): HealthCheck | null {
  if (!latestVerify) return null;
  const ageDays = (now - latestVerify.ran_at) / DAY;
  const archive = role === "shelf";
  if (!latestVerify.ok) {
    return {
      id: "verify",
      label: "Last verify",
      status: "fail",
      detail: `last verify FAILED (${Math.round(ageDays)}d ago)`,
      fix: "Run Verify",
    };
  }
  if (!archive && verifyStale(snap, latestVerify.ran_at, ageDays)) {
    const changedSince = changedSinceVerify(snap, latestVerify.ran_at);
    return {
      id: "verify",
      label: "Last verify",
      status: "warn",
      detail: changedSince
        ? "library changed since the last verify"
        : `verified ${Math.round(ageDays)}d ago (weekly schedule)`,
      fix: "Run Verify before the gig (or wait for the weekly auto-run)",
    };
  }
  return {
    id: "verify",
    label: "Last verify",
    status: "pass",
    detail: `verified ${Math.round(ageDays)}d ago, all pass`,
  };
}

/** Library mtimes moved past the verify, or the weekly schedule lapsed. */
function verifyStale(
  snap: SnapshotData | null,
  ranAt: number,
  ageDays: number,
): boolean {
  return changedSinceVerify(snap, ranAt) || ageDays > 7;
}

function changedSinceVerify(snap: SnapshotData | null, ranAt: number): boolean {
  return snap
    ? Math.max(snap.db_mtime ?? 0, snap.pdb_mtime ?? 0) > ranAt
    : false;
}

/** Read-speed gate: absolute CDJ floor (30 MB/s) + a >40% drop between the
 *  last two runs (the B13 anomaly rule needs history). */
export function benchCheck(bench: PreflightInput["bench"]): HealthCheck | null {
  if (!bench.length) return null;
  const last = bench.at(-1)!;
  if (bench.length < 2) {
    // B13's anomaly rule needs history; with one run, absolute threshold only
    return slowFloor(last.seq_mbps);
  }
  const prev = bench.at(-2)!;
  const drop = prev.seq_mbps > 0 ? 1 - last.seq_mbps / prev.seq_mbps : 0;
  if (drop > 0.4) {
    return {
      id: "speed",
      label: "Read speed",
      status: "fail",
      detail: `${last.seq_mbps} MB/s vs ${prev.seq_mbps} MB/s last run (−${Math.round(drop * 100)}%) — failing stick risk`,
      fix: "Re-run Benchmark; if confirmed, replace the stick before the gig",
    };
  }
  return slowFloor(last.seq_mbps);
}

/** Below the CDJ floor → fail; fast enough → quiet (the dossier tells the
 *  story — preflight only blocks). */
function slowFloor(mbps: number): HealthCheck | null {
  return mbps < 30
    ? {
        id: "speed",
        label: "Read speed",
        status: "fail",
        detail: `${mbps} MB/s sequential — below the CDJ floor (30)`,
        fix: "Stick may be fake-capacity or failing — replace before a gig",
      }
    : null;
}

/** Bitrot: changed-vs-ledger from the newest checksum job. null = no
 *  checksum run recorded yet (distinct from a clean 0). */
export function bitrotCheck(
  ledgerFiles: number,
  latestChecksum: PreflightInput["latestChecksum"],
): HealthCheck | null {
  if (!ledgerFiles) return null;
  const changed = latestChecksum?.changed;
  if (changed === undefined || changed === null) return null;
  if (changed > 0) {
    return {
      id: "bitrot",
      label: "Bitrot",
      status: "fail",
      detail: `${changed} file(s) differ from the checksum ledger`,
      fix: "Re-download or replace the changed file(s) before the gig",
    };
  }
  return {
    id: "bitrot",
    label: "Bitrot",
    status: "pass",
    detail: `${ledgerFiles} file(s) watched, no corruption detected`,
  };
}

/** Beatgrid coverage: share of tracks with ANLZ at the hashed path. */
export function gridsCheck(snap: SnapshotData | null): HealthCheck | null {
  if (snap?.grid_coverage === undefined) return null;
  const pct = Math.round(snap.grid_coverage * 100);
  return {
    id: "grids",
    label: "Beatgrid coverage",
    status: pct >= 99 ? "pass" : pct >= 90 ? "warn" : "fail",
    detail: `${pct}% of tracks have ANLZ at the hash path`,
    fix:
      pct >= 99
        ? undefined
        : "Analyze the remaining tracks in rekordbox, then re-sync",
  };
}

/** Dual-DB agreement. Shelf-tier drives are ARCHIVE storage — the master
 *  library lives there (rekordbox Database Management) and the legacy pdb
 *  is a vestigial copy of whatever stick tree was migrated over. pdb
 *  parity is a GIG-STICK concern; on a shelf it must never fail the
 *  preflight. */
export function dualDbCheck(
  snap: SnapshotData | null,
  role?: string,
): HealthCheck | null {
  if (snap?.onelibrary_rows === undefined || snap?.pdb_live_rows === undefined)
    return null;
  if (role === "shelf") {
    return {
      id: "dual-db",
      label: "Hardware library current",
      status: "pass",
      detail: `archive tier — master library lives here (${snap.onelibrary_rows} tracks); legacy pdb (${snap.pdb_live_rows}) is vestigial and not read by players`,
    };
  }
  const match = snap.pdb_live_rows === snap.onelibrary_rows;
  return {
    id: "dual-db",
    label: "Hardware library current",
    status: match ? "pass" : "fail",
    detail: match
      ? "export.pdb matches OneLibrary — players see the full library"
      : `OneLibrary ${snap.onelibrary_rows} vs pdb ${snap.pdb_live_rows} — players see a stale library`,
    fix: match
      ? undefined
      : "Re-run the rekordbox USB sync to rebuild export.pdb",
  };
}

/** Mirror parity vs the master. Superset is ok — not a gig-night concern. */
export function mirrorCheck(
  snap: SnapshotData | null,
  masterSnapshot: SnapshotData | null,
): HealthCheck | null {
  if (!snap?.file_count || !masterSnapshot?.file_count) return null;
  const missing = masterSnapshot.file_count - snap.file_count;
  return missing <= 0
    ? null
    : {
        id: "mirror",
        label: "Mirror parity",
        status: missing > 20 ? "fail" : "warn",
        detail: `behind the master by ${missing} file(s + `,
        fix: "Run the mirror sync to converge",
      };
}

/** N75/N78: which players can read this stick, from MEASURED db rows. A
 *  partial block (e.g. OneLibrary-only content on an XZ-only rig) warns —
 *  usable at tonight's venue, invisible elsewhere. No db data → no check. */
export function playersCheck(
  players: PreflightInput["players"],
): HealthCheck | null {
  if (!players || players.unknown) return null;
  if (!players.blocked.length) {
    return {
      id: "players",
      label: "Player compatibility",
      status: "pass",
      detail: `readable by all ${players.ok.length} known players`,
    };
  }
  const names = players.blocked.map((b) => b.player.name).join(", ");
  return {
    id: "players",
    label: "Player compatibility",
    status: players.ok.length === 0 ? "fail" : "warn",
    detail:
      players.ok.length === 0
        ? `NO player can read this drive: ${names}`
        : `invisible to: ${names} (${players.ok.length} players fine)`,
    fix: "Re-export from rekordbox to refresh both device libraries",
  };
}
