/**
 * archive-dispatch-census.test.ts — pins the ONE-source-of-truth dispatch
 * invariant on /api/archive/* routes: every handler key in
 * `archiveHandlers()` must be reachable through the REAL `archiveRoutes`
 * dispatch (shape regex → map lookup). The old dispatch enumerated routes
 * in a hand-copied regex twin; adding `genre-why` (#215) to the map but
 * not the regex left the handler dead — every live request 404'd while
 * the parity docs counted it (found on the live server 2026-09-17). A
 * route census over map keys vs. a hand list would re-drift by
 * construction, so this pins REACHABILITY instead: dispatch each key for
 * real and require a non-404.
 */
import { describe, expect, test, afterAll } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { archiveHandlers, archiveRoutes } from "../src/archive/routes";
import type { ArchiveReader } from "../src/archive";
import type { CrateConfig } from "../src/config";
import type { DB } from "../src/db";
import { tempDir } from "./testutil";

/** Minimal deps: some handlers reach the reader even before param guards
 *  (`track` reads unconditionally), so the stub throws — the point is
 *  "the route RESOLVED", not "the read succeeded": a handler that ran and
 *  threw inside Bun's test frame still proves the dispatch consulted the
 *  map (a dead route would return null / 404 instead). We wrap the call
 *  so a handler that successfully returns a 4xx (param guards) and one
 *  that throws both count as reachable. */
const deps = {
  archive: new Proxy({} as ArchiveReader, {
    get() {
      throw new Error("reader-stub: reachability test, read not expected");
    },
  }),
  db: {} as DB,
  cfg: {} as CrateConfig,
};

/** Hermetic allowlist fixture (#248 seam): one temp archive dir with a
 *  dated batch subfolder — surfaced-batch posts must match a real
 *  intakeCandidateDirs entry. The watch-dir leg is HOME-independent via
 *  the MEGADJ_INTAKE_WATCH override, so the watch candidate equals the
 *  musicDir (skipped) and ONLY the seeded batch dir is allowlisted. */
const allowlistTmp = tempDir("cratedeck-dispatch-allowlist-").rippable();
const archiveFixture = (() => {
  const musicDir = join(allowlistTmp.dir(), "archive");
  const batchDir = join(musicDir, "2026-09-19 legacy downloads");
  mkdirSync(batchDir, { recursive: true });
  process.env.MEGADJ_INTAKE_WATCH = musicDir; // watch === musicDir → skipped
  return { musicDir, batchDir };
})();
afterAll(() => {
  allowlistTmp.rippleAll();
  delete process.env.MEGADJ_INTAKE_WATCH;
});

/** Run one dispatch; resolve to the Response when the handler returned
 *  one, `null` when the route fell through, and a sentinel 599 Response
 *  when the handler itself threw (which still proves the map was hit). */
async function dispatch(route: string, url: URL): Promise<Response | null> {
  try {
    return await archiveRoutes(route, url, deps);
  } catch {
    return new Response(null, { status: 599 });
  }
}

