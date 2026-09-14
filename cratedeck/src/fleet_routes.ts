// fleet_routes.ts — the /api/fleet/* family (B6/B7/B8 coverage + O83 prep),
// extracted from index.ts (complexity hot-spot split, #42): one factory, one
// route family, deps injected — no import back to index.ts (cycle safety).
import type { DB } from "./db";
import type { CrateConfig } from "./config";
import { coverage, redundancy, diff, trackLocations } from "./coverage";
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
