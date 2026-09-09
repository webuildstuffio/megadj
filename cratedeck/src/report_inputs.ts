// report_inputs.ts — the report/preflight/dossier data plumbing, extracted
// from index.ts (file-length guard). Pure collectors: DB state → the input
// shapes buildReport/buildPreflight consume. One `reportInput` per drive
// (single-drive reads + the dossier export) and `allPreflightInputs` for
// the fleet-wide B12 gate.
import type { Registry } from "./registry";
import type { DB } from "./db";
import type { CrateConfig } from "./config";
import { driveCompatibility } from "./players";
import type { PlayerSpec } from "../shared/types";
import { buildReport } from "./report";
import type { PreflightInput } from "./preflight";
import type { Drive, SnapshotData } from "../shared/types";

export interface ReportDeps {
  db: DB;
  cfg: CrateConfig;
  registry: Registry;
  /** user-added players from config.toml [players.players] (N78) */
  extraPlayers: () => PlayerSpec[];
}

function parseSnap(json: string | null): SnapshotData | null {
  return json ? (JSON.parse(json) as SnapshotData) : null;
}

/** Assemble DB state for the report builder. */
export function reportInput(deps: ReportDeps, driveId: string) {
  const { db, cfg } = deps;
  const drive = db.getDrive(driveId);
  if (!drive) throw new Error("unknown drive");
  const snap = parseSnap(drive.last_snapshot_json);
  const master = db.masterDrive();
  const masterSnap = parseSnap(master?.last_snapshot_json ?? null);
  const isMirror =
    drive.role === "mirror" ||
    drive.name.toUpperCase() === cfg.mirrorDrive.toUpperCase();
  // capacity: prefer live value; falls back to snapshot
  const withCap: Drive = {
    ...drive,
    capacity_bytes: drive.capacity_bytes || snap?.capacity_bytes || 0,
  };
  if (snap && !snap.capacity_bytes && drive.capacity_bytes)
    snap.capacity_bytes = drive.capacity_bytes;
  return {
    drive: withCap,
    snapshot: snap,
    latestVerify: db.latestVerify(driveId),
    bench: db.benchmarks(driveId),
    ledgerFiles: db.ledgerCount(driveId),
    ledgerStaleDays: db.ledgerAgeDays(driveId),
    masterSnapshot: masterSnap,
    masterName: master ? (master.nickname ?? master.name) : cfg.masterDrive,
    isMirror,
    // real verdict from the newest finished checksum job (null = never run)
    latestChecksum: db.latestChecksum(driveId),
  };
}

/** The full dossier export bundle (GET /drives/:id/export + deck_report
 *  {format:"dossier"}). */
export function exportDossier(
  deps: ReportDeps,
  driveId: string,
): Response | null {
  const { db, registry } = deps;
  const detail = registry.detail(driveId);
  if (!detail) return null;
  const dossier = {
    exported_at: new Date().toISOString(),
    drive: { ...detail.drive, last_snapshot_json: undefined },
    snapshot: detail.snapshot,
    sync: detail.sync,
    report: buildReport(reportInput(deps, driveId)),
    timeline: db.timeline(driveId, 500),
    benchmarks: db.benchmarks(driveId),
  };
  return new Response(JSON.stringify(dossier, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="cratedeck-${detail.drive.name}.json"`,
    },
  });
}

/** B12 input collector: per mounted drive, gather only what preflight reads.
 *  Mirrors reportInput's data plumbing but stays fleet-wide. */
export function allPreflightInputs(deps: ReportDeps): PreflightInput[] {
  const { db, cfg, registry, extraPlayers } = deps;
  const master = db.masterDrive();
  const masterSnap = parseSnap(master?.last_snapshot_json ?? null);
  return registry
    .list()
    .filter((d) => d.mounted)
    .map((d): PreflightInput => {
      const snap = parseSnap(d.last_snapshot_json);
      if (snap && !snap.capacity_bytes && d.capacity_bytes)
        snap.capacity_bytes = d.capacity_bytes;
      return {
        drive: d,
        snapshot: snap,
        latestVerify: db.latestVerify(d.id),
        bench: db.benchmarks(d.id),
        latestChecksum: db.latestChecksum(d.id),
        ledgerFiles: db.ledgerCount(d.id),
        masterSnapshot: d.id === master?.id ? null : masterSnap,
        isMirror:
          d.role === "mirror" ||
          d.name.toUpperCase() === cfg.mirrorDrive.toUpperCase(),
        // N78 rides on preflight: measured dual-DB rows → player verdict
        players: driveCompatibility(snap, extraPlayers()),
        now: Date.now(),
      };
    });
}
