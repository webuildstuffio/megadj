// index.ts — wire-up: config → db → detector → jobs → HTTP+SSE. 127.0.0.1 only.
import { join } from "node:path";
import { loadConfig } from "./config";
import { DB } from "./db";
import { Guard } from "./guard";
import { listMountedVolumes, watchVolumes } from "./detect";
import { freeBytes } from "./scan";
import { Registry } from "./registry";
import { JobEngine } from "./jobs";
import { ImageService } from "./images";
import { driveBadgesView } from "./badges_view";
import { ShelfSweepReader } from "./shelf_sweep_reader";
import { HygieneReader } from "./hygiene_reader";
import { makeHygieneRoutes } from "./hygiene_routes";
import { makeFixesRoutes } from "./fixes_routes";
import { parseSnapshotJson } from "../shared/badges";
import { buildReport, buildReportSummary, overall } from "./report";
import { VERIFY_HELP } from "./verify_help";
import { HELP_TERMS, HELP_JOBS, HELP_SURFACES } from "../shared/help";
import { coverage, redundancy, diff, trackLocations } from "./coverage";
import { fetchWeeklyPrepInput, renderWeeklyPrep } from "./weekly_prep";
import { ArchiveReader } from "./archive";
import { archiveRoutes } from "./archive_routes";
import {
  allPreflightInputs,
  exportDossier,
  reportInput,
  type ReportDeps,
} from "./report_inputs";
import { buildPreflight } from "./preflight";
import { driveCompatibility, playersFromConfig } from "./players";
import {
  normalizeNote,
  addAgentNote,
  dismissAgentNote,
  agentNotes,
} from "./notes";
import {
  shouldAutoScan,
  shouldAutoVerify,
  autoVerifyReason,
} from "./auto_schedule";
import {
  intakeCandidateDirs,
  intakeWatchDir,
  megadjCliPath,
} from "./intake_run";
import type { Drive, NoteSeverity } from "../shared/types";

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
const archive = new ArchiveReader(cfg.archiveDbPath);
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

let reconciling = false;
async function reconcile(): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    registry.reconcile(await listMountedVolumes(cfg.volumesRoot));
    await photoMountResync();
    autoSchedule();
  } catch (e) {
    console.error("reconcile:", (e as Error).message);
  } finally {
    reconciling = false;
  }
}

/** ideas.md §C17: on mount → light scan automatically; stale verify → auto
 *  verify weekly. Decisions in auto_schedule.ts (pure, tested); this only
 *  resolves inputs and enqueues. All job-engine guards (dedupe, interlock,
 *  per-drive concurrency) still apply on top. */
function autoSchedule(): void {
  const now = Date.now();
  // 1 — mount-triggered light scan
  if (registry.justMountedIds.size) {
    const snaps = db.latestSnapshots();
    for (const id of registry.justMountedIds) {
      const drive = db.getDrive(id);
      if (!drive?.mounted) continue;
      const snap = snaps.get(id);
      const hasFresh = Boolean(snap?.taken_at) && now - snap!.taken_at < 60_000;
      if (
        shouldAutoScan(
          { mounted: true, justMounted: true, hasFreshSnapshot: hasFresh },
          cfg.autoScanOnMount,
        )
      ) {
        const j = jobs.enqueue(id, "scan", mountPointOf(drive.name), "auto");
        console.log(`cratedeck: auto-scan ${drive.name} (${j.id.slice(0, 8)})`);
      }
    }
    registry.justMountedIds.clear();
  }
  // 2 — weekly auto-verify for mounted drives (checked every sweep; cheap)
  if (cfg.verifyIntervalDays > 0) {
    for (const drive of db.allDrives()) {
      if (!drive.mounted) continue;
      if (db.activeJobOfKind(drive.id, "verify")) continue;
      const last = db.latestVerify(drive.id);
      const input = {
        mounted: true,
        lastVerifyAt: last?.ran_at ?? null,
        hasActiveJob: Boolean(db.activeJobOfKind(drive.id, "scan")),
        now,
      };
      if (shouldAutoVerify(input, cfg.verifyIntervalDays)) {
        // one shot per server boot per drive: mark by enqueueing (dedupe)
        // and remembering the decision so a failed verify doesn't loop
        const lastAttempt = autoVerifyAttempts.get(drive.id) ?? 0;
        if (now - lastAttempt < 3_600_000) continue; // max 1 attempt/hour
        autoVerifyAttempts.set(drive.id, now);
        const reason = autoVerifyReason(input, cfg.verifyIntervalDays);
        const j = jobs.enqueue(
          drive.id,
          "verify",
          mountPointOf(drive.name),
          "auto",
        );
        console.log(
          `cratedeck: auto-verify ${drive.name} (${j.id.slice(0, 8)}) — ${reason}`,
        );
      }
    }
  }
}

