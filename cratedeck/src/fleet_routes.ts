// fleet_routes.ts — the /api/fleet/* family (B6/B7/B8 coverage + O83 prep),
// extracted from index.ts (complexity hot-spot split, #42): one factory, one
// route family, deps injected — no import back to index.ts (cycle safety).
import type { DB } from "./db";
import type { CrateConfig } from "./config";
import { coverage, trackLocations } from "./coverage";
import { redundancy, diff } from "./coverage_fleet";
import { radar, type RadarSource } from "./radar";
import { ArchiveReader } from "./archive";
import type { FleetRadar, RadarResult } from "../shared/types";
import { fetchWeeklyPrepInput, renderWeeklyPrep } from "./weekly_prep";

export function makeFleetRoutes(deps: {
  db: DB;
  cfg: CrateConfig;
  json: (data: unknown, status?: number) => Response;
}) {
  const { db, cfg, json } = deps;

  /** GET /api/drives + GET /api/status: the drive cards' id→name view, so
   *  fleet payloads answer with nicknames the UI already shows. */
  function driveNames(): Map<string, string> {
    return new Map(db.allDrives().map((d) => [d.id, d.nickname ?? d.name]));
  }

  // ---- new-music radar (#148) --------------------------------------------
  // The delta is a pure set difference (radar.ts) over two injected row
  // sets: the archive DB's downloaded mirror and each drive's fleet_tracks
  // snapshot. Freshness rule: every row carries its snapshot's age — a
  // stale snapshot reads as stale, never as "drive is current".

  /** Archive mirror rows, or null when the archive DB is absent (the radar
   *  answers "unavailable", not zero). One short-lived readonly handle per
   *  call — the radar is a nav-tab read, not a hot loop; closing keeps the
   *  server's long-lived sqlite footprint unchanged. */
  function radarArchive() {
    const reader = new ArchiveReader(cfg.archiveDbPath);
    try {
      if (!reader.available()) return null;
      return reader.downloadedForRadar();
    } finally {
      reader.close();
    }
  }

  function fleetRadar(): FleetRadar {
    const rows = radarArchive();
    const names = driveNames();
    const drives: RadarResult[] = [];
    for (const d of db.allDrives()) {
      const inv = db.fleetInventories([d.id]).get(d.id) ?? [];
      const snap = db.latestSnapshots().get(d.id);
      // taken_at is a wall-clock ms epoch from the scan leg (scan.ts).
      const snapshotAt =
        snap?.taken_at && Number.isFinite(snap.taken_at)
          ? new Date(snap.taken_at).toISOString()
          : null;
      // Light scans carry no track inventory (only full scans fill
      // snap.tracks), and fleet.sync() deletes prior fleet_tracks rows —
      // so an empty inventory over a light snapshot is "unknown", not
      // "drive has zero tracks". The delta must not read as a fake gap.
      const inventoryAvailable =
        (snap?.kind ?? "full") === "full" || inv.length > 0;
      if (rows === null) {
        drives.push({
          driveId: d.id,
          driveName: names.get(d.id) ?? d.name,
          archiveTracks: 0,
          driveTracks: inv.length,
          missingCount: 0,
          missing: [],
          summary: "archive DB absent — radar unavailable",
          snapshotAt,
          archiveAvailable: false,
          inventoryAvailable,
        });
        continue;
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
      const driveRows: RadarSource[] = inv.map((t) => ({
        path: t.path,
        title: t.title,
        artist: t.artist,
      }));
      if (!inventoryAvailable) {
        drives.push({
          driveId: d.id,
          driveName: names.get(d.id) ?? d.name,
          archiveTracks: rows.length,
          driveTracks: inv.length,
          missingCount: 0,
          missing: [],
          summary:
            "light scan only — no track inventory; run a full scan for the radar delta",
          snapshotAt,
          archiveAvailable: true,
          inventoryAvailable: false,
        });
        continue;
      }
      drives.push({
        ...radar(d.id, names.get(d.id) ?? d.name, archive, driveRows),
        snapshotAt,
        archiveAvailable: true,
        inventoryAvailable: true,
      });
    }
    const archiveTracks = rows?.length ?? 0;
    const totalMissing = drives.reduce((s, d) => s + d.missingCount, 0);
    const stale = drives.filter((d) => d.snapshotAt === null).length;
    const light = drives.filter((d) => !d.inventoryAvailable).length;
    const parts: string[] = [];
    if (rows === null) parts.push("archive DB absent — radar unavailable");
    else if (totalMissing === 0)
      parts.push(`fleet matches the archive (${archiveTracks} tracks)`);
    else
      parts.push(`${totalMissing} archive track(s) missing across the fleet`);
    if (stale > 0)
      parts.push(
        `${stale} drive${stale === 1 ? "" : "s"} never scanned — radar unknown there`,
      );
    if (light > 0)
      parts.push(
        `${light} drive${light === 1 ? "" : "s"} light-scanned only — run a full scan`,
      );
    return {
      drives,
      totalMissing,
      archiveTracks,
      archiveAvailable: rows !== null,
      summary: parts.join(" · "),
    };
  }

  return async function fleetRoutes(
    route: string,
    url: URL,
  ): Promise<Response> {
    if (route === "/fleet/coverage") {
      const minCopies = Math.max(
        1,
        parseInt(url.searchParams.get("min_copies") ?? "2", 10) || 2,
      );
      const names = driveNames();
      const result = coverage(db.fleetInventories(), minCopies);
      return json({
        ...result,
        drives: result.drives.map((d) => ({
          ...d,
          name: names.get(d.id) ?? d.id,
        })),
        rows: undefined, // full matrix is huge; at_risk + lookups cover the UI
      });
    }
    if (route === "/fleet/track") {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (!q) return json({ error: "q required" }, 400);
      const names = driveNames();
      const hit = trackLocations(db.fleetInventories(), q) ?? null;
      return json(
        hit
          ? {
              ...hit,
              drives: hit.drives.map((id) => ({
                id,
                name: names.get(id) ?? id,
                mounted: Boolean(db.getDrive(id)?.mounted),
              })),
            }
          : { identity: null, drives: [] },
      );
    }
    if (route === "/fleet/redundancy") {
      const minCopies = Math.max(
        1,
        parseInt(url.searchParams.get("min_copies") ?? "2", 10) || 2,
      );
      const names = driveNames();
      const result = redundancy(
        db.fleetInventories(),
        db.fleetPlaylistEntries(),
        minCopies,
      );
      return json({
        ...result,
        playlists: result.playlists.map((p) => ({
          ...p,
          tracks: p.tracks.map((t) => ({
            ...t,
            drives: t.drives.map((id) => ({
              id,
              name: names.get(id) ?? id,
            })),
          })),
        })),
      });
    }
    // New-music radar (#148, PRD F10): archive rows each drive's latest
    // snapshot lacks. v1 is COPY-only — the fix command is text, never an
    // automatic write (the playing-USB boundary stands).
    if (route === "/fleet/radar") {
      return json(fleetRadar());
    }
    if (route === "/fleet/diff") {
      const a = url.searchParams.get("a");
      const b = url.searchParams.get("b");
      if (!a || !b) return json({ error: "a and b drive ids required" }, 400);
      const da = db.getDrive(a);
      const dbb = db.getDrive(b);
      if (!da || !dbb) return json({ error: "unknown drive" }, 404);
      const inv = db.fleetInventories([a, b]);
      const mans = db.fleetManifests([a, b]);
      const result = diff(
        da.nickname ?? da.name,
        inv.get(a) ?? [],
        mans.get(a) ?? null,
        dbb.nickname ?? dbb.name,
        inv.get(b) ?? [],
        mans.get(b) ?? null,
      );
      return json(result);
    }
    // weekly prep digest (O83): the markdown brief, server-rendered. Self-
    // fetch: the sweep leg can take ~15s — the caller-supplied timeoutMs is
    // ignored here because fetch() has no external deadline; degrade-on-catch
    // still applies per leg.
    try {
      const input = await fetchWeeklyPrepInput(async (p: string) => {
        const r = await fetch(`http://127.0.0.1:${cfg.serverPort}${p}`);
        if (!r.ok) throw new Error(`${p} → ${r.status}`);
        return r.json();
      });
      return json({ markdown: renderWeeklyPrep(input) });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  };
}
