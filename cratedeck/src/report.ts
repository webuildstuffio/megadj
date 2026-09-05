// report.ts — health checks + one-JSON dossier per drive. Pure functions:
// takes DB state + latest snapshot, returns verdicts. No I/O here.
import type {
  Drive,
  DriveReport,
  HealthCheck,
  SnapshotData,
} from "../shared/types";
import { fmtBytes, fmtPct } from "../shared/fmt";

export interface ReportInput {
  drive: Drive;
  snapshot: SnapshotData | null;
  latestVerify: { ran_at: number; ok: boolean } | null;
  bench: { ran_at: number; seq_mbps: number }[];
  ledgerFiles: number;
  ledgerStaleDays: number | null;
  masterSnapshot: SnapshotData | null;
  masterName: string;
  isMirror: boolean;
  /** Newest checksum job verdict. null = never run (≠ a clean 0). */
  latestChecksum: { ran_at: number; changed: number } | null;
}

const DAY = 86_400_000;

export function buildChecks(input: ReportInput): HealthCheck[] {
  const { snapshot: snap } = input;
  const checks: HealthCheck[] = [];

  // ---- hardware gate: OneLibrary vs legacy pdb rows -----------------------
  if (snap?.onelibrary_rows !== undefined && snap.pdb_live_rows !== undefined) {
    const match = snap.pdb_live_rows === snap.onelibrary_rows;
    checks.push({
      id: "dual-db",
      label: "Device DB sync (OneLibrary ↔ legacy pdb)",
      status: match ? "pass" : "fail",
      detail: match
        ? `${snap.onelibrary_rows} = ${snap.pdb_live_rows} rows`
        : `OneLibrary ${snap.onelibrary_rows} vs pdb ${snap.pdb_live_rows} — legacy players (XDJ-XZ, CDJs) see a stale library`,
      fix: match
        ? undefined
        : "Re-run the rekordbox USB sync to rebuild export.pdb",
    });
  } else if (snap) {
    checks.push({
      id: "dual-db",
      label: "Device DB sync (OneLibrary ↔ legacy pdb)",
      status: "unknown",
      detail: "no device DB snapshot yet — run a full Scan",
    });
  }

  // ---- beatgrid coverage --------------------------------------------------
  if (snap?.grid_coverage !== undefined) {
    const pct = Math.round(snap.grid_coverage * 100);
    checks.push({
      id: "grids",
      label: "Beatgrid coverage (ANLZ files)",
      status: pct >= 99 ? "pass" : pct >= 90 ? "warn" : "fail",
      detail: `${pct}% of tracks have ANLZ at the hash path`,
      fix:
        pct >= 99
          ? undefined
          : "Analyze the remaining tracks in rekordbox, then re-sync",
    });
  }

  // ---- verify freshness (aligned with the 7d auto-verify interval) --------
  if (input.latestVerify) {
    const ageDays = (Date.now() - input.latestVerify.ran_at) / DAY;
    const changedSince = snap
      ? Math.max(snap.db_mtime ?? 0, snap.pdb_mtime ?? 0) >
        input.latestVerify.ran_at
      : false;
    checks.push({
      id: "verify",
      label: "Data verification",
      status: !input.latestVerify.ok
        ? "fail"
        : changedSince
          ? "warn"
          : ageDays > 7
            ? "warn"
            : "pass",
      detail: !input.latestVerify.ok
        ? "last verify FAILED"
        : changedSince
          ? "library changed since last verify"
          : `verified ${Math.round(ageDays)}d ago, all pass`,
      fix:
        input.latestVerify.ok && !changedSince
          ? ageDays > 7
            ? "Run Verify (auto-verify runs weekly on mount)"
            : undefined
          : "Run Verify",
    });
  } else {
    checks.push({
      id: "verify",
      label: "Data verification",
      status: "unknown",
      detail: "never verified",
      fix: "Run Verify (checks every file's hash + DB integrity)",
    });
  }

  // ---- bitrot / checksum ledger -------------------------------------------
  if (input.ledgerFiles > 0) {
    const changed = input.latestChecksum?.changed;
    checks.push({
      id: "bitrot",
      label: "Bitrot (checksum ledger)",
      status:
        changed === undefined || changed === null
          ? "unknown"
          : changed > 0
            ? "fail"
            : "pass",
      detail:
        changed === undefined || changed === null
          ? `ledger has ${input.ledgerFiles} file(s) but no finished checksum run — verdict unknown`
          : changed > 0
            ? `${changed} file(s) differ from the ledger — silent corruption risk`
            : `${input.ledgerFiles} file(s) watched, no corruption detected` +
              (input.ledgerStaleDays !== null && input.ledgerStaleDays > 60
                ? ` (ledger ${Math.round(input.ledgerStaleDays)}d old — re-run Checksum)`
                : ""),
      fix:
        changed === undefined || changed === null
          ? "Run Checksum to get a corruption verdict"
          : changed > 0
            ? "Re-download or replace the changed file(s), then re-run Checksum"
            : undefined,
    });
  } else {
    checks.push({
      id: "bitrot",
      label: "Bitrot (checksum ledger)",
      status: "unknown",
      detail: "no checksum ledger yet",
      fix: "Run Checksum once to seed corruption tracking",
    });
  }

  // ---- junk ----------------------------------------------------------------
  if (snap?.junk) {
    const bad =
      snap.junk.zero_byte.length + snap.junk.case_collisions.length > 0 ||
      snap.junk.orphan_resource_forks > 0;
    checks.push({
      id: "junk",
      label: "Junk files",
      status: bad ? "warn" : "pass",
      detail: bad
        ? `${snap.junk.zero_byte.length} zero-byte · ${snap.junk.case_collisions.length} case collisions · ${snap.junk.orphan_resource_forks} orphan forks`
        : "no zero-byte files, case collisions, or orphan forks",
      fix: bad
        ? "Clean these up — zero-byte/colliding files can crash older CDJ firmware"
        : undefined,
    });
  }

  // ---- disk space ----------------------------------------------------------
  if (
    snap?.free_bytes !== null &&
    snap?.free_bytes !== undefined &&
    snap.capacity_bytes
  ) {
    const freePct = snap.free_bytes / snap.capacity_bytes;
    checks.push({
      id: "space",
      label: "Free space",
      status: freePct < 0.05 ? "fail" : freePct < 0.15 ? "warn" : "pass",
      detail: `${fmtPct(freePct)} free (${fmtBytes(snap.free_bytes)} of ${fmtBytes(snap.capacity_bytes)})`,
      fix:
        freePct < 0.15
          ? "rekordbox needs headroom for ANLZ + DB WAL — prune or offload"
          : undefined,
    });
  }

  // ---- duplicate audio (casefolded path dupes) ------------------------------
  if (snap?.junk?.case_collisions.length) {
    checks.push({
      id: "dupes",
      label: "Duplicate paths (case-insensitive)",
      status: "warn",
      detail: `${snap.junk.case_collisions.length} path(s) differ only by case — same file twice on FAT32`,
      fix: "Deduplicate: FAT32 treats these as one file but rekordbox may double-count",
    });
  }

  // ---- artwork coverage ----------------------------------------------------
  const dj = snap?.dj;
  if (dj?.artwork_total && dj.artwork_missing !== undefined) {
    const missingPct = dj.artwork_missing / dj.artwork_total;
    checks.push({
      id: "artwork",
      label: "Artwork coverage",
      status: missingPct < 0.02 ? "pass" : missingPct < 0.1 ? "warn" : "fail",
      detail: `${dj.artwork_total - dj.artwork_missing}/${dj.artwork_total} tracks have artwork`,
      fix:
        missingPct >= 0.02
          ? "megadj ingest fills artwork automatically for new imports"
          : undefined,
    });
  }

  // ---- mirror parity -------------------------------------------------------
  if (input.isMirror) {
    const m = input.masterSnapshot;
    if (m?.file_count && snap?.file_count) {
      const missing = m.file_count - snap.file_count;
      checks.push({
        id: "mirror",
        label: `Mirror parity vs ${input.masterName}`,
        status: missing <= 0 ? "pass" : missing > 20 ? "fail" : "warn",
        detail:
          missing <= 0
            ? "in sync (superset ok)"
            : `behind by ${missing} file(s)`,
        fix:
          missing > 0
            ? "Run the mirror sync (usb_mirror.py) to converge"
            : undefined,
      });
    } else {
      checks.push({
        id: "mirror",
        label: `Mirror parity vs ${input.masterName}`,
        status: "unknown",
        detail: "need scans of both drives",
      });
    }
  }

  // ---- benchmark -----------------------------------------------------------
  if (input.bench.length) {
    const last = input.bench.at(-1)!;
    checks.push({
      id: "speed",
      label: "Read speed",
      status:
        last.seq_mbps >= 60 ? "pass" : last.seq_mbps >= 30 ? "warn" : "fail",
      detail: `${last.seq_mbps} MB/s sequential (CDJ-safe ≥ 30)`,
      fix:
        last.seq_mbps < 30
          ? "Stick may be fake-capacity or failing — replace before a gig"
          : undefined,
    });
  }

  return checks;
}

