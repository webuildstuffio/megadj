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
import { VERIFY_HELP } from "./verify_help";
import { coverage, redundancy, diff, trackLocations } from "./fleet";
import { ArchiveReader } from "./archive";
import { buildPreflight, type PreflightInput } from "./preflight";
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
import type { Drive, JobKind, SnapshotData } from "../shared/types";

const here = import.meta.dir.replace(/\/src$/, ""); // .../cratedeck
const cfg = loadConfig(here);
const db = new DB(cfg.dbPath);
// role inference must compare against the CONFIGURED volume names, not the
// DJMASTER/DJMIRROR doc defaults (custom library.master_drive setups would
// otherwise get role "unknown" and silently lose parity checks + badges)
db.masterName = cfg.masterDrive;
db.mirrorName = cfg.mirrorDrive;
const guard = new Guard(cfg);
const webRoot = join(here, "web", "dist");
// O82b archive tools: one shared readonly handle over megadj's archive DB
const archive = new ArchiveReader(cfg.archiveDbPath);
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
      const hasFresh = !!snap?.taken_at && now - snap.taken_at < 60_000;
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
        hasActiveJob: !!db.activeJobOfKind(drive.id, "scan"),
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
const autoVerifyAttempts = new Map<string, number>();
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
        // B12 preflight: the gig-night pass/fail across every mounted drive
        if (route === "/preflight") {
          return json(buildPreflight(allPreflightInputs()));
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
          // O88: agent findings feed — active notes as JSON + write/dismiss.
          // Logic lives in notes.ts; db exposes the raw rows it needs.
          if (sub === "/notes" && req.method === "GET")
            return json(agentNotes(db, id));
          if (sub === "/notes" && req.method === "POST") {
            if (!db.getDrive(id)) return json({ error: "unknown drive" }, 404);
            // malformed JSON → 400 (client error), not the outer 500 catch
            let body: {
              note?: string;
              origin?: string;
              severity?: "info" | "warn" | "critical";
            };
            try {
              body = (await req.json()) as typeof body;
            } catch {
              return json({ error: "invalid JSON body" }, 400);
            }
            // normalizeNote throws a clean message on empty/oversized input;
            // map validation errors to 400 explicitly here
            let v;
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
            addAgentNote(db, v);
            return json({ ok: true });
          }
          const noteMatch = sub?.match(/^\/notes\/([^/]+)\/dismiss$/);
          if (noteMatch?.[1] && req.method === "POST") {
            const ok = dismissAgentNote(db, id, noteMatch[1]);
            return ok
              ? json({ ok: true })
              : json({ error: "note not found" }, 404);
          }
          if (sub === "/export") return exportDossier(id);
          if (sub === "/report") {
            if (!db.getDrive(id)) return json({ error: "unknown drive" }, 404);
            const report = buildReport(reportInput(id));
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
            const body = (await req.json()) as {
              kind: JobKind;
              origin?: string;
            };
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
            // O87: callers may attribute the job ("mcp:xxxx", "deckctl").
            // Sanitized to a short flat tag — it lands in JSON + UI labels.
            const origin =
              typeof body.origin === "string" && body.origin.trim()
                ? body.origin
                    .trim()
                    .slice(0, 40)
                    .replace(/[^\w:.-]/g, "")
                : "web";
            const job = jobs.enqueue(id, body.kind, mountPoint, origin);
            return json(job);
          }
          if (sub === "/benchmarks") return json(db.benchmarks(id));
          // N78: "which players will this stick actually work on?" —
          // measured dual-DB rows mapped onto the vendor player matrix
          if (sub === "/players") {
            const drive = db.getDrive(id);
            if (!drive) return json({ error: "unknown drive" }, 404);
            const snap: SnapshotData | null = drive.last_snapshot_json
              ? JSON.parse(drive.last_snapshot_json)
              : null;
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
        }
        if (route === "/ports") {
          return json(portView());
        }
        if (route === "/jobs") {
          const active = url.searchParams.get("active");
          const drive = url.searchParams.get("drive");
          if (drive) return json(db.jobsForDrive(drive, 20, !!active));
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
        // ---- fleet superpowers (§B6 coverage / §B7 redundancy / §B8 diff) --
        // Pure reads over fleet tables (refreshed by scans). Drive names in
        // responses are display labels resolved here, once.
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
                    mounted: !!db.getDrive(id)?.mounted,
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
          if (!a || !b)
            return json({ error: "a and b drive ids required" }, 400);
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
        // ---- archive reads (O82b): megadj's DB, readonly -----------------
        if (route === "/archive/search") {
          const q = (url.searchParams.get("q") ?? "").trim();
          if (q.length < 2) return json({ error: "q must be ≥2 chars" }, 400);
          return json(archive.searchTracks(q));
        }
        if (route === "/archive/track") {
          const id = url.searchParams.get("id") ?? "";
          const t = archive.trackStats(id);
          return t ? json(t) : json({ error: "unknown video_id" }, 404);
        }
        if (route === "/archive/ingest-status") {
          return json(archive.ingestStatus());
        }
        if (route === "/archive/lowq") {
          return json(archive.lowqQueue());
        }
        if (route === "/archive/source-diff") {
          const a = url.searchParams.get("a");
          const b = url.searchParams.get("b");
          if (!a || !b)
            return json({ error: "a and b source names required" }, 400);
          return json(archive.sourceDiff(a, b));
        }
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
    if (await f.exists()) {
      // hashed assets (index-<hash>.js) cache forever; everything else
      // (index.html) must revalidate so new deploys are picked up.
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

/** display labels for fleet responses: drive_id → nickname/name */
function driveNames(): Map<string, string> {
  return new Map(db.allDrives().map((d) => [d.id, d.nickname ?? d.name]));
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

/** B12 input collector: per mounted drive, gather only what preflight reads.
 *  Mirrors reportInput's data plumbing but stays fleet-wide. */
function allPreflightInputs(): PreflightInput[] {
  const master = db.masterDrive();
  const masterSnap: SnapshotData | null = master?.last_snapshot_json
    ? JSON.parse(master.last_snapshot_json)
    : null;
  return registry
    .list()
    .filter((d) => d.mounted)
    .map((d): PreflightInput => {
      const snap: SnapshotData | null = d.last_snapshot_json
        ? JSON.parse(d.last_snapshot_json)
        : null;
      if (snap && !snap.capacity_bytes && d.capacity_bytes)
        snap.capacity_bytes = d.capacity_bytes;
      return {
        drive: d,
        snapshot: snap,
        latestVerify: db.latestVerify(d.id),
        bench: db.benchmarks(d.id),
        latestChecksum: db.latestChecksum(d.id),
        ledgerFiles: db.ledgerCount(d.id),
        masterSnapshot: d.id === master?.id ? null : masterSnap,
        isMirror:
          d.role === "mirror" ||
          d.name.toUpperCase() === cfg.mirrorDrive.toUpperCase(),
        // N78 rides on preflight: measured dual-DB rows → player verdict
        players: driveCompatibility(snap, extraPlayers()),
        now: Date.now(),
      };
    });
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
