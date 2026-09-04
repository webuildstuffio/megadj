// index.ts — wire-up: config → db → detector → jobs → HTTP+SSE. 127.0.0.1 only.
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { loadConfig, type CrateConfig } from "./config";
import { DB } from "./db";
import { Guard } from "./guard";
import { listMountedVolumes, watchVolumes } from "./detect";
import { Registry } from "./registry";
import { JobEngine } from "./jobs";
import { ImageService } from "./images";
import { driveBadgesView } from "./badges_view";
import { buildReport, buildReportSummary, overall } from "./report";
import type { Drive, JobKind, SnapshotData } from "../shared/types";

const here = import.meta.dir.replace(/\/src$/, ""); // .../cratedeck
const cfg = loadConfig(here);
const db = new DB(cfg.dbPath);
const guard = new Guard(cfg);
const webRoot = join(here, "web", "dist");

const clients = new Set<ReadableStreamDefaultController>();
function sse(): Response {
  let controller: ReadableStreamDefaultController;
  const stream = new ReadableStream({
    start(c) {
      controller = c;
      clients.add(c);
    },
    cancel() {
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
  } catch (e) {
    console.error("reconcile:", (e as Error).message);
  } finally {
    reconciling = false;
  }
}
const watcher = watchVolumes(cfg.volumesRoot, reconcile);
await reconcile(); // initial sweep

Bun.serve({
  port: cfg.serverPort,
  hostname: "127.0.0.1", // localhost is the trust boundary
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // ---- API -------------------------------------------------------------
    if (path.startsWith("/api/")) {
      const route = path.slice(4); // /drives, /drives/:id/...
      try {
        if (route === "/drives") {
          const snaps = db.latestSnapshots();
          return json(
            registry
              .list()
              .map((d) => ({
                ...d,
                // strip the raw snapshot blob from list responses: cards only
                // need counts; the full snapshot goes MBs over the wire for
                // nothing. Page detail fetches it on demand.
                last_snapshot_json: null as string | null,
                snapshot_summary: (() => {
                  const s = snaps.get(d.id);
                  return s
                    ? {
                        track_count: s.track_count,
                        file_count: s.file_count,
                        capacity_bytes: s.capacity_bytes,
                        free_bytes: s.free_bytes,
                      }
                    : null;
                })(),
                badges: [
                  ...driveBadgesView(
                    db,
                    d,
                    snaps,
                    cfg.masterDrive,
                    cfg.mirrorDrive,
                  ),
                ],
              }))
              .map((d) => ({ ...d, last_snapshot_json: null })),
          );
        }
        if (route === "/reports") {
          // batched summaries for the rail: N report fetches → 1 request
          return json(
            Object.fromEntries(
              registry.list().map((d) => {
                const r = buildReport(reportInput(d.id));
                return [d.id, buildReportSummary(r.checks)];
              }),
            ),
          );
        }
        const driveMatch = route.match(/^\/drives\/([^/]+)(\/.*)?$/);
        if (driveMatch?.[1]) {
          // clients percent-encode fingerprint ids (fp%3A…); pathname keeps
          // the encoding, so decode before DB lookups
          const id: string = decodeURIComponent(driveMatch[1]);
          const sub: string | undefined = driveMatch[2];
          if (!sub) {
            const d = registry.detail(id);
            if (!d) return json({ error: "unknown drive" }, 404);
            return json(d);
          }
          if (sub === "/timeline") return json(db.timeline(id));
          if (sub === "/export") return exportDossier(id);
          if (sub === "/report") {
            if (!db.getDrive(id)) return json({ error: "unknown drive" }, 404);
            const report = buildReport(reportInput(id));
            return json({ ...report, overall: overall(report.checks) });
          }
          if (sub === "/photo" && req.method === "POST") {
            const body = (await req.json()) as {
              url?: string;
              localPath?: string;
              clear?: boolean;
            };
            if (body.clear) {
              images.clear(id);
              return json({ ok: true, cleared: true });
            }
            const dest = await images.choose(id, body);
            return json({ ok: true, path: dest });
          }
          if (sub === "/name" && req.method === "POST") {
            const body = (await req.json()) as { nickname: string | null };
            registry.rename(id, body.nickname);
            return json({ ok: true });
          }
          if (sub === "/jobs" && req.method === "POST") {
            const body = (await req.json()) as { kind: JobKind };
            if (
              !["scan", "verify", "mirror", "benchmark", "checksum"].includes(
                body.kind,
              )
            ) {
              return json({ error: "bad kind" }, 400);
            }
            const drive = db.getDrive(id);
            if (!drive?.mounted)
              return json({ error: "drive not mounted" }, 409);
            const mountPoint = resolveMountPoint(cfg, drive.name);
            const job = jobs.enqueue(id, body.kind, mountPoint);
            return json(job);
          }
          if (sub === "/benchmarks") return json(db.benchmarks(id));
        }
        if (route === "/ports") {
          return json(portView());
        }
        if (route === "/jobs") {
          const active = url.searchParams.get("active");
          const drive = url.searchParams.get("drive");
          if (drive) return json(db.jobsForDrive(drive, 20));
          return json(active ? db.activeJobs() : db.jobsForDrive("*", 50));
        }
        const jobMatch = route.match(/^\/jobs\/([^/]+)(\/cancel)?$/);
        if (jobMatch?.[1]) {
          const id: string = jobMatch[1];
          const cancel: string | undefined = jobMatch[2];
          if (cancel && req.method === "POST")
            return json({ ok: jobs.cancel(id) });
          return json(db.getJob(id));
        }
        if (route === "/search") {
          return json(registry.search(url.searchParams.get("q") ?? ""));
        }
        if (route === "/images/search") {
          return json(await images.search(url.searchParams.get("q") ?? ""));
        }
        if (route === "/interlock") {
          const lock = jobs.interlock();
          return json({ rekordbox_running: lock.running, pid: lock.pid });
        }
        if (route === "/stop" && req.method === "POST") {
          // graceful: stop watcher + jobs, then exit (used by deckctl stop)
          setTimeout(async () => {
            watcher.stop();
            await jobs.shutdown();
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
        return json({ error: "not found" }, 404);
      } catch (e) {
        const msg = (e as Error).message;
        const status =
          msg.startsWith("REKORDBOX_RUNNING") ||
          msg.startsWith("GUARD VIOLATION")
            ? 423
            : 500;
        return json({ error: msg }, status);
      }
    }

    // ---- photo files ------------------------------------------------------
    if (path.startsWith("/photos/")) {
      const id = path.slice(8);
      const p = images.photoPath(id);
      if (!p) return new Response("no photo", { status: 404 });
      return new Response(Bun.file(p));
    }

    // ---- static web -------------------------------------------------------
    const file = path === "/" ? "/index.html" : path;
    const f = Bun.file(join(webRoot, file));
    if (await f.exists()) return new Response(f);
    return new Response(Bun.file(join(webRoot, "index.html"))); // SPA fallback
  },
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Where a drive's volume is mounted. Respects CRATEDECK_VOLUMES/config
 *  volumesRoot (tests, fixtures, non-standard hosts) instead of assuming
 *  /Volumes — and verifies the directory is really there right now. */
function resolveMountPoint(cfg: CrateConfig, volumeName: string): string {
  const candidate = join(cfg.volumesRoot, volumeName);
  try {
    readdirSync(candidate); // mounted + readable at this instant
    return candidate;
  } catch {
    throw new Error(`drive volume not mounted at ${candidate}`);
  }
}

function portView() {
  return db
    .allDrives()
    .filter((d) => d.last_port_key)
    .map((d) => ({
      port_key: d.last_port_key,
      label: null,
      drive_id: d.id,
      drive_name: d.nickname ?? d.name,
      mounted: !!d.mounted,
      last_seen_at: d.last_seen_at,
    }));
}

function exportDossier(driveId: string): Response {
  const detail = registry.detail(driveId);
  if (!detail) return json({ error: "unknown drive" }, 404);
  const dossier = {
    exported_at: new Date().toISOString(),
    drive: { ...detail.drive, last_snapshot_json: undefined },
    snapshot: detail.snapshot,
    sync: detail.sync,
    report: buildReport(reportInput(driveId)),
    timeline: db.timeline(driveId, 500),
    benchmarks: db.benchmarks(driveId),
  };
  return new Response(JSON.stringify(dossier, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="cratedeck-${detail.drive.name}.json"`,
    },
  });
}

/** Assemble DB state for the report builder. */
function reportInput(driveId: string) {
  const drive = db.getDrive(driveId);
  if (!drive) throw new Error("unknown drive");
  const snap: SnapshotData | null = drive.last_snapshot_json
    ? JSON.parse(drive.last_snapshot_json)
    : null;
  const master = db.masterDrive();
  const masterSnap: SnapshotData | null = master?.last_snapshot_json
    ? JSON.parse(master.last_snapshot_json)
    : null;
  const isMirror =
    drive.role === "mirror" ||
    drive.name.toUpperCase() === cfg.mirrorDrive.toUpperCase();
  // capacity: prefer live value; falls back to snapshot
  const withCap: Drive = {
    ...drive,
    capacity_bytes: drive.capacity_bytes || snap?.capacity_bytes || 0,
  };
  if (snap && !snap.capacity_bytes && drive.capacity_bytes)
    snap.capacity_bytes = drive.capacity_bytes;
  return {
    drive: withCap,
    snapshot: snap,
    latestVerify: db.latestVerify(driveId),
    bench: db.benchmarks(driveId),
    ledgerFiles: db.ledgerCount(driveId),
    ledgerStaleDays: db.ledgerAgeDays(driveId),
    masterSnapshot: masterSnap,
    masterName: master ? (master.nickname ?? master.name) : cfg.masterDrive,
    isMirror,
    // real verdict from the newest finished checksum job (null = never run)
    latestChecksum: db.latestChecksum(driveId),
  };
}

console.log(
  `cratedeck: http://127.0.0.1:${cfg.serverPort} (reaped jobs: ${reaped})`,
);

process.on("SIGINT", async () => {
  watcher.stop();
  await jobs.shutdown();
  db.close();
  process.exit(0);
});