describe("archive dispatch census (route list = handler map keys)", () => {
  const routes = Object.keys(archiveHandlers());
  test("the map carries the known families", () => {
    // Not exhaustive — the census is the map itself. These anchor names
    // keep the map from ever going silently empty (a broken import or a
    // refactor that returns {} would pass every other assertion below).
    for (const anchor of [
      "search",
      "similar",
      "megaset",
      "genre-why",
      "sweep",
    ]) {
      expect(routes).toContain(anchor);
    }
  });

  test("every handler key dispatches — none 404s (reachability, not a twin list)", async () => {
    expect(routes.length).toBeGreaterThan(10);
    for (const name of routes) {
      const url = new URL(`http://localhost/api/archive/${name}`);
      const res = await dispatch(`/archive/${name}`, url);
      expect(res).not.toBeNull();
      // 404 here means the dispatch failed to resolve the handler — the
      // exact genre-why regression. Any other status (200 param-guard
      // 400, handler throw → 599, lazy sweep import) means the route
      // resolved and the handler ran.
      expect(res?.status).not.toBe(404);
    }
  });

  test("an unknown route still falls through (null → upstream 404)", async () => {
    const res = await archiveRoutes(
      "/archive/no-such-route",
      new URL("http://localhost/api/archive/no-such-route"),
      deps,
    );
    expect(res).toBeNull();
  });

  test("surfaced batch enqueues the intake job + notes ids through the CLI", async () => {
    const calls: string[][] = [];
    const cli = async (args: string[]) => {
      calls.push(args);
      return { code: 0, stderr: "" };
    };
    const enqueued: { drive: string; kind: string; mount: string }[] = [];
    const jobDeps = {
      ...deps,
      // Hermetic allowlist: intakeCandidateDirs(cfg) lists the watch dir
      // (HOME-independent: MEGADJ_INTAKE_WATCH override) + cfg.musicDir's
      // children. This fixture seeds one existing batch dir to post.
      cfg: {
        musicDir: archiveFixture.musicDir,
      } as CrateConfig,
      jobs: {
        enqueue: (driveId: string, kind: "ingest", mountPoint: string) => {
          enqueued.push({ drive: driveId, kind, mount: mountPoint });
          return { id: "job-1234" };
        },
      },
    };
    const req = new Request("http://localhost/api/archive/surfaced-batch", {
      method: "POST",
      body: JSON.stringify({
        folder: archiveFixture.batchDir,
        ids: ["track-1", "track-1", "track-2"],
      }),
      headers: { "content-type": "application/json" },
    });
    const res = await archiveRoutes(
      "/archive/surfaced-batch",
      new URL("http://localhost/api/archive/surfaced-batch"),
      jobDeps,
      cli,
      req,
    );
    expect(res?.status).toBe(200);
    // The ingest is a JOB (progress/cancel/SSE — the Intake tab's engine),
    // never a blocking CLI spawn inside the request (Sep 19 UX pass).
    expect(enqueued).toEqual([
      {
        drive: "local-archive",
        kind: "ingest",
        mount: archiveFixture.batchDir,
      },
    ]);
    const body = (await res?.json()) as { jobId?: string };
    expect(body.jobId).toBe("job-1234");
    // the checklist rows are still noted done through the engine CLI
    expect(calls).toEqual([["surfaced-note", "track-1", "track-2", "--json"]]);
  });

  test("surfaced batch refuses when the jobs seam is absent (501, nothing runs)", async () => {
    const calls: string[][] = [];
    const req = new Request("http://localhost/api/archive/surfaced-batch", {
      method: "POST",
      body: JSON.stringify({
        folder: archiveFixture.batchDir,
        ids: ["track-1"],
      }),
      headers: { "content-type": "application/json" },
    });
    const res = await archiveRoutes(
      "/archive/surfaced-batch",
      new URL("http://localhost/api/archive/surfaced-batch"),
      deps,
      async (args) => {
        calls.push(args);
        return { code: 0, stderr: "" };
      },
      req,
    );
    expect(res?.status).toBe(501);
    expect(calls).toEqual([]);
  });

  test("surfaced batch refuses invalid ids before ingest", async () => {
    const calls: string[][] = [];
    const res = await archiveRoutes(
      "/archive/surfaced-batch",
      new URL("http://localhost/api/archive/surfaced-batch"),
      deps,
      async (args) => {
        calls.push(args);
        return { code: 0, stderr: "" };
      },
      new Request("http://localhost/api/archive/surfaced-batch", {
        method: "POST",
        body: JSON.stringify({
          folder: archiveFixture.batchDir,
          ids: ["bad"],
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res?.status).toBe(400);
    expect(calls).toEqual([]);
  });

  test("surfaced batch refuses a folder outside the intake allowlist (parity with /intake/start)", async () => {
    const calls: string[][] = [];
    const enqueued: unknown[] = [];
    const res = await archiveRoutes(
      "/archive/surfaced-batch",
      new URL("http://localhost/api/archive/surfaced-batch"),
      {
        ...deps,
        cfg: { musicDir: archiveFixture.musicDir } as CrateConfig,
        jobs: {
          enqueue: (..._: unknown[]) => {
            enqueued.push(_);
            return { id: "job-x" };
          },
        },
      },
      async (args) => {
        calls.push(args);
        return { code: 0, stderr: "" };
      },
      new Request("http://localhost/api/archive/surfaced-batch", {
        method: "POST",
        // absolute, well-formed, NOT on the allowlist — exactly the
        // crafted-path shape the gate exists to refuse (Sep 20 parity fix)
        body: JSON.stringify({
          folder: "/etc",
          ids: ["track-1"],
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res?.status).toBe(403);
    expect(enqueued).toEqual([]);
    expect(calls).toEqual([]);
  });
});