function mountPointOf(driveName: string): string {
  return `${cfg.volumesRoot}/${driveName}`;
}

/** Drive-photo re-sync at mount time: every reconcile sweep, for each mounted
 *  drive, make local copy and stick copy agree (cheap no-op when they do —
 *  extension+size check, no hashing). Failures log, never break the sweep. */
async function photoMountResync(): Promise<void> {
  for (const d of db.allDrives()) {
    if (!d.mounted) continue;
    try {
      await images.syncOnMount(d.id);
    } catch (e) {
      console.error(`photo mount re-sync failed for ${d.name}`, e);
    }
  }
}

const autoVerifyAttempts = new Map<string, number>();
const watcher = watchVolumes(cfg.volumesRoot, reconcile);
await reconcile(); // initial sweep

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
    if (path.startsWith("/api/")) return apiRequest(req, url);
    // ---- photo files ------------------------------------------------------
    if (path.startsWith("/photos/")) {
      const id = path.slice(8);
      const p = images.photoPath(id);
      if (!p) return new Response("no photo", { status: 404 });
      return new Response(Bun.file(p));
    }
    return staticOrSpa(path);
  },
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Booth fleet payload + config persistence live in booth_routes.ts
// (file-length guard; the /api/booth/fleet routes call these).
import { photoUpload, makeEnqueueDriveJob } from "./drive_job_routes";

const { boothFleetPayload, writeConfigBoothFleet, normalizeFleetSelection } =
  await import("./booth_routes");

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

/** ---- /api router: one handler per route family -------------------------- */

/** Serve a file that lives ON a mounted drive (drive-image picker previews).
 *  NOTE: was historically unreachable — it sat BELOW the /api/ block, which
 *  always returns, so drive-image previews 404'd. Now a drive subroute. */
function serveDriveImage(url: URL): Response {
  // sub is already decoded by the router; rebuild the volume from the URL.
  const m = url.pathname.match(/^\/api\/drives\/([^/]+)\/drive-image$/);
  const vol = m?.[1] ? decodeURIComponent(m[1]) : "";
  const rel = url.searchParams.get("rel") ?? "";
  const f = images.driveImageFile(vol, rel);
  if (!f) return new Response("not found", { status: 404 });
  return new Response(Bun.file(f));
}

/** Static web + SPA fallback: hashed assets cache forever, index.html
 *  revalidates so new deploys are picked up. */
