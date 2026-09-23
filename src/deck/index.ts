// index.ts — wire-up: config → db → detector → jobs → HTTP+SSE. 127.0.0.1 only.
// Route families live in their own modules (complexity hot-spot split, #42):
// fleet_routes.ts, drive_routes.ts, archive_routes.ts, and now the inline
// families too (api_routes.ts). This file keeps ONLY bootstrap, service
// construction, and the listen call.
import { join } from "node:path";
import { loadConfig } from "./config";
import { DB } from "./db";
import { Guard } from "./server/guard";
import { watchVolumes } from "./detect/detect";
import { Registry } from "./registry";
import { JobEngine } from "./jobs/engine";
import { ImageService } from "./image/store";
import { ShelfSweepReader } from "./tools/shelf-sweep-reader";
import { HygieneReader } from "./hygiene/reader";
import { DumpReader } from "./tools/dump-reader";
import { makeHygieneRoutes } from "./hygiene/routes";
import { makeFixesRoutes } from "./fixes/routes";
import { makeGridHealthRoutes } from "./grid/routes";
import { ArchiveReader } from "./db/reader";
import { type ReportDeps } from "./report/inputs";
import { playersFromConfig } from "./players";
import { megadjCliPath } from "./jobs/intake-run";
import {
  isTrustedMutationRequest,
  withSecurityHeaders,
} from "./server/http-security";
import { makeServerLifecycle } from "./server/server-lifecycle";
import { makeFleetRoutes } from "./fleet/routes";
import { makeDriveRoutes } from "./drive/routes";
import { makeApiRouter } from "./api/routes";
import { photoUpload, makeEnqueueDriveJob } from "./drive/job-routes";

// import.meta.dir of src/deck/index.ts IS the deck root (the config.toml
// home). Fossil guard: this used to be cratedeck/src/ (one level deeper)
// and a `/src`-strip was needed; after the Sep 2026 fold into src/deck/ a
// strip lands on <repo>/src where no config.toml exists — the server then
// boots on defaults, silently ignoring the user's real config.
const here = import.meta.dir;
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
/** Read-only window into the intake_dumps ledger (#20: one dump = one
 *  dated batch folder, written by ingest itself). */
const dumpReader = new DumpReader(cfg.archiveDbPath);
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
      // Flush headers+first byte NOW (standard SSE hello). Without this, Bun
      // defers the response until the first event or the 5s heartbeat, so
      // fetch-based clients (and the e2e suite) hang on connect whenever no
      // job happens to emit in that window (Sep 2026: deterministic 5s hang
      // once the verify path actually worked and jobs stopped failing fast).
      c.enqueue(new TextEncoder().encode(": connected\n\n"));
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
  return Response.json(data, {
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
if (reaped) console.log(`deck: reaped ${reaped} orphan job(s)`);

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

// Booth fleet payload + config persistence now live in booth_routes.ts and
// are imported by api_routes.ts directly (the route handlers moved there).

/** Serve a file that lives ON a mounted drive (drive-image picker previews).
 *  NOTE: was historically unreachable — it sat BELOW the /api/ block, which
 *  always returns, so drive-image previews 404'd. Now a drive subroute. */
/** The ONE megadj-CLI spawn-and-collect seam for this module (#316:
 *  the megadjCli deps arms and the quarantine census each hand-rolled
 *  the Bun.spawn + stderr/exit wrapper). */
async function spawnMegadjCli(
  root: string,
  args: string[],
): Promise<{ code: number; stderr: string; stdout: string }> {
  const proc = Bun.spawn(["bun", megadjCliPath(root), ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: root,
  });
  const [stderr, stdout] = await Promise.all([
    new Response(proc.stderr).text(),
    new Response(proc.stdout).text(),
  ]);
  const code = await proc.exited;
  return { code, stderr, stdout };
}

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
    return spawnMegadjCli(cfg.root, args);
  },
  // quarantine census (#36): the engine (megadj CLI) owns the layout
  // math — index.ts just binds the call; stdout is the one JSON object.
  quarantineCensus: async () => {
    const { code, stdout, stderr } = await spawnMegadjCli(cfg.root, [
      "shelf-quarantine",
      "--json",
    ]);
    if (code !== 0)
      return {
        files: 0,
        bytes: 0,
        stale: 0,
        error: stderr.slice(-300) || `shelf-quarantine exit ${code}`,
      };
    try {
      const parsed = JSON.parse(stdout.trimEnd()) as {
        files?: number;
        bytes?: number;
        stale?: number;
      };
      return {
        files: parsed.files ?? 0,
        bytes: parsed.bytes ?? 0,
        stale: parsed.stale ?? 0,
      };
    } catch {
      return {
        files: 0,
        bytes: 0,
        stale: 0,
        error: "shelf-quarantine printed no JSON summary",
      };
    }
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
  enqueue: (kind) =>
    jobs.enqueue(
      registry.list().find((d) => d.role === "shelf" && d.mounted)!.id,
      kind,
      fixesMusicDir(),
      "web",
    ),
  json,
});

/** The /api/grid-health family (GA-05c, #167): triage runs live on the
 *  SHELF drive's row (the master DB it reads), like fixes/hygiene. */
const gridHealthApi = makeGridHealthRoutes({
  enqueue: (driveId) => {
    const shelf = registry.list().find((d) => d.role === "shelf" && d.mounted);
    if (!shelf)
      throw new Error("shelf drive not mounted — grid health needs SHELF1");
    return jobs.enqueue(
      driveId,
      "grid-health",
      `/Volumes/${shelf.name}`,
      "web",
    );
  },
  json,
  resolveDrive: (nameOrId) => {
    const d = db.getDriveByUuid(nameOrId) ?? db.getDrive(nameOrId);
    if (d) return { id: d.id, name: d.nickname ?? d.name };
    const byName = registry
      .list()
      .find(
        (x) => x.name === nameOrId || (x.nickname && x.nickname === nameOrId),
      );
    return byName
      ? { id: byName.id, name: byName.nickname ?? byName.name }
      : null;
  },
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

/** The /api surface: a linear first-match router over the per-family
 *  slices (#42). Route behavior lives in api_routes.ts; this file keeps
 *  bootstrap + service construction only. The REKORDBOX_RUNNING/GUARD
 *  VIOLATION → 423 mapping is the one cross-family concern kept here. */
const apiRouter = makeApiRouter({
  cfg,
  db,
  registry,
  jobs,
  images,
  archive,
  reportDeps,
  dumpReader,
  hygieneApi,
  fixesApi,
  gridHealthApi,
  driveListPayload,
  reportsPayload,
  driveSubroute,
  fleetRoutes,
  json,
  sse,
  megadjCli: async (args) => {
    return spawnMegadjCli(cfg.root, args);
  },
  stopServer: () => {
    watcher.stop();
    void jobs.shutdown();
    archive.close();
    db.close();
    process.exit(0);
  },
});

async function apiRequest(req: Request, url: URL): Promise<Response> {
  const route = url.pathname.slice(4); // /drives, /drives/:id/...
  try {
    return await apiRouter(req, url, route);
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
  `deck: http://127.0.0.1:${cfg.serverPort} (reaped jobs: ${reaped})`,
);

process.on("SIGINT", async () => {
  watcher.stop();
  await jobs.shutdown();
  archive.close();
  db.close();
  process.exit(0);
});
