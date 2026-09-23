// drive_routes.ts — the drive-card payload + every /api/drives/:id/* drive
// subroute, extracted from index.ts (complexity hot-spot split, #42). Deps
// are injected once via the factory; the repeated "unknown drive" 404 guard
// collapses into one helper. Route literals stay `sub === "…"` shaped so the
// surface-parity census (surface-parity.test.ts httpApiRoutes) keeps seeing
// them.
import type { DB } from "../db";
import type { Registry } from "../registry";
import type { ImageService } from "../image/store";
import type { CrateConfig } from "../config";
import { freeBytes } from "../tools/scan";
import { driveBadges, parseSnapshotJson, syncBadge } from "../shared/badges";
import { buildReport, buildReportSummary, overall } from "../report/report";
import { VERIFY_HELP } from "../verify/help";
import { exportDossier, reportInput, type ReportDeps } from "../report/inputs";
import { driveCompatibility } from "../players";
import {
  normalizeNote,
  addAgentNote,
  dismissAgentNote,
  agentNotes,
} from "../notes";
import type { Drive, NoteSeverity, SnapshotData } from "../shared/types";

/** Server-side badge computation glue (#221: was badges_view.ts, 26L —
 *  merged into its only consumer; shared rules live in shared/badges.ts,
 *  this adapts DB state to them). */
function driveBadgesView(
  db: DB,
  drive: Drive,
  _snaps: Map<string, SnapshotData>,
  _masterDriveName: string,
  _mirrorDriveName: string,
) {
  // parseSnapshotJson (not bare JSON.parse): a corrupt master blob must
  // surface as a badge, never 500 the /drives list it rides on.
  const master = db.masterDrive();
  const masterSnap = master
    ? parseSnapshotJson(master.last_snapshot_json).snap
    : null;
  const badges = driveBadges(drive, {
    latestVerify: db.latestVerify(drive.id),
  });
  const sync = syncBadge(drive, masterSnap);
  if (sync) badges.push(sync);
  return badges;
}

/** The player-catalog provider shape (index.ts passes its players.ts binding). */
type ExtraPlayers = () => Parameters<typeof driveCompatibility>[1];

export function makeDriveRoutes(deps: {
  db: DB;
  cfg: CrateConfig;
  registry: Registry;
  images: ImageService;
  reportDeps: ReportDeps;
  extraPlayers: ExtraPlayers;
  enqueueDriveJobFor: (
    req: Request,
    id: string,
  ) => Promise<Response> | Response;
  serveDriveImage: (url: URL) => Response;
  photoUpload: (
    req: Request,
    id: string,
    images: ImageService,
    json: (data: unknown, status?: number) => Response,
  ) => Promise<Response> | Response;
  hygieneBadge: () => unknown;
  shelfSweeps: { latestPerDrive: () => Map<string, unknown> };
  json: (data: unknown, status?: number) => Response;
}) {
  const { db, cfg, registry, images, reportDeps, json } = deps;

  /** One guard for the most repeated check in the family. */
  function driveOr404(id: string): NonNullable<ReturnType<DB["getDrive"]>> {
    return db.getDrive(id)!;
  }

  /** GET /api/drives + GET /api/status payload: the drive cards minus the
   *  MBs snapshot blob (page detail fetches it on demand). One builder so
   *  the two routes can never drift. */
  async function driveListPayload(): Promise<Drive[]> {
    const snaps = db.latestSnapshots();
    const sweeps = deps.shelfSweeps.latestPerDrive();
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
                live_free_bytes: d.mounted
                  ? (liveFree.get(d.id) ?? null)
                  : null,
              }
            : {
                // never-scanned mounted drive: still show live free space
                capacity_bytes: d.capacity_bytes || undefined,
                free_bytes: null,
                live_free_bytes: d.mounted
                  ? (liveFree.get(d.id) ?? null)
                  : null,
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
            ? deps.hygieneBadge()
            : null,
      }));
  }

  /** The /api/reports batch read: N report fetches → 1 request. */
  function reportsPayload(): Record<string, unknown> {
    return Object.fromEntries(
      registry.list().map((d) => {
        const r = buildReport(reportInput(reportDeps, d.id));
        return [d.id, buildReportSummary(r.checks)];
      }),
    );
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
    if (sub === "/notes" && req.method === "GET")
      return json(agentNotes(db, id));
    if (sub === "/notes" && req.method === "POST") {
      if (!driveOr404(id)) return json({ error: "unknown drive" }, 404);
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
    const noteMatch = sub.match(/^\/notes\/([^/]+)\/dismiss$/u);
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
      if (!driveOr404(id)) return json({ error: "unknown drive" }, 404);
      const report = buildReport(reportInput(reportDeps, id));
      return json({ ...report, overall: overall(report.checks) });
    }
    // latest granular verify report (per-check pass/fail + meanings)
    if (sub === "/verify") {
      if (!driveOr404(id)) return json({ error: "unknown drive" }, 404);
      // null (not a stub) — the web tab renders a "never verified"
      // state for null; a {ran_at:null} stub crashed `.checks.filter`.
      return json(db.getVerifyReport(id));
    }
    if (sub === "/verify/help") {
      return json(VERIFY_HELP);
    }
    if (sub === "/photo" && req.method === "POST") {
      if (!driveOr404(id)) return json({ error: "unknown drive" }, 404);
      return deps.photoUpload(req, id, images, json);
    }
    // images already ON this drive (Contents/CrateDeck + volume root)
    if (sub === "/drive-images") {
      const drive = driveOr404(id);
      if (!drive) return json({ error: "unknown drive" }, 404);
      if (!drive.mounted) return json({ error: "drive not mounted" }, 409);
      return json(await images.listDriveImages(drive.name));
    }
    if (sub === "/name" && req.method === "POST") {
      let body: { nickname: string | null };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        // client mistake → the route family's 400 contract (#226)
        return json({ error: "invalid JSON body" }, 400);
      }
      registry.rename(id, body.nickname);
      return json({ ok: true });
    }
    if (sub === "/jobs" && req.method === "POST") {
      return deps.enqueueDriveJobFor(req, id);
    }
    if (sub === "/benchmarks") return json(db.benchmarks(id));
    if (sub === "/speedprobes") return json(db.speedProbes(id));
    // File ON the drive (drive-image picker preview; was unreachable when it
    // lived below the /api/ block — see serveDriveImage comment).
    if (sub === "/drive-image") {
      return deps.serveDriveImage(url);
    }
    // N78: "which players will this stick actually work on?" —
    // measured dual-DB rows mapped onto the vendor player matrix
    if (sub === "/players") {
      const drive = driveOr404(id);
      if (!drive) return json({ error: "unknown drive" }, 404);
      // parseSnapshotJson: a corrupt blob must surface in the response, not
      // 500 the route (same crash class driveBadges had).
      const { snap, corrupt } = parseSnapshotJson(drive.last_snapshot_json);
      if (corrupt) return json({ error: "snapshot corrupt — run a scan" }, 409);
      const compat = driveCompatibility(snap, deps.extraPlayers());
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

  return { driveListPayload, reportsPayload, driveSubroute };
}
