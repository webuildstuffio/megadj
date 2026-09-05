// preflight.ts — B12: one gig-night pass/fail checklist over all mounted
// drives. Pure functions: DB rows in, verdict out. No I/O.
//
// Verdict language mirrors report.ts: fail > warn > unknown > pass, and
// `overall()` never calls a drive healthy on unknowns alone. Everything a
// check needs comes from data cratedeck already measures — preflight is the
// aggregated read, not a new measurement pass.
import type { Drive, HealthCheck, SnapshotData } from "../shared/types";
import { fmtBytes } from "../shared/fmt";
import type { PlayerSpec } from "./players";

const DAY = 86_400_000;

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

export interface PreflightDriveResult {
  drive: Drive;
  overall: "ready" | "attention" | "not-ready" | "unknown";
  checks: HealthCheck[];
  /** show-stoppers — the reason a drive is not-ready, for the top line */
  blockers: string[];
}

export interface PreflightReport {
  generated_at: number;
  drives: PreflightDriveResult[];
  mountedCount: number;
  overall: "ready" | "attention" | "not-ready" | "unknown";
  /** one line a human reads before leaving for the gig */
  summary: string;
}

/** Worst-status-wins aggregation tuned for gig night: a fail is "don't take
 *  this drive" (not-ready), a warn is "usable, but know about it". */
function driveOverall(checks: HealthCheck[]): PreflightDriveResult["overall"] {
  if (checks.some((c) => c.status === "fail")) return "not-ready";
  if (checks.some((c) => c.status === "warn")) return "attention";
  if (checks.length && checks.every((c) => c.status === "pass")) return "ready";
  return "unknown";
}

function spaceCheck(snap: SnapshotData | null): HealthCheck | null {
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

function verifyCheck(
  latestVerify: PreflightInput["latestVerify"],
  snap: SnapshotData | null,
  now: number,
): HealthCheck | null {
  if (!latestVerify) return null;
  const ageDays = (now - latestVerify.ran_at) / DAY;
  const changedSince = snap
    ? Math.max(snap.db_mtime ?? 0, snap.pdb_mtime ?? 0) > latestVerify.ran_at
    : false;
  if (!latestVerify.ok || changedSince || ageDays > 7) {
    return {
      id: "verify",
      label: "Last verify",
      status: !latestVerify.ok ? "fail" : "warn",
      detail: !latestVerify.ok
        ? `last verify FAILED (${Math.round(ageDays)}d ago)`
        : changedSince
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

function benchCheck(bench: PreflightInput["bench"]): HealthCheck | null {
  if (!bench.length) return null;
  const last = bench.at(-1)!;
  if (bench.length < 2) {
    // B13's anomaly rule needs history; with one run, absolute threshold only
    return last.seq_mbps < 30
      ? {
          id: "speed",
          label: "Read speed",
          status: "fail",
          detail: `${last.seq_mbps} MB/s sequential — below the CDJ floor (30)`,
          fix: "Stick may be fake-capacity or failing — replace before a gig",
        }
      : null; // fast enough: preflight stays quiet, the dossier tells the story
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
  return last.seq_mbps < 30
    ? {
        id: "speed",
        label: "Read speed",
        status: "fail",
        detail: `${last.seq_mbps} MB/s sequential — below the CDJ floor (30)`,
        fix: "Stick may be fake-capacity or failing — replace before a gig",
      }
    : null;
}

function bitrotCheck(
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

function gridsCheck(snap: SnapshotData | null): HealthCheck | null {
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

function dualDbCheck(snap: SnapshotData | null): HealthCheck | null {
  if (snap?.onelibrary_rows === undefined || snap?.pdb_live_rows === undefined)
    return null;
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

function mirrorCheck(
  snap: SnapshotData | null,
  masterSnapshot: SnapshotData | null,
): HealthCheck | null {
  if (!snap?.file_count || !masterSnapshot?.file_count) return null;
  const missing = masterSnapshot.file_count - snap.file_count;
  return missing <= 0
    ? null // superset ok — not a gig-night concern
    : {
        id: "mirror",
        label: "Mirror parity",
        status: missing > 20 ? "fail" : "warn",
        detail: `behind the master by ${missing} file(s)`,
        fix: "Run the mirror sync to converge",
      };
}

/** N75/N78: which players can read this stick, from MEASURED db rows. A
 *  partial block (e.g. OneLibrary-only content on an XZ-only rig) warns —
 *  usable at tonight's venue, invisible elsewhere. No db data → no check. */
function playersCheck(players: PreflightInput["players"]): HealthCheck | null {
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

/** The B12 gate itself. Defaults keep it honest: any check with no data is
 *  omitted (unknowns never block), and a drive with no data at all reports
 *  unknown — never a fake ready. */
export function preflightForDrive(input: PreflightInput): PreflightDriveResult {
  const { snapshot: snap } = input;
  const checks = [
    dualDbCheck(snap),
    gridsCheck(snap),
    verifyCheck(input.latestVerify, snap, input.now),
    benchCheck(input.bench),
    bitrotCheck(input.ledgerFiles, input.latestChecksum),
    spaceCheck(snap),
    mirrorCheck(snap, input.masterSnapshot),
    playersCheck(input.players),
  ].filter((c): c is HealthCheck => c !== null);

  const blockers = checks
    .filter((c) => c.status === "fail")
    .map((c) => `${c.label}: ${c.detail}`);

  return {
    drive: input.drive,
    overall: driveOverall(checks),
    checks,
    blockers,
  };
}

export function buildPreflight(
  inputs: PreflightInput[],
  now = Date.now(),
): PreflightReport {
  const drives = inputs.map((i) => preflightForDrive({ ...i, now }));
  const mounted = drives.filter((d) => d.drive.mounted);
  const notReady = mounted.filter((d) => d.overall === "not-ready");
  const attention = mounted.filter((d) => d.overall === "attention");
  const unknown = mounted.filter((d) => d.overall === "unknown");
  const ready = mounted.filter((d) => d.overall === "ready");

  const overall: PreflightReport["overall"] = notReady.length
    ? "not-ready"
    : attention.length
      ? "attention"
      : unknown.length
        ? "unknown"
        : "ready";

  const parts: string[] = [];
  if (!mounted.length) parts.push("no drives mounted");
  if (ready.length) parts.push(`${ready.length} ready`);
  if (attention.length) parts.push(`${attention.length} need attention`);
  if (notReady.length)
    parts.push(
      `${notReady.length} NOT gig-safe: ${notReady
        .map((d) => d.drive.nickname ?? d.drive.name)
        .join(", ")}`,
    );
  if (unknown.length)
    parts.push(`${unknown.length} unknown (run a scan + verify)`);

  return {
    generated_at: now,
    drives,
    mountedCount: mounted.length,
    overall,
    summary: parts.join(" · "),
  };
}
