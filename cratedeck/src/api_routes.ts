// api_routes.ts — the /api dispatch slices (#42): the route families that
// stayed inline in index.ts after the fleet/drive/archive extractions,
// grouped so each slice has one home and apiRequest is a linear
// first-match chain over them. Deps are the module-level services of
// index.ts, injected as one object (same pattern as makeDriveRoutes).
//
// Slices:
//   metaRoutes     — /status /interlock /help /help/jobs /reports
//                    /preflight /ports /search /events /stop
//   boothRoutes    — /booth/fleet GET/POST
//   jobRoutes      — /jobs, /jobs/:id, /jobs/:id/cancel
//   hygieneRoutes  — /hygiene* delegation
//   fixesRoutes    — /fixes* delegation
//   intakeRoutes   — /intake/folders, /intake/start
//   driveRoutes    — /drives, /drives/:id/... (delegates to driveSubroute)
//   imageRoutes    — /images/search
import { buildPreflight } from "./preflight";
import { allPreflightInputs } from "./report_inputs";
import { VERIFY_HELP } from "./verify_help";
import { HELP_TERMS, HELP_JOBS, HELP_SURFACES } from "../shared/help";
import {
  archiveDispatch,
  driveDispatch,
  hygieneFixesDispatch,
  jobDispatch,
} from "./api_dispatch";
import { portView } from "./port_view";
import { intakeCandidateDirs, intakeWatchDir } from "./intake_run";
import {
  boothFleetPayload,
  parseBoothFleetRequest,
  writeConfigBoothFleet,
} from "./booth_routes";
import { errMessage as errorText } from "../shared/fmt";
// ApiDeps/Handler moved to the api_deps leaf (#173 madge pass): dispatch's
// type-only back-edge into this file WAS a cycle. Both sides import the
// leaf now; the dependency arrow runs one way again.
import type { ApiDeps, Handler } from "./api_deps";

/** The shared services the /api slices read — canonically DEFINED in
 *  ./api_deps (this re-export keeps existing `from "./api_routes"`
 *  consumers on the same symbol, never a twin). Handler is internal:
 *  it has no importer outside these two modules, so it is NOT
 *  re-exported (knip would flag a dead twin). */
export type { ApiDeps } from "./api_deps";

/** Front-page aggregate: interlock + drives + jobs in one read — the
 *  deckctl status / deck_status REST twin. Wire shape is exactly what
 *  `deckctl status --json` prints. */
function metaRoutes(deps: ApiDeps): Record<string, Handler> {
  const { db, registry, jobs, json, sse, stopServer } = deps;
  /** SSE job-event stream. 406 (was fall-through 404 pre-#42) when the
   *  client doesn't ask for event-stream — a plain GET is a client bug,
   *  and 406 says so instead of masquerading as a missing route. */
  const eventsHandler: Handler = (req) => {
    if (!req.headers.get("accept")?.includes("event-stream"))
      return json({ error: "text/event-stream required" }, 406);
    return sse();
  };
  return {
    "/status": async () =>
      json({
        interlock: (() => {
          const lock = jobs.interlock();
          return { rekordbox_running: lock.running, pid: lock.pid };
        })(),
        drives: await deps.driveListPayload(),
        jobs: db.activeJobs(),
      }),
    "/interlock": () => {
      const lock = jobs.interlock();
      return json({ rekordbox_running: lock.running, pid: lock.pid });
    },
    "/reports": () => json(deps.reportsPayload()),
    // B12 preflight: the gig-night pass/fail across every mounted drive
    "/preflight": () =>
      json(buildPreflight(allPreflightInputs(deps.reportDeps))),
    // in-app help SSOT: glossary + job/surface explainers (deckctl/MCP
    // can serve the same wording the UI tooltips use)
    "/help": () =>
      json({ terms: HELP_TERMS, jobs: HELP_JOBS, surfaces: HELP_SURFACES }),
    // global help: what does each job kind do (human + agent readable)
    "/help/jobs": () => json(VERIFY_HELP),
    "/ports": () => json(portView(db.allDrives())),
    "/search": (_req, url) =>
      json(registry.search(url.searchParams.get("q") ?? "")),
    "/events": eventsHandler,
    // trailing-slash spelling kept (base matched both; hand-written
    // clients use either) — same handler, same 406 negotiation.
    "/events/": eventsHandler,
    "/stop": (req) => {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      // graceful: stop watcher + jobs, then exit (used by deckctl stop)
      setTimeout(stopServer, 50);
      return json({ ok: true });
    },
  };
}

