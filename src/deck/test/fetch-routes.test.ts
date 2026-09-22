// fetch-routes.test.ts — the /fetch/* route family: /fetch/feed drains
// the ring with cursor arithmetic and shape-checks its input; /fetch/start
// validates options BEFORE enqueueing (bad body = 400, never a garbage
// run). The census pins route existence; this pins behavior.
import { describe, test, expect, beforeEach } from "bun:test";
import { makeApiRouter } from "../api/routes";
import { fetchFeedPush, fetchFeedClear } from "../fetch-feed";
import type { ApiDeps } from "../api/deps";

/** Minimal deps: only jobs.enqueue (spied) + json are on the /fetch paths. */
function makeDeps(): { deps: ApiDeps; enqueued: unknown[] } {
  const enqueued: unknown[] = [];
  const deps = {
    jobs: {
      enqueue: (
        driveId: string,
        kind: string,
        mount: string,
        origin: string,
      ) => {
        enqueued.push({ driveId, kind, mount, origin });
        return {
          id: "test-job",
          drive_id: driveId,
          kind,
          status: "queued",
          progress: 0,
          message: null,
          phase: null,
          eta_seconds: null,
          error: null,
          result_json: null,
          log_path: null,
          origin,
          created_at: Date.now(),
          started_at: null,
          finished_at: null,
        };
      },
    },
    json: (body: unknown, status = 200) =>
      Response.json(body, {
        status,
        headers: { "content-type": "application/json" },
      }),
  } as unknown as ApiDeps;
  return { deps, enqueued };
}

const routerOf = (deps: ApiDeps) => makeApiRouter(deps);
/** The router's route arg is the /api prefix already sliced (index.ts). */
const get = async (router: ReturnType<typeof routerOf>, path: string) => {
  const url = new URL(`http://x${path}`);
  const route = url.pathname.slice(4);
  return router(new Request(url), url, route);
};

beforeEach(() => fetchFeedClear());

describe("/api/fetch/feed", () => {
  test("drains the ring oldest-first with a next cursor", async () => {
    fetchFeedPush({
      at: 1,
      type: "start",
      start: { total: 9, tasks: 7, jobs: 6, dry: false },
    });
    fetchFeedPush({
      at: 2,
      type: "task",
      task: {
        done: 1,
        total: 7,
        name: "A - B",
        notes: [],
        votes: [{ rung: "bp", genre: "Techno", weight: 0.6 }],
        elected: { genre: "Techno", weight: 0.6, winnerRungs: ["bp"] },
      },
    });
    const { deps } = makeDeps();
    const res = await get(routerOf(deps), "/api/fetch/feed?since=0");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: { type: string }[];
      next: number;
    };
    expect(body.entries.map((e) => e.type)).toEqual(["start", "task"]);
    expect(body.next).toBe(2);
    // since=1 → only the tail
    const tail = await get(routerOf(deps), "/api/fetch/feed?since=1");
    const tailBody = (await tail.json()) as {
      entries: { type: string }[];
      next: number;
    };
    expect(tailBody.entries.map((e) => e.type)).toEqual(["task"]);
    expect(tailBody.next).toBe(2);
  });

  test("bad since values degrade to 0, empty ring = empty entries", async () => {
    const { deps } = makeDeps();
    const res = await get(routerOf(deps), "/api/fetch/feed?since=banana");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[]; next: number };
    expect(body.entries).toEqual([]);
    expect(body.next).toBe(0);
  });
});

describe("/api/fetch/start", () => {
  test("validates options: bad jobs and bad only are 400s", async () => {
    const { deps, enqueued } = makeDeps();
    const router = routerOf(deps);
    const post = async (body: unknown) => {
      const url = new URL("http://x/api/fetch/start");
      return router(
        new Request(url, {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
        url,
        url.pathname.slice(4),
      );
    };
    expect((await post({ jobs: 0 })).status).toBe(400);
    expect((await post({ jobs: 99 })).status).toBe(400);
    expect((await post({ only: "DROP TABLE" })).status).toBe(400);
    expect((await post({ only: "genres" })).status).toBe(200);
    expect(enqueued).toHaveLength(1);
    const q = enqueued[0] as { kind: string; mount: string };
    expect(q.kind).toBe("fetch");
    expect(q.mount).toBe(JSON.stringify({ only: "genres" }));
    expect((await post({})).status).toBe(200);
    expect(enqueued).toHaveLength(2);
  });
});
