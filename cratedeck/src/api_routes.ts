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
import type { DB } from "./db";
import type { Registry } from "./registry";
import type { JobEngine } from "./jobs";
import type { ImageService } from "./images";
import type { CrateConfig } from "./config";
import type { ArchiveReader } from "./archive";
import { buildPreflight } from "./preflight";
import { type ReportDeps, allPreflightInputs } from "./report_inputs";
import { VERIFY_HELP } from "./verify_help";
import { HELP_TERMS, HELP_JOBS, HELP_SURFACES } from "../shared/help";
import { archiveRoutes } from "./archive_routes";
import { portView } from "./port_view";
import { intakeCandidateDirs, intakeWatchDir } from "./intake_run";
import {
  boothFleetPayload,
  parseBoothFleetRequest,
  writeConfigBoothFleet,
} from "./booth_routes";
import { errMessage as errorText } from "../shared/fmt";
import type { makeHygieneRoutes } from "./hygiene_routes";
import type { makeFixesRoutes } from "./fixes_routes";

/** The shared services the /api slices read. Mirrors index.ts's module
 *  singletons — populated once at bootstrap, never reassigned. */
export interface ApiDeps {
  cfg: CrateConfig;
  db: DB;
  registry: Registry;
  jobs: JobEngine;
  images: ImageService;
  archive: ArchiveReader;
  reportDeps: ReportDeps;
  hygieneApi: ReturnType<typeof makeHygieneRoutes>;
  fixesApi: ReturnType<typeof makeFixesRoutes>;
  driveListPayload: () => Promise<unknown>;
  reportsPayload: () => unknown;
  driveSubroute: (
    req: Request,
    url: URL,
    id: string,
    sub: string | undefined,
  ) => Promise<Response | null> | Response | null;
  fleetRoutes: (route: string, url: URL) => Response | Promise<Response>;
  json: (data: unknown, status?: number) => Response;
  sse: () => Response;
  /** graceful stop (deckctl stop): watcher + jobs + closes + exit. */
  stopServer: () => void;
}

type Handler = (req: Request, url: URL) => Response | Promise<Response>;

/** Front-page aggregate: interlock + drives + jobs in one read — the
 *  deckctl status / deck_status REST twin. Wire shape is exactly what
 *  `deckctl status --json` prints. */
function metaRoutes(deps: ApiDeps): Record<string, Handler> {
  const { db, registry, jobs, json, sse, stopServer } = deps;
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
    "/events": (req) => {
      if (!req.headers.get("accept")?.includes("event-stream"))
        return json({ error: "text/event-stream required" }, 406);
      return sse();
    },
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

/** Job census + per-job reads + cancel. */
function jobRoutes(deps: ApiDeps): Record<string, Handler> {
  const { db, jobs, json } = deps;
  return {
    "/jobs": (_req, url) => {
      const active = url.searchParams.get("active");
      const drive = url.searchParams.get("drive");
      if (drive) return json(db.jobsForDrive(drive, 20, Boolean(active)));
      return json(active ? db.activeJobs() : db.jobsForDrive("*", 50));
    },
    "/jobs/:id": (req, url) => {
      const m = /\/jobs\/([^/]+)(\/cancel)?$/.exec(url.pathname.slice(4));
      const id = m?.[1];
      if (!id) return json({ error: "not found" }, 404);
      if (m[2] && req.method === "POST") return json({ ok: jobs.cancel(id) });
      return json(db.getJob(id));
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
  // /drives and /images/search are dynamic; handled below.

  const { db, jobs, images, json } = deps;

  return async (req, url, route) => {
    const exactHandler = exact.get(route);
    if (exactHandler) return exactHandler(req, url);
    // prefix families (delegators first so nested exacts can't shadow)
    if (route === "/drives") return json(await deps.driveListPayload());
    const driveMatch = route.match(/^\/drives\/([^/]+)(\/.*)?$/u);
    if (driveMatch?.[1]) {
      const id: string = decodeURIComponent(driveMatch[1]);
      const sub: string | undefined = driveMatch[2];
      const resp = await deps.driveSubroute(req, url, id, sub);
      if (resp) return resp;
      return json({ error: "unknown drive route" }, 404);
    }
    const jobMatch = route.match(/^\/jobs\/([^/]+)(\/cancel)?$/u);
    if (jobMatch?.[1]) {
      const id: string = jobMatch[1];
      const cancel: string | undefined = jobMatch[2];
      if (cancel && req.method === "POST") return json({ ok: jobs.cancel(id) });
      return json(db.getJob(id));
    }
    // ---- fleet superpowers (§B6/B7/B8 + O83 prep): one family, one handler
    if (route.startsWith("/fleet/")) return deps.fleetRoutes(route, url);
    // ---- archive reads (O82b): megadj's DB, readonly -----------------
    // Route family lives in archive_routes.ts (file-length guard);
    // null = no archive route matched, fall through.
    const archiveResp = await archiveRoutes(route, url, {
      archive: deps.archive,
      db,
      cfg: deps.cfg,
    });
    if (archiveResp) return archiveResp;
    if (route === "/images/search") {
      return json(await images.search(url.searchParams.get("q") ?? ""));
    }
    // ---- shelf hygiene (docs/getdat/shelf-hygiene-2026-09-09.md §4) ---
    if (route === "/hygiene") return deps.hygieneApi.list(url);
    if (route === "/hygiene/scan" && req.method === "POST")
      return deps.hygieneApi.scan();
    if (route === "/hygiene/apply" && req.method === "POST")
      return deps.hygieneApi.apply();
    if (route === "/hygiene/decide" && req.method === "POST")
      return deps.hygieneApi.decide(req);
    if (route === "/hygiene/bucket-confirm" && req.method === "POST")
      return deps.hygieneApi.bucketConfirm(req);
    if (route === "/hygiene/audio") return deps.hygieneApi.audio(url);
    if (route === "/hygiene/stats") return deps.hygieneApi.stats(url);
    // ---- booth fixes (Fleet→Booth fleet drives these checks) -----------
    if (route === "/fixes") return deps.fixesApi.list();
    if (route === "/fixes/scan" && req.method === "POST")
      return deps.fixesApi.scan();
    if (route === "/fixes/apply" && req.method === "POST")
      return deps.fixesApi.apply();
    return json({ error: "not found" }, 404);
  };
}