export function buildReport(input: ReportInput): DriveReport {
  return {
    drive: input.drive,
    snapshot: input.snapshot,
    checks: buildChecks(input),
    sync: syncVerdict(input),
    master_name: input.masterName,
    generated_at: Date.now(),
  };
}

/** Compact per-drive row for list views (rail cards): verdict + pass rate.
 *  One call for all drives replaces the UI's N+1 report fetches. */
export function buildReportSummary(checks: HealthCheck[]): {
  overall: ReturnType<typeof overall>;
  pass_rate: number;
} {
  return {
    overall: overall(checks),
    pass_rate: checks.length
      ? checks.reduce(
          (s, c) =>
            s +
            (c.status === "pass"
              ? 1
              : c.status === "warn"
                ? 0.6
                : c.status === "unknown"
                  ? 0.3
                  : 0),
          0,
        ) / checks.length
      : 0,
  };
}

function syncVerdict(input: ReportInput): DriveReport["sync"] {
  const { snapshot: snap, masterSnapshot: m, isMirror } = input;
  if (!isMirror) return null;
  if (!m?.file_count || !snap?.file_count) return { verdict: "unknown" };
  return snap.file_count >= m.file_count
    ? { verdict: "in-sync" }
    : { verdict: "behind", missing: m.file_count - snap.file_count };
}

