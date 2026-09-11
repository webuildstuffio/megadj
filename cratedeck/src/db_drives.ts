// db_drives.ts — drives table CRUD + snapshot store. Split from db.ts at
// the file-length guard (lizard was also reporting the whole drive/snapshot
// half of class DB as one 75-CCN "canon" blob); DB delegates so every call
// site is unchanged. canon() and inferRole() live here with their only
// callers — this module never imports db.ts (no cycle).
import type { Database } from "bun:sqlite";
import type { Drive, SnapshotData, VerifyReport } from "../shared/types";
import { canon } from "./db_canon";
import { sanitizeVerifyReport } from "./verify_report";
import { parseSnapshotJson } from "../shared/badges";

/** Raw row shape as stored in the drives table (mounted is 0/1). */
interface DriveRow extends Omit<Drive, "mounted"> {
  mounted: number;
}

/** Snapshot history is capped so years of scans can't eat the host disk. */
const MAX_SNAPSHOTS_PER_DRIVE = 20;

function decodeSnapshot(driveId: string, data: string): SnapshotData | null {
  const parsed = parseSnapshotJson(data);
  if (parsed.corrupt) {
    console.error(`snapshot for drive ${driveId} is corrupt — skipping`);
    return null;
  }
  return parsed.snap;
}

/** A snapshot blob minus `taken_at` — the field the setSnapshot dedupe
 *  guard compares around. Pure — module-level, not re-created per call. */
function snapshotWithoutTakenAt(s: SnapshotData): Record<string, unknown> {
  const { taken_at: _takenAt, ...rest } = s;
  return rest;
}

/** Role from the CONFIGURED volume names, not just the doc defaults —
 *  config.toml's library.master_drive/mirror_drive/shelf_drive promise an
 *  override, and a drive that misses its role silently degrades parity
 *  checks + badges. Passed per-call by DB.upsertDrive so late config
 *  binding (db.masterName = cfg.masterDrive after construction) holds. */
export function inferRole(
  volumeName: string,
  masterName = "DJMASTER",
  mirrorName = "DJMIRROR",
  shelfName = "SHELF1",
): Drive["role"] {
  const n = volumeName.toUpperCase();
  if (n === masterName.toUpperCase()) return "master";
  if (n === mirrorName.toUpperCase()) return "mirror";
  if (n === shelfName.toUpperCase()) return "shelf";
  if (n.startsWith("DJ") || n.startsWith("CRATE")) return "library";
  return "unknown";
}

/** Drives + snapshots query surface (owned by DB via delegation). */
export class DriveStore {
  constructor(private readonly sqlite: Database) {}

  private normDrive(d: DriveRow): Drive {
    return {
      ...d,
      mounted: Boolean(d.mounted),
      // heal legacy crash rows at the one choke point every drive read
      // flows through (allDrives/get/getByUuid) — a stored report with no
      // FINAL verdict and no failing checks must never ride the wire
      // looking like a measured (almost-healthy) run.
      verify_report_json: d.verify_report_json
        ? JSON.stringify(sanitizeVerifyReport(JSON.parse(d.verify_report_json)))
        : null,
    };
  }

  get(id: string): Drive | null {
    const r = this.sqlite
      .query("SELECT * FROM drives WHERE id = ?")
      .get(id) as DriveRow | null;
    return r ? this.normDrive(r) : null;
  }

  getByUuid(uuid: string): Drive | null {
    const r = this.sqlite
      .query("SELECT * FROM drives WHERE volume_uuid = ?")
      .get(uuid) as DriveRow | null;
    return r ? this.normDrive(r) : null;
  }

  all(): Drive[] {
    return (
      this.sqlite
        .query(
          "SELECT * FROM drives ORDER BY mounted DESC, nickname IS NULL, name",
        )
        .all() as DriveRow[]
    ).map((r) => this.normDrive(r));
  }