async function staticOrSpa(path: string): Promise<Response> {
  const file = path === "/" ? "/index.html" : path;
  const f = Bun.file(join(webRoot, file));
  if (await f.exists()) {
    const immutable = /assets\/.*-[A-Za-z0-9_-]+\.(js|css)$/.test(file);
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
      return json(
        Object.fromEntries(
          registry.list().map((d) => {
            const r = buildReport(reportInput(reportDeps, d.id));
            return [d.id, buildReportSummary(r.checks)];
          }),
        ),
      );
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
      const body = (await req.json().catch(() => null)) as {
        selected?: unknown;
      } | null;
      const ids = Array.isArray(body?.selected)
        ? (body!.selected as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [];
      const next = normalizeFleetSelection(ids);
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
    const driveMatch = route.match(/^\/drives\/([^/]+)(\/.*)?$/);
    if (driveMatch?.[1]) {
      const id: string = decodeURIComponent(driveMatch[1]);
      const sub: string | undefined = driveMatch[2];
      const resp = await driveSubroute(req, url, id, sub);
      if (resp) return resp;
      return json({ error: "unknown drive route" }, 404);
    }
    if (route === "/ports") {
      return json(portView());
    }
    if (route === "/jobs") {
      const active = url.searchParams.get("active");
      const drive = url.searchParams.get("drive");
      if (drive) return json(db.jobsForDrive(drive, 20, Boolean(active)));
      return json(active ? db.activeJobs() : db.jobsForDrive("*", 50));
    }
    const jobMatch = route.match(/^\/jobs\/([^/]+)(\/cancel)?$/);
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
    // ---- shelf hygiene (docs/shelf-hygiene-2026-09-09.md §4) -----------
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

/** Per-drive subroutes under /api/drives/:id/* — returns null when no
 *  subroute matched so the router can 404 honestly. */
async function driveSubroute(
  req: Request,
  url: URL,
  id: string,
  sub: string | undefined,
): Promise<Response | null> {
  if (!sub) {
    const d = registry.detail(id);
    if (!d) return json({ error: "unknown drive" }, 404);
    return json(d);
  }
  if (sub === "/timeline") return json(db.timeline(id));
  // O88: agent findings feed — active notes as JSON + write/dismiss.
  // Logic lives in notes.ts; db exposes the raw rows it needs.
  if (sub === "/notes" && req.method === "GET") return json(agentNotes(db, id));
  if (sub === "/notes" && req.method === "POST") {
    if (!db.getDrive(id)) return json({ error: "unknown drive" }, 404);
    // malformed JSON → 400 (client error), not the outer 500 catch
    let body: {
      note?: string;
      origin?: string;
      severity?: NoteSeverity;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
    // normalizeNote throws a clean message on empty/oversized input;
    // map validation errors to 400 explicitly here
    let v: ReturnType<typeof normalizeNote>;
    try {
      v = normalizeNote({
        drive_id: id,
        note: body.note ?? "",
        origin: body.origin,
        severity: body.severity,
      });
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
    const noteId = addAgentNote(db, v);
    // O88: return the event id — deck_note / deckctl note --json
    // promise {id} so callers can cite or dismiss the note later
    return json({ ok: true, id: noteId });
  }
  const noteMatch = sub.match(/^\/notes\/([^/]+)\/dismiss$/);
  if (noteMatch?.[1] && req.method === "POST") {
    const ok = dismissAgentNote(db, id, noteMatch[1]);
    return ok ? json({ ok: true }) : json({ error: "note not found" }, 404);
  }
  if (sub === "/export") {
    const dossier = exportDossier(reportDeps, id);
    if (!dossier) return json({ error: "unknown drive" }, 404);
    return dossier;
  }
  if (sub === "/report") {
    if (!db.getDrive(id)) return json({ error: "unknown drive" }, 404);
    const report = buildReport(reportInput(reportDeps, id));
    return json({ ...report, overall: overall(report.checks) });
  }
  // latest granular verify report (per-check pass/fail + meanings)
  if (sub === "/verify") {
    if (!db.getDrive(id)) return json({ error: "unknown drive" }, 404);
    // null (not a stub) — the web tab renders a "never verified"
    // state for null; a {ran_at:null} stub crashed `.checks.filter`.
    return json(db.getVerifyReport(id));
  }
  if (sub === "/verify/help") {
    return json(VERIFY_HELP);
  }
  if (sub === "/photo" && req.method === "POST") {
    return photoUpload(req, id, images, json);
  }
  // images already ON this drive (Contents/CrateDeck + volume root)
  if (sub === "/drive-images") {
    const drive = db.getDrive(id);
    if (!drive) return json({ error: "unknown drive" }, 404);
    if (!drive.mounted) return json({ error: "drive not mounted" }, 409);
    return json(await images.listDriveImages(drive.name));
  }
  if (sub === "/name" && req.method === "POST") {
    const body = (await req.json()) as { nickname: string | null };
    registry.rename(id, body.nickname);
    return json({ ok: true });
  }
  if (sub === "/jobs" && req.method === "POST") {
    return enqueueDriveJobFor(req, id);
  }
  if (sub === "/benchmarks") return json(db.benchmarks(id));
  if (sub === "/speedprobes") return json(db.speedProbes(id));
  // File ON the drive (drive-image picker preview; was unreachable when it
  // lived below the /api/ block — see serveDriveImage comment).
  if (sub === "/drive-image") {
    return serveDriveImage(url);
  }
  // N78: "which players will this stick actually work on?" —
  // measured dual-DB rows mapped onto the vendor player matrix
  if (sub === "/players") {
    const drive = db.getDrive(id);
    if (!drive) return json({ error: "unknown drive" }, 404);
    // parseSnapshotJson: a corrupt blob must surface in the response, not
    // 500 the route (same crash class driveBadges had).
    const { snap, corrupt } = parseSnapshotJson(drive.last_snapshot_json);
    if (corrupt) return json({ error: "snapshot corrupt — run a scan" }, 409);
    const compat = driveCompatibility(snap, extraPlayers());
    return json({
      drive: {
        id: drive.id,
        name: drive.name,
        nickname: drive.nickname,
      },
      measured: {
        pdb_live_rows: snap?.pdb_live_rows ?? null,
        onelibrary_rows: snap?.onelibrary_rows ?? null,
      },
      ...compat,
    });
  }
  return null;
}

/** POST /api/drives/:id/photo — multipart upload or JSON url/localPath/clear. */
/** GET /api/drives + GET /api/status payload: the drive cards minus the MBs
 *  snapshot blob (page detail fetches it on demand). One builder so the two
 *  routes can never drift. */
function portView() {
  return db
    .allDrives()
    .filter((d) => d.last_port_key)
    .map((d) => ({
      port_key: d.last_port_key,
      label: null,
      drive_id: d.id,
      drive_name: d.nickname ?? d.name,
      mounted: Boolean(d.mounted),
      last_seen_at: d.last_seen_at,
    }));
}
function driveNames(): Map<string, string> {
  return new Map(db.allDrives().map((d) => [d.id, d.nickname ?? d.name]));
}

async function fleetRoutes(route: string, url: URL): Promise<Response> {
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
}

async function driveListPayload(): Promise<Drive[]> {
  const snaps = db.latestSnapshots();
  const sweeps = shelfSweeps.latestPerDrive();
  const drives = registry.list();
  // one live `df` per MOUNTED drive: the rail shows "free of total", and a
  // snapshot's free_bytes goes stale the moment anything writes to the disk
  // (SHELF1's snapshot had no free_bytes at all → "4.0 TB" with no floor).
  // Runs in parallel; df failure → null → UI falls back to snapshot truth.
  const liveFree = new Map(
    await Promise.all(
      drives
        .filter((d) => d.mounted)
        .map(async (d) => {
          const mountPoint = `/Volumes/${d.name}`;
          try {
            return [d.id, await freeBytes(mountPoint)] as const;
          } catch (e) {
            // a df that throws (volume yanked mid-request) is a logged
            // boundary, not a payload-killer
            console.error(`live free-space probe failed for ${d.name}`, e);
            return [d.id, null] as const;
          }
        }),
    ),
  );
  return drives
    .map((d) => ({
      ...d,
      // strip the raw snapshot blob from list responses: cards only need
      // counts; the full snapshot goes MBs over the wire for nothing.
      last_snapshot_json: null as string | null,
      snapshot_summary: (() => {
        const s = snaps.get(d.id);
        return s
          ? {
              track_count: s.track_count,
              file_count: s.file_count,
              capacity_bytes: s.capacity_bytes,
              free_bytes: s.free_bytes,
              live_free_bytes: d.mounted ? (liveFree.get(d.id) ?? null) : null,
            }
          : {
              // never-scanned mounted drive: still show live free space
              capacity_bytes: d.capacity_bytes || undefined,
              free_bytes: null,
              live_free_bytes: d.mounted ? (liveFree.get(d.id) ?? null) : null,
            };
      })(),
      badges: [
        ...driveBadgesView(db, d, snaps, cfg.masterDrive, cfg.mirrorDrive),
      ],
    }))
    .map((d) => ({
      ...d,
      last_snapshot_json: null,
      shelf_sweep: sweeps.get(d.name.toUpperCase()) ?? null,
      // hygiene census rides only the shelf drive (§4.3: the badge that
      // opens the queue); null elsewhere so cards don't render it
      hygiene:
        d.role === "shelf" &&
        d.name.toUpperCase() === cfg.shelfDrive.toUpperCase()
          ? hygiene.badge()
          : null,
    }));
}

/** Shared deps for the report/preflight/dossier collectors
 *  (report_inputs.ts). */
const reportDeps: ReportDeps = { db, cfg, registry, extraPlayers };

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
