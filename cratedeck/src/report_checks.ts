// report_checks.ts — the individual health-check builders for report.ts.
// Split from report.ts for the file-length guard; each helper owns one
// check and returns its row(s), or null when not applicable. Pure
// functions: takes DB state + latest snapshot, returns verdicts. No I/O.
import type { HealthCheck } from "../shared/types";
import { checkApplies } from "../shared/check_matrix";
import { fmtBytes, fmtPct } from "../shared/fmt";
import type { ReportInput } from "./report_types";

const DAY = 86_400_000;

/** Each helper owns one check and returns its row(s), or null when not applicable. */
type CheckBuilder = (input: ReportInput) => HealthCheck | HealthCheck[] | null;

export const BUILDERS: CheckBuilder[] = [
  dualDbCheck,
  gridCheck,
  verifyCheck,
  bitrotCheck,
  junkCheck,
  spaceCheckRows,
  dupeCheck,
  artworkCheck,
  mirrorCheck,
  speedCheck,
];

// ---- hardware gate: OneLibrary vs legacy pdb rows -------------------------
function dualDbCheck(input: ReportInput): HealthCheck[] {
  // Role matrix (shared/check_matrix.ts): pdb parity is a gig-tier
  // concern — OMITTED on archive storage, never rendered as a fake pass.
  if (!checkApplies("dual-db", input.drive.role)) return [];
  const snap = input.snapshot;
  if (snap?.onelibrary_rows !== undefined && snap.pdb_live_rows !== undefined) {
    const match = snap.pdb_live_rows === snap.onelibrary_rows;
    return [
      {
        id: "dual-db",
        label: "Device DB sync (OneLibrary ↔ legacy pdb)",
        status: match ? "pass" : "fail",
        detail: match
          ? `${snap.onelibrary_rows} = ${snap.pdb_live_rows} rows`
          : `OneLibrary ${snap.onelibrary_rows} vs pdb ${snap.pdb_live_rows} — legacy players (XDJ-XZ, CDJs) see a stale library`,
        fix: match
          ? undefined
          : "Re-run the rekordbox USB sync to rebuild export.pdb",
      },
    ];
  }
  if (snap) {
    return [
      {
        id: "dual-db",
        label: "Device DB sync (OneLibrary ↔ legacy pdb)",
        status: "unknown",
        detail: "no device DB snapshot yet — run a full Scan",
      },
    ];
  }
  return [];
}

// ---- beatgrid coverage ------------------------------------------------------
function gridCheck(input: ReportInput): HealthCheck | null {
  // Role matrix: ANLZ coverage matters only where hardware plays the drive.
  if (!checkApplies("grids", input.drive.role)) return null;
  const snap = input.snapshot;
  if (snap?.grid_coverage === undefined) return null;
  const pct = Math.round(snap.grid_coverage * 100);
  return {
    id: "grids",
    label: "Beatgrid coverage (ANLZ files)",
    status: pct >= 99 ? "pass" : pct >= 90 ? "warn" : "fail",
    detail: `${pct}% of tracks have ANLZ at the hash path`,
    fix:
      pct >= 99
        ? undefined
        : "Analyze the remaining tracks in rekordbox, then re-sync",
  };
}

// ---- verify freshness (aligned with the 7d auto-verify interval) ------------
function verifyCheck(input: ReportInput): HealthCheck {
  const verify = input.latestVerify;
  if (!verify) {
    return {
      id: "verify",
      label: "Data verification",
      status: "unknown",
      detail: "never verified",
      fix: "Run Verify (checks every file's hash + DB integrity)",
    };
  }
  const snap = input.snapshot;
  const ageDays = (Date.now() - verify.ran_at) / DAY;
  const changedSince = snap
    ? Math.max(snap.db_mtime ?? 0, snap.pdb_mtime ?? 0) > verify.ran_at
    : false;
  // Tier semantics (shared/check_matrix.ts): verify applies to EVERY tier
  // — a FAILED verify is a real integrity fact about the archive. Only
  // the freshness sub-verdict is gig-specific: a shelf's device-DB mtimes
  // churn for player-side reasons that don't touch the audio.
  const archive = input.drive.role === "shelf";
  if (archive && verify.ok) {
    return {
      id: "verify",
      label: "Data verification",
      status: ageDays > 7 ? "warn" : "pass",
      detail: `verified ${Math.round(ageDays)}d ago (archive tier — audio + parity only)`,
    };
  }
  return {
    id: "verify",
    label: "Data verification",
    status: !verify.ok
      ? "fail"
      : changedSince
        ? "warn"
        : ageDays > 7
          ? "warn"
          : "pass",
    detail: !verify.ok
      ? `last verify FAILED${ageDays >= 1 ? ` (${Math.round(ageDays)}d ago)` : ""}`
      : changedSince
        ? "library changed since last verify"
        : `verified ${Math.round(ageDays)}d ago, all pass`,
    fix:
      verify.ok && !changedSince
        ? ageDays > 7
          ? "Run Verify (auto-verify runs weekly on mount)"
          : undefined
        : "Run Verify",
  };
}