  upsert(
    d: Partial<Drive> & { id: string },
    masterName: string,
    mirrorName: string,
    shelfName: string,
  ): void {
    const cur = this.get(d.id);
    if (!cur) {
      const now = Date.now();
      this.sqlite
        .query(
          `INSERT INTO drives (id, volume_uuid, name, capacity_bytes, fs, vendor,
             model, usb_serial, role, first_seen_at, last_seen_at,
             last_port_key, plug_count, mounted, link_bps)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          d.id,
          d.volume_uuid ?? null,
          d.name ?? "",
          d.capacity_bytes ?? 0,
          d.fs ?? null,
          d.vendor ?? null,
          d.model ?? null,
          d.usb_serial ?? null,
          d.role ?? inferRole(d.name ?? "", masterName, mirrorName, shelfName),
          now,
          now,
          d.last_port_key ?? null,
          1,
          d.mounted ? 1 : 0,
          d.link_bps ?? null,
        );
      return;
    }
    this.sqlite
      .query(
        `UPDATE drives SET name=COALESCE(?,name), capacity_bytes=COALESCE(?,capacity_bytes),
           fs=COALESCE(?,fs), vendor=COALESCE(?,vendor), model=COALESCE(?,model),
           usb_serial=COALESCE(?,usb_serial), role=COALESCE(?,role),
           last_seen_at=?, last_port_key=COALESCE(?,last_port_key),
           mounted=?, nickname=COALESCE(?,nickname),
           link_bps=COALESCE(?,link_bps)
         WHERE id=?`,
      )
      .run(
        d.name ?? null,
        d.capacity_bytes ?? null,
        d.fs ?? null,
        d.vendor ?? null,
        d.model ?? null,
        d.usb_serial ?? null,
        d.role ?? null,
        d.last_seen_at ?? Date.now(),
        d.last_port_key ?? null,
        d.mounted === undefined ? 1 : d.mounted ? 1 : 0,
        d.nickname ?? null,
        d.link_bps ?? null,
        d.id,
      );
  }

  setMounted(id: string, mounted: boolean): void {
    this.sqlite
      .query("UPDATE drives SET mounted=?, last_seen_at=? WHERE id=?")
      .run(mounted ? 1 : 0, Date.now(), id);
  }

  /** Persist the latest verify report for a drive (or clear with null). */
  setVerifyReport(id: string, report: VerifyReport | null): void {
    this.sqlite
      .query("UPDATE drives SET verify_report_json=? WHERE id=?")
      .run(report ? JSON.stringify(report) : null, id);
  }

  getVerifyReport(id: string): VerifyReport | null {
    const r = this.sqlite
      .query<{ verify_report_json: string | null }, [string]>(
        "SELECT verify_report_json FROM drives WHERE id=?",
      )
      .get(id);
    if (!r?.verify_report_json) return null;
    try {
      // sanitizeVerifyReport re-marks legacy crash rows (no FINAL line, no
      // failing checks) as an explicit script-failed check — a corrupt
      // verdict must not read as a measured (almost-healthy) drive.
      return sanitizeVerifyReport(
        JSON.parse(r.verify_report_json) as VerifyReport,
      );
    } catch (e) {
      // A corrupt persisted verdict must NOT read as "never verified" —
      // that flips the drive to the reassuring unknown state forever.
      // Surface the corruption in the console (and as null, which the UI
      // renders as "never verified" WITH this trace to explain why).
      console.error(
        `verify report for drive ${id} is corrupt — treating as never verified`,
        e,
      );
      return null;
    }
  }

  /** Increment at mount time (ghost → mounted flip). Called by registry. */
  bumpPlugCount(id: string): void {
    this.sqlite
      .query("UPDATE drives SET plug_count = plug_count + 1 WHERE id=?")
      .run(id);
  }

  /** Stamp first_seen_at (now) — called by DB.bumpPlugCount on the first
   *  mount (plug_count 0 → 1), preserving the old INSERT's semantics. */
  bumpFirstSeen(id: string): void {
    this.sqlite
      .query("UPDATE drives SET first_seen_at=? WHERE id=?")
      .run(Date.now(), id);
  }

  setNickname(id: string, nickname: string | null): void {
    // Whitespace/empty is not a name — callers mean "clear" (null) or sent
    // garbage; storing "" or "   " renders as a blank label downstream.
    const trimmed = nickname?.trim();
    const value = trimmed ? trimmed : null;
    this.sqlite.query("UPDATE drives SET nickname=? WHERE id=?").run(value, id);
  }

  setPhoto(id: string, path: string): void {
    this.sqlite
      .query("UPDATE drives SET photo_path=? WHERE id=?")
      .run(path, id);
  }

  /** True when the stored snapshot equals `snap` apart from taken_at —
   *  the setSnapshot dedupe guard. False also when there is no parsable
   *  prior blob (caller must write). canon() must recurse (see its doc):
   *  nested-only edits are real library changes and must NOT dedupe. */
  snapshotUnchanged(id: string, snap: SnapshotData): boolean {
    const cur = this.get(id);
    if (!cur?.last_snapshot_json) return false;
    try {
      const prev = JSON.parse(cur.last_snapshot_json) as SnapshotData;
      return (
        canon(snapshotWithoutTakenAt(prev)) ===
        canon(snapshotWithoutTakenAt(snap))
      );
    } catch (e) {
      // Unparsable previous blob: the dedupe guard can't run, so we fall
      // through and write — but silently skipping the compare would mask
      // HOW the blob got corrupt. Log it at the boundary.
      console.error(
        `previous snapshot blob for drive ${id} unparsable — rewriting`,
        e,
      );
      return false;
    }
  }

  /** The two snapshot writes (latest blob + history row). */
  putSnapshot(id: string, snap: SnapshotData): void {
    const json = JSON.stringify(snap);
    this.sqlite
      .query("UPDATE drives SET last_snapshot_json=? WHERE id=?")
      .run(json, id);
    this.sqlite
      .query(
        "INSERT OR REPLACE INTO snapshots (drive_id, taken_at, kind, data_json) VALUES (?,?,?,?)",
      )
      .run(id, snap.taken_at, snap.kind, json);
  }

  /** Latest snapshot blob per drive (fleet queries' + UI's input). */
  latestSnapshots(): Map<string, SnapshotData> {
    const rows = this.sqlite
      .query(
        `SELECT drive_id, data_json FROM snapshots s WHERE taken_at = (
           SELECT MAX(taken_at) FROM snapshots WHERE drive_id = s.drive_id)`,
      )
      .all() as { drive_id: string; data_json: string }[];
    const out = new Map<string, SnapshotData>();
    for (const r of rows) {
      const snapshot = decodeSnapshot(r.drive_id, r.data_json);
      if (snapshot) out.set(r.drive_id, snapshot);
    }
    return out;
  }

  snapshots(driveId: string): SnapshotData[] {
    return (
      this.sqlite
        .query(
          "SELECT data_json FROM snapshots WHERE drive_id=? ORDER BY taken_at",
        )
        .all(driveId) as { data_json: string }[]
    ).flatMap((r) => {
      const snapshot = decodeSnapshot(driveId, r.data_json);
      return snapshot ? [snapshot] : [];
    });
  }

  /** Keep the newest MAX_SNAPSHOTS_PER_DRIVE snapshots per drive. */
  pruneAll(max = MAX_SNAPSHOTS_PER_DRIVE): void {
    this.sqlite
      .query(
        `DELETE FROM snapshots WHERE drive_id IN (
           SELECT DISTINCT drive_id FROM snapshots
         ) AND taken_at NOT IN (
           SELECT taken_at FROM snapshots s2
           WHERE s2.drive_id = snapshots.drive_id
           ORDER BY taken_at DESC LIMIT ?
         )`,
      )
      .run(max);
  }

  /** Called after each setSnapshot so history never grows unbounded. */
  pruneFor(driveId: string, max = MAX_SNAPSHOTS_PER_DRIVE): void {
    this.sqlite
      .query(
        `DELETE FROM snapshots WHERE drive_id=? AND taken_at NOT IN (
           SELECT taken_at FROM snapshots WHERE drive_id=?
           ORDER BY taken_at DESC LIMIT ?
         )`,
      )
      .run(driveId, driveId, max);
  }
}
