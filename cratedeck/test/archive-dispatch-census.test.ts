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
import { describe, expect, test } from "bun:test";
import { archiveHandlers, archiveRoutes } from "../src/archive_routes";
import type { ArchiveReader } from "../src/archive";
import type { CrateConfig } from "../src/config";
import type { DB } from "../src/db";

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
});
