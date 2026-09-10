// fixes_routes.ts — the /api/fixes family. Extracted route module (file-
// length guard) in the hygiene_routes.ts shape: reads come from the
// last-scan cache, heavy work (scan/apply) NEVER runs in the request leg
// — it enqueues a job whose leg spawns megadj's booth-fix CLI (the
// engine SSOT). The cache is module state: jobs.ts's leg imports
// recordFixes() after a scan/apply (leaf import — no cycle; this module
// imports only shared/fixes).
import type { FixesPayload } from "../shared/fixes";

/** Last completed fixes scan/apply payload (per process; null = never). */
let lastFixes: FixesPayload | null = null;

/** Called by the fixes-scan / fixes-apply job legs with the CLI summary. */
export function recordFixes(p: FixesPayload): void {
  lastFixes = p;
}

export function makeFixesRoutes(deps: {
  /** enqueue a fixes job ("fixes-scan" | "fixes-apply") */
  enqueue: (kind: "fixes-scan" | "fixes-apply") => { id: string };
  json: (data: unknown, status?: number) => Response;
}) {
  const { enqueue, json } = deps;

  /** GET /api/fixes → the last scan's payload (null until a scan ran). */
  function list(): Response {
    return json(lastFixes);
  }

  /** POST /api/fixes/scan — enqueue the dry-run audit job. */
  function scan(): Response {
    return json(enqueue("fixes-scan"));
  }

  /** POST /api/fixes/apply — enqueue the apply job (safe subset only:
   *  renames + tag sanitization; `none` rows are never auto-executed). */
  function apply(): Response {
    return json(enqueue("fixes-apply"));
  }

  return { list, scan, apply };
}
