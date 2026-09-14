// index.ts — wire-up: config → db → detector → jobs → HTTP+SSE. 127.0.0.1 only.
// Route families and the lifecycle loop live in their own modules (complexity
// hot-spot split, #42): fleet_routes.ts, drive_routes.ts, server_lifecycle.ts.
// This file keeps ONLY bootstrap, service construction, and the listen call.
import { join } from "node:path";
import { loadConfig } from "./config";
import { DB } from "./db";
import { Guard } from "./guard";
import { watchVolumes } from "./detect";
import { Registry } from "./registry";
import { JobEngine } from "./jobs";
import { ImageService } from "./images";
import { ShelfSweepReader } from "./shelf_sweep_reader";
import { HygieneReader } from "./hygiene_reader";
import { makeHygieneRoutes } from "./hygiene_routes";
import { makeFixesRoutes } from "./fixes_routes";
import { buildPreflight } from "./preflight";
import { VERIFY_HELP } from "./verify_help";
import { HELP_TERMS, HELP_JOBS, HELP_SURFACES } from "../shared/help";
import { ArchiveReader } from "./archive";
import { archiveRoutes } from "./archive_routes";
import { portView } from "./port_view";
import { allPreflightInputs, type ReportDeps } from "./report_inputs";
import { playersFromConfig } from "./players";
import {
  intakeCandidateDirs,
  intakeWatchDir,
  megadjCliPath,
} from "./intake_run";
import { isTrustedMutationRequest, withSecurityHeaders } from "./http_security";
import { makeServerLifecycle } from "./server_lifecycle";
import { makeFleetRoutes } from "./fleet_routes";
import { makeDriveRoutes } from "./drive_routes";
import { photoUpload, makeEnqueueDriveJob } from "./drive_job_routes";

const here = import.meta.dir.replace(/\/src$/, ""); // .../cratedeck
const cfg = loadConfig(here);
const db = new DB(cfg.dbPath);
// role inference must compare against the CONFIGURED volume names, not the
// DJMASTER/DJMIRROR doc defaults (custom library.master_drive setups would
// otherwise get role "unknown" and silently lose parity checks + badges)
db.masterName = cfg.masterDrive;
db.mirrorName = cfg.mirrorDrive;
db.shelfName = cfg.shelfDrive;
const guard = new Guard(cfg);
const webRoot = join(here, "web", "dist");
// O82b archive tools: one shared readonly handle over megadj's archive DB
const archive = new ArchiveReader(
  cfg.archiveDbPath,
  join(cfg.volumesRoot, cfg.shelfDrive, "Contents"),
);
/** Read-only window into the megadj shelf_sweeps ledger (drive verdicts). */
const shelfSweeps = new ShelfSweepReader(cfg.archiveDbPath);
/** Read-only window into the megadj hygiene_findings ledger (§5 P2). */
const hygiene = new HygieneReader(cfg.archiveDbPath);
// N75: vendor matrix + user-added players from config.toml [players.players]
const extraPlayers = () => playersFromConfig(cfg.extraPlayers);

