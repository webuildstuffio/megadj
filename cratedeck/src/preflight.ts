// preflight.ts — B12: one gig-night pass/fail checklist over all mounted
// drives. Pure functions: DB rows in, verdict out. No I/O.
//
// Verdict language mirrors report.ts: fail > warn > unknown > pass, and
// `overall( + ` never calls a drive healthy on unknowns alone. Everything a
// check needs comes from data cratedeck already measures — preflight is the
// aggregated read, not a new measurement pass.
//
// The individual check builders live in preflight_checks.ts (one builder
// per rule); this module owns the role-matrix filter, aggregation, and the
// report wire shapes.
import type {
  HealthCheck,
  PreflightDriveResult,
  PreflightReport,
} from "../shared/types";
import { checkApplies, type CheckId } from "../shared/check_matrix";
import { firmwareAdvisories } from "./players";
import {
  benchCheck,
  bitrotCheck,
  dualDbCheck,
  gridsCheck,
  mirrorCheck,
  playersCheck,
  spaceCheck,
  verifyCheck,
  type PreflightInput,
} from "./preflight_checks";

// PreflightDriveResult/PreflightReport (the B12 wire shapes) are DEFINED in
// shared/types.ts — the dependency leaf — and imported above. Re-exported
// here for existing `from "./preflight"` consumers (shared/types consumers
// switched to the canonical definitions).
export type { PreflightDriveResult, PreflightReport };

// Builders re-exported for their direct consumers (tests, dossier).
export {
  benchCheck,
  bitrotCheck,
  dualDbCheck,
  gridsCheck,
  mirrorCheck,
  playersCheck,
  spaceCheck,
  verifyCheck,
};

// PreflightInput is DEFINED in preflight_checks.ts (the leaf seam for the
// builder split — a split-out module must never import its parent's types
// back: madge counts a type-only back-edge as a cycle). Re-exported so
// existing `from "./preflight"` sites hold.
export type { PreflightInput } from "./preflight_checks";

/** Worst-status-wins aggregation tuned for gig night: a fail is "don't take
 *  this drive" (not-ready), a warn is "usable, but know about it". */
function driveOverall(checks: HealthCheck[]): PreflightDriveResult["overall"] {
  if (checks.some((c) => c.status === "fail")) return "not-ready";
  if (checks.some((c) => c.status === "warn")) return "attention";
  if (checks.length && checks.every((c) => c.status === "pass")) return "ready";
  return "unknown";
}

/** Role-aware check matrix (Sep 10, SSOT in shared/check_matrix.ts): a
 *  shelf is ARCHIVE storage — the master library lives there, sticks sync
 *  FROM it, players never read it. Gig-stick concerns are OMITTED there,
 *  never failed. THIS module just declares which preflight check id each
 *  builder emits so the filter can consult the matrix. */
const BUILDER_ID = {
  dualDb: "dual-db",
  grids: "grids",
  verify: "verify",
  bench: "speed",
  bitrot: "bitrot",
  space: "space",
  mirror: "mirror",
  players: "players",
} as const satisfies Record<string, CheckId>;

/** The B12 gate itself. Defaults keep it honest: any check with no data is
 *  omitted (unknowns never block), and a drive with no data at all reports
 *  unknown — never a fake ready. */
export function preflightForDrive(input: PreflightInput): PreflightDriveResult {
  const { snapshot: snap } = input;
  const { role } = input.drive;
  // The role matrix (shared/check_matrix.ts) decides applicability: a
  // builder may still RUN (cheap), but its row is dropped when the check
  // doesn't apply to this drive's tier — omitted ≠ failed.
  const builders = [
    { key: "dualDb", run: () => dualDbCheck(snap, role) },
    { key: "grids", run: () => gridsCheck(snap) },
    {
      key: "verify",
      run: () => verifyCheck(input.latestVerify, snap, input.now, role),
    },
    { key: "bench", run: () => benchCheck(input.bench) },
    {
      key: "bitrot",
      run: () => bitrotCheck(input.ledgerFiles, input.latestChecksum),
    },
    { key: "space", run: () => spaceCheck(snap) },
    { key: "mirror", run: () => mirrorCheck(snap, input.masterSnapshot) },
    { key: "players", run: () => playersCheck(input.players) },
  ] as const;
  const checks = builders
    .filter((b) => checkApplies(BUILDER_ID[b.key], role))
    .map((b) => b.run())
    .filter((c): c is HealthCheck => c !== null);

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
    firmware_advisories: firmwareAdvisories(),
  };
}
