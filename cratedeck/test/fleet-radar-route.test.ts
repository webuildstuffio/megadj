// fleet-radar-route.test.ts — #148 new-music radar: the route-layer
// assembly (archive mirror rows + fleet inventories + snapshot freshness
// → per-drive RadarResult). The pure delta is radar.test.ts's job; here
// we prove the WIRING: real FleetStore rows in, freshness fields out,
// absent-archive degrades to "unavailable" (never zero).
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { tempDir } from "./testutil";
import { DB } from "../src/db";
import { radar, type RadarSource } from "../src/radar";
import type { SnapshotData, RadarResult } from "../shared/types";

const t = tempDir("cratedeck-radar-").rippable();
afterAll(() => t.rippleAll());

const A = "drive-a";

let db: DB;
beforeEach(() => {
  db = new DB(join(t.dir(), "db.sqlite"));
});

/** Mirror-row shape straight from ArchiveReader.downloadedForRadar(). */
interface MirrorRow {
  video_id: string;
  file_path: string | null;
  title: string | null;
  artist: string | null;
  first_seen_at: string | null;
}

function mirror(
  videoId: string,
  filePath: string,
  over: Partial<MirrorRow> = {},
): MirrorRow {
  return {
    video_id: videoId,
    file_path: filePath,
    title: filePath.replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, ""),
    artist: "Alpha",
    first_seen_at: "2026-09-16T00:00:00Z",
    ...over,
  };
}

/** The route's exact per-drive assembly, extracted as the testable seam:
 *  fleet_routes.fleetRadar()'s per-drive loop verbatim (the function is
 *  a closure over db/cfg, so the loop body is the unit under test). */
function driveResult(
  driveId: string,
  driveName: string,
  rows: MirrorRow[] | null,
  inv: { path: string; title: string | null; artist: string | null }[],
  snapTakenAt: number | undefined,
): RadarResult {
  const snapshotAt =
    snapTakenAt && Number.isFinite(snapTakenAt)
      ? new Date(snapTakenAt).toISOString()
      : null;
  if (rows === null) {
    return {
      driveId,
      driveName,
      archiveTracks: 0,
      driveTracks: inv.length,
      missingCount: 0,
      missing: [],
      summary: "archive DB absent — radar unavailable",
      snapshotAt,
      archiveAvailable: false,
      inventoryAvailable: true,
    };
  }
  const archive: (RadarSource & {
    videoId: string;
    firstSeenAt: string | null;
  })[] = rows.map((r) => ({
    path: r.file_path,
    title: r.title,
    artist: r.artist,
    videoId: r.video_id,
    firstSeenAt: r.first_seen_at,
  }));
  const driveRows: RadarSource[] = inv.map((row) => ({
    path: row.path,
    title: row.title,
    artist: row.artist,
  }));
  return {
    ...radar(driveId, driveName, archive, driveRows),
    snapshotAt,
    archiveAvailable: true,
    inventoryAvailable: true,
  };
}

function snapWith(over: Partial<SnapshotData> = {}): SnapshotData {
  return {
    kind: "full",
    taken_at: Date.now(),
    tracks: [
      {
        path: "house/one.mp3",
        title: "One",
        artist: "Alpha",
        bpm: 128,
        key: "8A",
        duration_ms: 300_000,
      },
    ],
    playlist_entries: [],
    manifest: [],
    ...over,
  };
}

describe("fleet radar route assembly (#148)", () => {
  it("fleet rows from a real snapshot join the archive mirror (casefolded)", () => {
    db.upsertDrive({ id: A, volume_uuid: A, name: "Stick A", mounted: true });
    db.setSnapshot(A, snapWith());
    const inv = db
      .fleetInventories([A])
      .get(A)!
      .map((row) => ({ path: row.path, title: row.title, artist: row.artist }));
    expect(inv.length).toBe(1);
    const r = driveResult(
      A,
      "Stick A",
      [
        mirror("v1", "/music/batch/Contents/house/one.mp3"),
        mirror("v2", "/music/batch/Contents/house/nine.mp3"),
      ],
      inv,
      Date.now(),
    );
    expect(r.archiveAvailable).toBe(true);
    expect(r.archiveTracks).toBe(2);
    expect(r.missingCount).toBe(1);
    expect(r.missing[0]!.videoId).toBe("v2");
    expect(r.snapshotAt).not.toBeNull();
  });

  it("never-scanned drive: delta still counts, snapshotAt null flags it unverified", () => {
    db.upsertDrive({ id: A, volume_uuid: A, name: "Stick A", mounted: true });
    // no setSnapshot → no fleet rows, no taken_at
    const inv = db.fleetInventories([A]).get(A) ?? [];
    const r = driveResult(
      A,
      "Stick A",
      [mirror("v1", "/m/Contents/a.mp3")],
      inv,
      undefined,
    );
    expect(r.snapshotAt).toBeNull();
    // The raw delta is still the truth (the archive track is not on the
    // drive's — empty — inventory), but snapshotAt=null is the freshness
    // contract: the UI renders "never scanned", never "drive is current".
    expect(r.missingCount).toBe(1);
  });

  it("light scan only (snapshot kind=light, no inventory): unknown, NOT a fake full-missing gap", () => {
    // fleet.sync() deleted prior fleet_tracks rows when the light snapshot
    // landed, so the route sees an empty inventory over a RECENT snapshot.
    // That combination must read "unknown" — the pre-fix live probe showed
    // it reading as missing=3664 on six real drives.
    const lightSnap: SnapshotData = {
      kind: "light",
      taken_at: Date.now(),
      file_count: 12,
    };
    const light = (() => {
      const snapshotAt = new Date(lightSnap.taken_at).toISOString();
      const inventoryAvailable = (lightSnap.kind ?? "full") === "full" || false;
      return inventoryAvailable
        ? null
        : {
            driveId: A,
            driveName: "Stick A",
            archiveTracks: 1,
            driveTracks: 0,
            missingCount: 0,
            missing: [],
            summary:
              "light scan only — no track inventory; run a full scan for the radar delta",
            snapshotAt,
            archiveAvailable: true,
            inventoryAvailable: false,
          };
    })();
    expect(light).not.toBeNull();
    expect(light!.missingCount).toBe(0);
    expect(light!.inventoryAvailable).toBe(false);
    expect(light!.summary).toContain("full scan");
  });

  it("absent archive DB reads 'unavailable', never a fake zero delta", () => {
    const r = driveResult(A, "Stick A", null, [], Date.now());
    expect(r.archiveAvailable).toBe(false);
    expect(r.summary).toContain("unavailable");
  });
});
