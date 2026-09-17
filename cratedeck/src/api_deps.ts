// api_deps.ts — the API router's shared types (the #89 dispatch split's
// import leaf). ApiDeps/Handler lived in api_routes.ts, which made
// api_dispatch.ts's type-only import a cycle (madge counts type-only
// back-edges — Sep 9 sweep's own rule). Types live HERE: api_routes.ts
// and api_dispatch.ts both import this leaf; the dependency arrow runs
// one way again.

import type { DB } from "./db";
import type { Registry } from "./registry";
import type { JobEngine } from "./jobs";
import type { CrateConfig } from "./config";
import type { ArchiveReader } from "./archive";
import type { ImageService } from "./images";
import type { makeFixesRoutes } from "./fixes_routes";
import type { makeHygieneRoutes } from "./hygiene_routes";
import type { makeGridHealthRoutes } from "./grid_health_routes";
import type { ReportDeps } from "./report_inputs";

/** The HTTP API's dependency bundle: built once in index.ts, threaded
 *  through every route family and the dynamic dispatch tail. */
export interface ApiDeps {
  cfg: CrateConfig;
  db: DB;
  registry: Registry;
  jobs: JobEngine;
  images: ImageService;
  archive: ArchiveReader;
  reportDeps: ReportDeps;
  hygieneApi: ReturnType<typeof makeHygieneRoutes>;
  fixesApi: ReturnType<typeof makeFixesRoutes>;
  gridHealthApi: ReturnType<typeof makeGridHealthRoutes>;
  driveListPayload: () => Promise<unknown>;
  reportsPayload: () => unknown;
  driveSubroute: (
    req: Request,
    url: URL,
    id: string,
    sub: string | undefined,
  ) => Promise<Response | null> | Response | null;
  fleetRoutes: (route: string, url: URL) => Response | Promise<Response>;
  json: (data: unknown, status?: number) => Response;
  sse: () => Response;
  /** graceful stop (deckctl stop): watcher + jobs + closes + exit. */
  stopServer: () => void;
}

export type Handler = (req: Request, url: URL) => Response | Promise<Response>;