// ---- bitrot / checksum ledger -----------------------------------------------
function bitrotCheck(input: ReportInput): HealthCheck {
  if (input.ledgerFiles <= 0) {
    return {
      id: "bitrot",
      label: "Bitrot (checksum ledger)",
      status: "unknown",
      detail: "no checksum ledger yet",
      fix: "Run Checksum once to seed corruption tracking",
    };
  }
  const changed = input.latestChecksum?.changed;
  const noVerdict = changed === undefined || changed === null;
  return {
    id: "bitrot",
    label: "Bitrot (checksum ledger)",
    status: noVerdict ? "unknown" : (changed as number) > 0 ? "fail" : "pass",
    detail: noVerdict
      ? `ledger has ${input.ledgerFiles} file(s) but no finished checksum run — verdict unknown`
      : (changed as number) > 0
        ? `${changed} file(s) differ from the ledger — silent corruption risk`
        : `${input.ledgerFiles} file(s) watched, no corruption detected` +
          (input.ledgerStaleDays !== null && input.ledgerStaleDays > 60
            ? ` (ledger ${Math.round(input.ledgerStaleDays)}d old — re-run Checksum)`
            : ""),
    fix: noVerdict
      ? "Run Checksum to get a corruption verdict"
      : (changed as number) > 0
        ? "Re-download or replace the changed file(s), then re-run Checksum"
        : undefined,
  };
}

// ---- junk ---------------------------------------------------------------------
function junkCheck(input: ReportInput): HealthCheck | null {
  const junk = input.snapshot?.junk;
  if (!junk) return null;
  const bad =
    junk.zero_byte.length + junk.case_collisions.length > 0 ||
    junk.orphan_resource_forks > 0;
  return {
    id: "junk",
    label: "Junk files",
    status: bad ? "warn" : "pass",
    detail: bad
      ? `${junk.zero_byte.length} zero-byte · ${junk.case_collisions.length} case collisions · ${junk.orphan_resource_forks} orphan forks`
      : "no zero-byte files, case collisions, or orphan forks",
    fix: bad
      ? "Clean these up — zero-byte/colliding files can crash older CDJ firmware"
      : undefined,
  };
}

// ---- disk space ----------------------------------------------------------------
function spaceCheckRows(input: ReportInput): HealthCheck | null {
  const snap = input.snapshot;
  if (
    snap?.free_bytes === null ||
    snap?.free_bytes === undefined ||
    !snap.capacity_bytes
  ) {
    return null;
  }
  const freePct = snap.free_bytes / snap.capacity_bytes;
  return {
    id: "space",
    label: "Free space",
    status: freePct < 0.05 ? "fail" : freePct < 0.15 ? "warn" : "pass",
    detail: `${fmtPct(freePct)} free (${fmtBytes(snap.free_bytes)} of ${fmtBytes(snap.capacity_bytes)})`,
    fix:
      freePct < 0.15
        ? "rekordbox needs headroom for ANLZ + DB WAL — prune or offload"
        : undefined,
  };
}

// ---- duplicate audio (casefolded path dupes) ------------------------------------
function dupeCheck(input: ReportInput): HealthCheck | null {
  const collisions = input.snapshot?.junk?.case_collisions.length;
  if (!collisions) return null;
  return {
    id: "dupes",
    label: "Duplicate paths (case-insensitive)",
    status: "warn",
    detail: `${collisions} path(s) differ only by case — same file twice on FAT32`,
    fix: "Deduplicate: FAT32 treats these as one file but rekordbox may double-count",
  };
}

// ---- artwork coverage -----------------------------------------------------------
function artworkCheck(input: ReportInput): HealthCheck | null {
  const dj = input.snapshot?.dj;
  if (!dj?.artwork_total || dj.artwork_missing === undefined) return null;
  const missingPct = dj.artwork_missing / dj.artwork_total;
  return {
    id: "artwork",
    label: "Artwork coverage",
    status: missingPct < 0.02 ? "pass" : missingPct < 0.1 ? "warn" : "fail",
    detail: `${dj.artwork_total - dj.artwork_missing}/${dj.artwork_total} tracks have artwork`,
    fix:
      missingPct >= 0.02
        ? "megadj ingest fills artwork automatically for new imports"
        : undefined,
  };
}

// ---- mirror parity ---------------------------------------------------------------
function mirrorCheck(input: ReportInput): HealthCheck | null {
  // Role matrix: the archive IS the top of the hierarchy — sticks mirror
  // FROM it, so "behind the master" is inverted nonsense there.
  if (!input.isMirror || !checkApplies("mirror", input.drive.role)) return null;
  const snap = input.snapshot;
  const m = input.masterSnapshot;
  if (!m?.file_count || !snap?.file_count) {
    return {
      id: "mirror",
      label: `Mirror parity vs ${input.masterName}`,
      status: "unknown",
      detail: "need scans of both drives",
    };
  }
  const missing = m.file_count - snap.file_count;
  return {
    id: "mirror",
    label: `Mirror parity vs ${input.masterName}`,
    status: missing <= 0 ? "pass" : missing > 20 ? "fail" : "warn",
    detail:
      missing <= 0 ? "in sync (superset ok)" : `behind by ${missing} file(s)`,
    fix:
      missing > 0
        ? "Run the mirror sync (usb_mirror.py) to converge"
        : undefined,
  };
}

// ---- benchmark --------------------------------------------------------------------
function speedCheck(input: ReportInput): HealthCheck | null {
  // Role matrix: the CDJ read-speed floor is a gig-night concern; nothing
  // reads the archive live, so a slow shelf link is not a defect.
  if (!checkApplies("speed", input.drive.role)) return null;
  if (!input.bench.length) return null;
  const last = input.bench.at(-1)!;
  return {
    id: "speed",
    label: "Read speed",
    status:
      last.seq_mbps >= 60 ? "pass" : last.seq_mbps >= 30 ? "warn" : "fail",
    detail: `${last.seq_mbps} MB/s sequential (CDJ-safe ≥ 30)`,
    fix:
      last.seq_mbps < 30
        ? "Stick may be fake-capacity or failing — replace before a gig"
        : undefined,
  };
}