const clients = new Set<ReadableStreamDefaultController>();
function sse(): Response {
  let controller: ReadableStreamDefaultController;
  // Heartbeat: Bun.serve kills streams idle for 10s, which silently severed
  // event delivery (a job finishing during a quiet period was never seen).
  // A comment ping every 5s keeps every client alive; comments are ignored
  // by EventSource but reset the idle timer.
  const hb = setInterval(() => {
    try {
      controller?.enqueue(new TextEncoder().encode(": hb\n\n"));
    } catch {
      clearInterval(hb);
    }
  }, 5_000);
  const stream = new ReadableStream({
    start(c) {
      controller = c;
      clients.add(c);
    },
    cancel() {
      clearInterval(hb);
      clients.delete(controller); // client disconnected — stop broadcasting to it
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
function emit(channel: string, data: unknown): void {
  const msg = `event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try {
      c.enqueue(new TextEncoder().encode(msg));
    } catch {
      clients.delete(c);
    }
  }
}

const registry = new Registry(cfg, db, emit);
const images = new ImageService(cfg, db, guard);
const jobs = new JobEngine(cfg, db, guard, emit);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Bound once: the extracted handler (drive_job_routes.ts) closes over the
// module-level services via this binding.
const enqueueDriveJobFor = makeEnqueueDriveJob({
  cfg,
  images,
  jobs,
  getDrive: (id) => db.getDrive(id) ?? undefined,
  json,
});

// deliberate, structured writes onto mounted sticks: the CrateDeck photo dir
// (Contents/CrateDeck/photo.<ext>). Everything else stays inside dataDir.
guard.allow(join(cfg.volumesRoot, "*", "Contents", "CrateDeck"));

// boot hygiene: orphan jobs from a dead process, stale scratch
const reaped = db.reapOrphanJobs();
registry.sweepScratch();
if (reaped) console.log(`cratedeck: reaped ${reaped} orphan job(s)`);

const lifecycle = makeServerLifecycle({ cfg, db, registry, images, jobs });
const watcher = watchVolumes(cfg.volumesRoot, lifecycle.reconcile);
await lifecycle.reconcile(); // initial sweep

Bun.serve({
  port: cfg.serverPort,
  hostname: "127.0.0.1", // localhost is the trust boundary
  // 120s: the /fleet/prep route self-fetches the D30 archive sweep (~15s on
  // the real archive, 60s client deadline) — the default 10s idleTimeout
  // killed the outer request mid-handler and the digest died with
  // "request timed out" before the sweep could answer.
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    let response: Response;
    if (path.startsWith("/api/")) {
      response = isTrustedMutationRequest(req)
        ? await apiRequest(req, url)
        : json({ error: "cross-origin mutation refused" }, 403);
      // ---- photo files ------------------------------------------------------
    } else if (path.startsWith("/photos/")) {
      const id = path.slice(8);
      const p = images.photoPath(id);
      response = p
        ? new Response(Bun.file(p))
        : new Response("no photo", { status: 404 });
    } else {
      response = await staticOrSpa(path);
    }
    return withSecurityHeaders(response);
  },
});

// Booth fleet payload + config persistence live in booth_routes.ts
// (file-length guard; the /api/booth/fleet routes call these).
const { boothFleetPayload, parseBoothFleetRequest, writeConfigBoothFleet } =
  await import("./booth_routes");

/** Serve a file that lives ON a mounted drive (drive-image picker previews).
 *  NOTE: was historically unreachable — it sat BELOW the /api/ block, which
 *  always returns, so drive-image previews 404'd. Now a drive subroute. */
function serveDriveImage(url: URL): Response {
  // sub is already decoded by the router; rebuild the volume from the URL.
  const m = url.pathname.match(/^\/api\/drives\/([^/]+)\/drive-image$/u);
  const vol = m?.[1] ? decodeURIComponent(m[1]) : "";
  const rel = url.searchParams.get("rel") ?? "";
  const f = images.driveImageFile(vol, rel);
  if (!f) return new Response("not found", { status: 404 });
  return new Response(Bun.file(f));
}

/** The /api/hygiene family: reader-backed reads + job enqueues + sync
 *  decision writes through megadj's CLI (the engine SSOT). */
const hygieneApi = makeHygieneRoutes({
  reader: hygiene,
  // the A/B compare rail serves audio only from the shelf mount — the
  // mount point (not Contents) since findings reference /Volumes/SHELF1/…
  shelfRoot: `/Volumes/${cfg.shelfDrive}`,
  enqueue: (kind) => {
    const shelf = registry.list().find((d) => d.role === "shelf" && d.mounted);
    if (!shelf)
      throw new Error("shelf drive not mounted — hygiene needs SHELF1");
    return jobs.enqueue(shelf.id, kind, `/Volumes/${shelf.name}`, "web");
  },
  megadjCli: async (args) => {
    const proc = Bun.spawn(["bun", megadjCliPath(cfg.root), ...args], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: cfg.root,
    });
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    return { code, stderr };
  },
  json,
});

/** The /api/fixes family: booth-fix plan cache + job enqueues. The music
 *  dir is the SHELF's Contents (same slot hygiene uses for its volume). */
const fixesMusicDir = (): string => {
  const shelf = registry.list().find((d) => d.role === "shelf" && d.mounted);
  if (!shelf) throw new Error("shelf drive not mounted — fixes needs SHELF1");
  return `/Volumes/${shelf.name}/Contents`;
};
const fixesApi = makeFixesRoutes({
  enqueue: (kind) => {
    return jobs.enqueue(
      registry.list().find((d) => d.role === "shelf" && d.mounted)!.id,
      kind,
      fixesMusicDir(),
      "web",
    );
  },
  json,
});

const fleetRoutes = makeFleetRoutes({ db, cfg, json });

/** Shared deps for the report/preflight/dossier collectors
 *  (report_inputs.ts). Declared before the route factories consume it. */
const reportDeps: ReportDeps = { db, cfg, registry, extraPlayers };

const driveRoutes = makeDriveRoutes({
  db,
  cfg,
  registry,
  images,
  reportDeps,
  extraPlayers,
  enqueueDriveJobFor,
  serveDriveImage,
  photoUpload,
  hygieneBadge: () => hygiene.badge(),
  shelfSweeps,
  json,
});
const { driveListPayload, reportsPayload, driveSubroute } = driveRoutes;

/** Static web + SPA fallback: hashed assets cache forever, index.html
 *  revalidates so new deploys are picked up. */
async function staticOrSpa(path: string): Promise<Response> {
  const file = path === "/" ? "/index.html" : path;
  const f = Bun.file(join(webRoot, file));
  if (await f.exists()) {
    const immutable = /assets\/.*-[A-Za-z0-9_-]+\.(js|css)$/u.test(file);
    return new Response(f, {
      headers: {
        "Cache-Control": immutable
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      },
    });
  }
  return new Response(Bun.file(join(webRoot, "index.html")), {
    headers: { "Cache-Control": "no-cache" },
  }); // SPA fallback
}

/** The /api surface: dispatches to per-family handlers. Kept as one
 *  function per family so any route's behavior has exactly one home. */
async function apiRequest(req: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  const route = path.slice(4); // /drives, /drives/:id/...
  try {
    // deckctl status / deck_status REST twin — one read for the whole
    // front page: interlock + drive list + active jobs. Wire shape is
    // exactly what `deckctl status --json` prints.
    if (route === "/status") {
      return json({
        // same shape as GET /api/interlock + deckctl status --json
        interlock: (() => {
          const lock = jobs.interlock();
          return { rekordbox_running: lock.running, pid: lock.pid };
        })(),
        drives: await driveListPayload(),
        jobs: db.activeJobs(),
      });
    }
    if (route === "/drives") {
      return json(await driveListPayload());
    }
    if (route === "/reports") {
      // batched summaries for the rail: N report fetches → 1 request
      return json(reportsPayload());
    }
    // B12 preflight: the gig-night pass/fail across every mounted drive
    if (route === "/preflight") {
      return json(buildPreflight(allPreflightInputs(reportDeps)));
    }
    // Booth fleet settings: which players the compat gates enforce. GET
    // serves the catalog + current selection; POST persists the selection
    // to config.toml [booth].fleet (atomic rewrite via the tmp+rename in
    // writeConfigBoothFleet) and re-derives the floor server-side.
    if (route === "/booth/fleet" && req.method === "GET") {
      return json(boothFleetPayload(cfg.boothFleet));
    }
    if (route === "/booth/fleet" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch (error) {
        return json(
          {
            error: `invalid JSON body: ${error instanceof Error ? error.message : String(error)}`,
          },
          400,
        );
      }
      let next: string[];
      try {
        next = parseBoothFleetRequest(body);
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : String(error) },
          400,
        );
      }
      writeConfigBoothFleet(cfg.root, next);
      cfg.boothFleet = next;
      return json(boothFleetPayload(next));
    }
    // in-app help SSOT: glossary + job/surface explainers (deckctl/MCP
    // can serve the same wording the UI tooltips use)
    if (route === "/help") {
      return json({
        terms: HELP_TERMS,
        jobs: HELP_JOBS,
        surfaces: HELP_SURFACES,
      });
    }
    const driveMatch = route.match(/^\/drives\/([^/]+)(\/.*)?$/u);
    if (driveMatch?.[1]) {
      const id: string = decodeURIComponent(driveMatch[1]);
      const sub: string | undefined = driveMatch[2];
      const resp = await driveSubroute(req, url, id, sub);
      if (resp) return resp;
      return json({ error: "unknown drive route" }, 404);
    }
    if (route === "/ports") {
      return json(portView(db.allDrives()));
    }
    if (route === "/jobs") {
      const active = url.searchParams.get("active");
      const drive = url.searchParams.get("drive");
      if (drive) return json(db.jobsForDrive(drive, 20, Boolean(active)));
      return json(active ? db.activeJobs() : db.jobsForDrive("*", 50));
    }
    const jobMatch = route.match(/^\/jobs\/([^/]+)(\/cancel)?$/u);
    if (jobMatch?.[1]) {
      const id: string = jobMatch[1];
      const cancel: string | undefined = jobMatch[2];
      if (cancel && req.method === "POST") return json({ ok: jobs.cancel(id) });
      return json(db.getJob(id));
    }
    if (route === "/search") {
      return json(registry.search(url.searchParams.get("q") ?? ""));
    }
    // ---- fleet superpowers (§B6/B7/B8 + O83 prep): one family, one handler
    if (route.startsWith("/fleet/")) return fleetRoutes(route, url);
    // ---- archive reads (O82b): megadj's DB, readonly -----------------
    // Route family lives in archive_routes.ts (file-length guard);
    // null = no archive route matched, fall through.
    const archiveResp = await archiveRoutes(route, url, {
      archive,
      db,
      cfg,
    });
    if (archiveResp) return archiveResp;
    if (route === "/images/search") {
      return json(await images.search(url.searchParams.get("q") ?? ""));
    }
    if (route === "/interlock") {
      const lock = jobs.interlock();
      return json({ rekordbox_running: lock.running, pid: lock.pid });
    }
    // global help: what does each job kind do (human + agent readable)
    if (route === "/help/jobs") {
      return json(VERIFY_HELP); // verify-centric help; per-kind docs live in deckctl explain
    }
    if (route === "/stop" && req.method === "POST") {
      // graceful: stop watcher + jobs, then exit (used by deckctl stop)
      setTimeout(async () => {
        watcher.stop();
        await jobs.shutdown();
        archive.close();
        db.close();
        process.exit(0);
      }, 50);
      return json({ ok: true });
    }
    if (
      (route === "/events" || route === "/events/") &&
      req.headers.get("accept")?.includes("event-stream")
    ) {
      return sse();
    }
    // ---- shelf hygiene (docs/getdat/shelf-hygiene-2026-09-09.md §4) -----------
    if (route === "/hygiene") return hygieneApi.list(url);
    if (route === "/hygiene/scan" && req.method === "POST")
      return hygieneApi.scan();
    if (route === "/hygiene/apply" && req.method === "POST")
      return hygieneApi.apply();
    if (route === "/hygiene/decide" && req.method === "POST")
      return hygieneApi.decide(req);
    if (route === "/hygiene/bucket-confirm" && req.method === "POST")
      return hygieneApi.bucketConfirm(req);
    if (route === "/hygiene/audio") return hygieneApi.audio(url);
    if (route === "/hygiene/stats") return hygieneApi.stats(url);
    // ---- booth fixes (Fleet→Booth fleet drives these checks) -----------
    if (route === "/fixes") return fixesApi.list();
    if (route === "/fixes/scan" && req.method === "POST")
      return fixesApi.scan();
    if (route === "/fixes/apply" && req.method === "POST")
      return fixesApi.apply();
    // ---- archive intake (GetDat Intake tab) -----------------------------
    if (route === "/intake/folders") {
      return json({
        watch: intakeWatchDir(cfg),
        candidates: intakeCandidateDirs(cfg),
      });
    }
    if (route === "/intake/start" && req.method === "POST") {
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
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    const msg = (e as Error).message;
    const status =
      msg.startsWith("REKORDBOX_RUNNING") || msg.startsWith("GUARD VIOLATION")
        ? 423
        : 500;
    return json({ error: msg }, status);
  }
}

console.log(
  `cratedeck: http://127.0.0.1:${cfg.serverPort} (reaped jobs: ${reaped})`,
);

process.on("SIGINT", async () => {
  watcher.stop();
  await jobs.shutdown();
  archive.close();
  db.close();
  process.exit(0);
});
