// api_dispatch.ts — the dynamic (non-exact) tail of the /api router
// (#42; split out of api_routes.ts so the router closure stays a linear
// first-match chain under the CCN 30 ceiling — #89's "no CCN ≥30 in
// cratedeck/src" acceptance had regressed to 31 on the inline version).
// Each family below is its own flat probe: Response when the family owns
// the route, null to fall through to the next probe. makeApiRouter walks
// the probes in order and 404s when every one declines.
import { archiveRoutes } from "../archive/routes";
import type { ApiDeps } from "./deps";

/** The dynamic /drives family: /drives (list) + /drives/:id/<sub> (the
 *  id/sub pair delegated to the drive route table via driveSubroute). */
export async function driveDispatch(
  deps: ApiDeps,
  req: Request,
  url: URL,
  route: string,
): Promise<Response | null> {
  if (route === "/drives") return deps.json(await deps.driveListPayload());
  const driveMatch = route.match(/^\/drives\/([^/]+)(\/.*)?$/u);
  if (!driveMatch?.[1]) return null;
  const id: string = decodeURIComponent(driveMatch[1]);
  const resp = await deps.driveSubroute(req, url, id, driveMatch[2]);
  if (resp) return resp;
  return deps.json({ error: "unknown drive route" }, 404);
}

/** The dynamic /jobs family: /jobs/:id (status) + /jobs/:id/cancel
 *  (POST cancels). */
export function jobDispatch(
  deps: ApiDeps,
  req: Request,
  route: string,
): Response | null {
  const jobMatch = route.match(/^\/jobs\/([^/]+)(\/cancel)?$/u);
  if (!jobMatch?.[1]) return null;
  if (jobMatch[2] && req.method === "POST")
    return deps.json({ ok: deps.jobs.cancel(jobMatch[1]) });
  return deps.json(deps.db.getJob(jobMatch[1]));
}

/** The archive-read family (O82b): megadj's DB, readonly. Lives in
 *  archive/routes.ts (file-length guard); null = no archive route
 *  matched, fall through. The ONE write (POST /archive/skip) goes
 *  through megadjCli — archive mutation stays CLI (§4-A1). */
export async function archiveDispatch(
  deps: ApiDeps,
  req: Request,
  route: string,
  url: URL,
): Promise<Response | null> {
  const resp = await archiveRoutes(
    route,
    url,
    {
      archive: deps.archive,
      db: deps.db,
      cfg: deps.cfg,
      // surfaced-batch's enqueue goes through the REAL job engine (the
      // Intake tab's ingest job) — progress/cancel/SSE for the web's
      // "process the saved links" button.
      jobs: {
        enqueue: (driveId, kind, mountPoint, origin) =>
          deps.jobs.enqueue(driveId, kind, mountPoint, origin),
      },
    },
    deps.megadjCli,
    req,
  );
  return resp;
}

/** The hygiene + fixes delegator family (shelf-hygiene doc §4 / booth
 *  fixes). These were the last big sequential if-chain in the router
 *  closure — moved here so the closure stays linear. The `route ===`
 *  literal form is deliberate: the surface-parity census derives the
 *  HTTP route count from exactly these literals (switch labels would
 *  hide the routes from it). */
export async function hygieneFixesDispatch(
  deps: ApiDeps,
  req: Request,
  url: URL,
  route: string,
): Promise<Response | null> {
  const post = req.method === "POST";
  // ---- shelf hygiene (docs/getdat/shelf-hygiene-2026-09-09.md §4) ---
  if (route === "/hygiene") return deps.hygieneApi.list(url);
  if (route === "/hygiene/scan" && post) return deps.hygieneApi.scan();
  if (route === "/hygiene/apply" && post) return deps.hygieneApi.apply();
  if (route === "/hygiene/decide" && post)
    return await deps.hygieneApi.decide(req);
  if (route === "/hygiene/bucket-confirm" && post)
    return await deps.hygieneApi.bucketConfirm(req);
  if (route === "/hygiene/restore" && post)
    return await deps.hygieneApi.restore(req);
  if (route === "/hygiene/restore-all" && post)
    return await deps.hygieneApi.restoreAll();
  if (route === "/hygiene/quarantine") return deps.hygieneApi.quarantine();
  if (route === "/hygiene/quarantine/empty" && post)
    return await deps.hygieneApi.quarantineEmpty(req);
  if (route === "/hygiene/audio") return deps.hygieneApi.audio(url);
  if (route === "/hygiene/stats") return deps.hygieneApi.stats(url);
  // ---- booth fixes (Fleet → Booth fleet drives these checks) --------
  if (route === "/fixes") return deps.fixesApi.list();
  if (route === "/fixes/scan" && post) return deps.fixesApi.scan();
  if (route === "/fixes/apply" && post) return deps.fixesApi.apply();
  // ---- grid health (GA-05c, #167): triage runs + the card's reads ----
  if (route === "/grid-health") {
    return await deps.gridHealthApi.get(url.searchParams.get("drive"));
  }
  if (route === "/grid-health/scan" && post)
    return await deps.gridHealthApi.scan(url.searchParams.get("drive"));
  return null;
}
