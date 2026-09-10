/**
 * drive_job_routes — POST /api/drives/:id/photo + POST /api/drives/:id/jobs
 * handlers. Extracted from index.ts (file-length guard); deps injected as
 * plain params so the handlers stay pure orchestration over the real DB,
 * images and job services.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { CrateConfig } from "./config";
import type { Drive, JobKind } from "../shared/types";

/** POST /api/drives/:id/photo — multipart upload or JSON url/rel/clear. */
export async function photoUpload(
  req: Request,
  id: string,
  images: {
    choose(
      id: string,
      src: {
        data?: Uint8Array;
        name?: string;
        url?: string;
        localPath?: string;
        driveRel?: string;
      },
    ): Promise<string>;
    clear(id: string): void;
  },
  json: (data: unknown, status?: number) => Response,
): Promise<Response> {
  const ctype = req.headers.get("content-type") ?? "";
  // multipart = a real file-picker upload from the Photo tab;
  // JSON = url / drive_rel / clear as before
  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "file required" }, 400);
    const dest = await images.choose(id, {
      data: new Uint8Array(await file.arrayBuffer()),
      // the upload's real name picks the extension (photo.png stays .png)
      name: file instanceof File ? file.name : undefined,
    });
    return json({ ok: true, path: dest });
  }
  const body = (await req.json()) as {
    url?: string;
    localPath?: string;
    /** relative-to-volume path of an image picked FROM the drive */
    drive_rel?: string;
    clear?: boolean;
  };
  if (body.clear) {
    images.clear(id);
    return json({ ok: true, cleared: true });
  }
  const dest = await images.choose(id, {
    url: body.url,
    localPath: body.localPath,
    driveRel: body.drive_rel,
  });
  return json({ ok: true, path: dest });
}

/** Where a drive's volume is mounted. Respects CRATEDECK_VOLUMES/config
 *  volumesRoot (tests, fixtures, non-standard hosts) instead of assuming
 *  /Volumes — and verifies the directory is really there right now. */
export function resolveMountPoint(
  cfg: CrateConfig,
  volumeName: string,
): string {
  const candidate = join(cfg.volumesRoot, volumeName);
  try {
    readdirSync(candidate); // mounted + readable at this instant
    return candidate;
  } catch {
    throw new Error(`drive volume not mounted at ${candidate}`);
  }
}

/** POST /api/drives/:id/jobs — validate + enqueue a drive job. */
export function makeEnqueueDriveJob(deps: {
  cfg: CrateConfig;
  images: Parameters<typeof photoUpload>[2];
  jobs: {
    enqueue(
      driveId: string,
      kind: JobKind,
      mountPoint: string,
      origin: string,
    ): { id: string };
  };
  getDrive(id: string): (Drive & { mounted?: boolean }) | undefined;
  json(data: unknown, status?: number): Response;
}) {
  const { cfg, jobs, getDrive, json } = deps;
  return async function enqueueDriveJob(
    req: Request,
    id: string,
  ): Promise<Response> {
    const body = (await req.json()) as {
      kind: JobKind;
      origin?: string;
    };
    if (
      ![
        "scan",
        "verify",
        "mirror",
        "benchmark",
        "checksum",
        "speedtest",
      ].includes(body.kind)
    ) {
      return json({ error: "bad kind" }, 400);
    }
    const drive = getDrive(id);
    if (!drive?.mounted) return json({ error: "drive not mounted" }, 409);
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
  };
}
