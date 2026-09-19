// grid_health_routes.ts — the /api/grid-health family (GA-05c, #167):
// the CrateDeck READ surface over `megadj rb-grid-triage`. Heavy work
// NEVER runs in the request leg — it enqueues a job whose leg spawns the
// megadj CLI (the engine SSOT, same pattern as fixes_routes); the reads
// come from the last-run cache. Record happens in jobs.ts's leg via
// recordGridHealth() (leaf import — no cycle).
import type { GridHealthPayload } from "../shared/grid-health";

/** Last completed triage run per drive id (module state; null = never). */
const lastRuns = new Map<string, GridHealthPayload>();

/** Called by the grid-health job leg with the CLI summary. */
export function recordGridHealth(driveId: string, p: GridHealthPayload): void {
  lastRuns.set(driveId, p);
}

export function makeGridHealthRoutes(deps: {
  /** enqueue a grid-health triage job for one drive */
  enqueue: (driveId: string) => { id: string };
  json: (data: unknown, status?: number) => Response;
  /** drive resolver: name/nickname/id → {id,name} */
  resolveDrive: (
    nameOrId: string,
  ) =>
    | { id: string; name: string }
    | null
    | Promise<{ id: string; name: string } | null>;
}) {
  const { enqueue, json, resolveDrive } = deps;

  /** GET /api/grid-health?drive=X → last run's payload (null = never;
   *  no drive param = the freshest run of any drive, the UI default). */
  async function get(driveParam: string | null): Promise<Response> {
    if (!driveParam) {
      let best: GridHealthPayload | null = null;
      for (const p of lastRuns.values()) {
        if (!best || p.ranAt > best.ranAt) best = p;
      }
      return json(best);
    }
    const d = await resolveDrive(driveParam);
    if (!d) return json({ error: "unknown drive" }, 404);
    return json(lastRuns.get(d.id) ?? null);
  }

  /** POST /api/grid-health/scan?drive=X — enqueue the triage job. */
  async function scan(driveParam: string | null): Promise<Response> {
    if (!driveParam) return json({ error: "drive required" }, 400);
    const d = await resolveDrive(driveParam);
    if (!d) return json({ error: "unknown drive" }, 404);
    return json(enqueue(d.id));
  }

  return { get, scan };
}