/** Booth fleet settings: GET serves the catalog + current selection; POST
 *  persists the selection to config.toml [booth].fleet (atomic rewrite via
 *  the tmp+rename in writeConfigBoothFleet) and re-derives the floor. */
function boothRoutes(deps: ApiDeps): Record<string, Handler> {
  const { cfg, json } = deps;
  return {
    "/booth/fleet": async (req) => {
      if (req.method === "GET") return json(boothFleetPayload(cfg.boothFleet));
      if (req.method !== "POST") return json({ error: "not found" }, 404);
      let body: unknown;
      try {
        body = await req.json();
      } catch (error) {
        return json({ error: `invalid JSON body: ${errorText(error)}` }, 400);
      }
      let next: string[];
      try {
        next = parseBoothFleetRequest(body);
      } catch (error) {
        return json({ error: errorText(error) }, 400);
      }
      writeConfigBoothFleet(cfg.root, next);
      cfg.boothFleet = next;
      return json(boothFleetPayload(next));
    },
  };
}

/** Job census + per-job reads + cancel. /jobs/:id(/cancel) is matched by
 *  the jobMatch regex in makeApiRouter — exact-table keys can't carry
 *  path params, so only the census route lives here. */
function jobRoutes(deps: ApiDeps): Record<string, Handler> {
  const { db, json } = deps;
  return {
    "/jobs": (_req, url) => {
      const active = url.searchParams.get("active");
      const drive = url.searchParams.get("drive");
      if (drive) return json(db.jobsForDrive(drive, 20, Boolean(active)));
      return json(active ? db.activeJobs() : db.jobsForDrive("*", 50));
    },
  };
}

/** Archive intake (GetDat Intake tab): allowlisted folder listing + start. */
function intakeRoutes(deps: ApiDeps): Record<string, Handler> {
  const { cfg, jobs, json } = deps;
  return {
    "/intake/folders": () =>
      json({
        watch: intakeWatchDir(cfg),
        candidates: intakeCandidateDirs(cfg),
      }),
    "/intake/start": async (req) => {
      if (req.method !== "POST") return json({ error: "not found" }, 404);
      let body: { folder?: string };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      const folder = (body.folder ?? "").trim();
      if (!folder) return json({ error: "folder is required" }, 400);
      const candidates = intakeCandidateDirs(cfg);
      const ok = candidates.some((c) => c.path === folder && c.exists);
      if (!ok) {
        return json(
          {
            error:
              "folder not on the intake allowlist — pick one from /intake/folders",
          },
          403,
        );
      }
      // Same job engine as drive jobs: interlock, one-at-a-time, SSE live.
      const job = jobs.enqueue("local-archive", "ingest", folder, "web");
      return json(job);
    },
  };
}

/** Build the dispatch table: exact-path entries + prefix delegators.
 *  Returned as a first-match chain over the ordered slices. */
export type ApiRouter = (
  req: Request,
  url: URL,
  route: string,
) => Promise<Response>;

export function makeApiRouter(deps: ApiDeps): ApiRouter {
  const exact = new Map<string, Handler>();
  const register = (table: Record<string, Handler>): void => {
    for (const [path, handler] of Object.entries(table))
      exact.set(path, handler);
  };
  register(metaRoutes(deps));
  register(boothRoutes(deps));
  register(jobRoutes(deps));
  register(intakeRoutes(deps));
  // Dynamic families live in api_dispatch.ts (one flat probe each); the
  // closure below stays a linear first-match walk so it sits far under
  // the CCN 30 ceiling (#89 acceptance — the inline version had crept to
  // CCN 31).

  const { json, images } = deps;

  return async (req, url, route) => {
    const exactHandler = exact.get(route);
    if (exactHandler) return exactHandler(req, url);
    // prefix families (delegators first so nested exacts can't shadow)
    const driveResp = await driveDispatch(deps, req, url, route);
    if (driveResp) return driveResp;
    const jobResp = jobDispatch(deps, req, route);
    if (jobResp) return jobResp;
    // ---- fleet superpowers (§B6/B7/B8 + O83 prep): one family, one handler
    if (route.startsWith("/fleet/")) return deps.fleetRoutes(route, url);
    // ---- archive reads (O82b): megadj's DB, readonly -----------------
    const archiveResp = await archiveDispatch(deps, route, url);
    if (archiveResp) return archiveResp;
    if (route === "/images/search") {
      return json(await images.search(url.searchParams.get("q") ?? ""));
    }
    const hygieneFixesResp = await hygieneFixesDispatch(deps, req, url, route);
    if (hygieneFixesResp) return hygieneFixesResp;
    return json({ error: "not found" }, 404);
  };
}