/** Legacy/detail-level sync verdict (registry.detail). Same honest rules:
 *  mirror-only, count-based, and a mirror can only be in-sync or behind —
 *  it is never "in-sync" simply because it has ≥ as many rows as master. */
export function legacySyncVerdict(
  isMirror: boolean,
  snapCount: number | undefined,
  masterCount: number | undefined,
): { verdict: "in-sync" | "behind" | "unknown"; missing?: number } {
  if (!isMirror) return { verdict: "unknown" };
  if (!masterCount || !snapCount) return { verdict: "unknown" };
  return snapCount >= masterCount
    ? { verdict: "in-sync" }
    : { verdict: "behind", missing: masterCount - snapCount };
}

/** Overall verdict: worst status wins, but "unknown" is degraded-honest —
 *  a drive with all-unknown checks reports "unknown", never a fake "healthy".
 *  Warnings outweigh unknowns (attention), failures always win. */
export function overall(
  checks: HealthCheck[],
): "healthy" | "attention" | "critical" | "unknown" {
  if (!checks.length) return "unknown";
  if (checks.some((c) => c.status === "fail")) return "critical";
  if (checks.some((c) => c.status === "warn")) return "attention";
  if (checks.every((c) => c.status === "unknown")) return "unknown";
  return "healthy";
}
