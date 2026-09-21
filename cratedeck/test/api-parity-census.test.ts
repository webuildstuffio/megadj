/**
 * api-parity-census (#249) — the client↔server /api contract pin.
 *
 * The drift class (fired twice before this census existed): `genre-why`
 * 404'd live via a hand-copied route-list twin (Sep 17), and #231's dead
 * endpoint (a 7-leg Promise.all where one leg 404'd and blanked fresh
 * data). Both were found by humans noticing stale UI — nothing gated
 * them. surface-parity.test.ts's G4/G5 pass pins UI-called families
 * against its route census; this census closes the remaining gaps:
 *
 *   1. SERVER side derives from the PRODUCERS: the exact keys of the
 *      api_routes slice tables (the factories' return tables — quoted
 *      keys only), the delegator literals the runtime actually matches,
 *      drive subroute literals from drive_routes.ts, and the archive
 *      family from archiveHandlers()'s REAL keys (imported producer —
 *      the same derivation archive-dispatch-census pins; zero text
 *      parsing there).
 *   2. CLIENT side walks cratedeck/web + the deckctl/MCP client legs for
 *      every /api target — including the useScanApply scaffold
 *      composites (`${actionPath}/${kind}`) and `src={...}` media fetches
 *      that the literal-call scan cannot see (the #231 class).
 *   3. THE PIN: every client target resolves to a derived server route
 *      (param-normalized), and every server route is client-reachable or
 *      allowlisted WITH A REASON — the next route rename fails here, not
 *      as a silent dead card in the UI.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { archiveHandlers } from "../src/archive/routes";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

// ---- server leg: producer-derived route set --------------------------------

function serverRoutes(): Set<string> {
  const routes = new Set<string>();

  // Slice tables in api_routes.ts: the register(...) calls name the
  // producers; each factory's return-table keys ARE the routes it serves.
  const apiRoutes = read("cratedeck/src/api/routes.ts");
  const sliceFactories = [
    ...apiRoutes.matchAll(/register\((\w+)\(deps\)\)/g),
  ].map((m) => m[1]);
  expect(
    sliceFactories.length,
    "the api_routes slice registry changed — update this census's producer derivation",
  ).toBeGreaterThanOrEqual(5);
  for (const factory of sliceFactories) {
    const start = apiRoutes.indexOf(`function ${factory}(deps`);
    const returnAt = apiRoutes.indexOf("return {", start);
    const end = apiRoutes.indexOf("\n  };", returnAt);
    const block = apiRoutes.slice(returnAt, end);
    for (const m of block.matchAll(/"\/([a-z0-9][a-z0-9/-]*)":/g))
      if (m[1]) routes.add(`/${m[1]}`);
  }

  // Dynamic families in api_dispatch.ts — the regexes/literals the
  // runtime actually matches.
  const dispatch = read("cratedeck/src/api/dispatch.ts");
  if (dispatch.includes("jobMatch = route.match")) {
    routes.add("/jobs/:id");
    routes.add("/jobs/:id/cancel");
  }
  if (dispatch.includes('route === "/drives"')) routes.add("/drives");
  if (dispatch.includes("driveMatch = route.match")) routes.add("/drives/:id");

  // Drive subroutes: sub === literals in drive_routes.ts + the regex
  // shapes the sub matcher uses (the noteMatch dismiss arm).
  const driveRoutes = read("cratedeck/src/drive-routes.ts");
  for (const m of driveRoutes.matchAll(/sub === "(\/[a-z/-]+)"/g))
    if (m[1]) routes.add(`/drives/:id${m[1]}`);
  if (driveRoutes.includes("const noteMatch = sub.match"))
    routes.add("/drives/:id/notes/:id/dismiss");

  // archive family: the REAL handler keys (imported producer).
  for (const key of Object.keys(archiveHandlers()))
    routes.add(`/archive/${key}`);

  // fleet family: route === literals + the /fleet/ prefix fall-through.
  const fleet = read("cratedeck/src/fleet-routes.ts");
  for (const m of fleet.matchAll(/route === "(\/fleet\/[a-z]+)"/g))
    if (m[1]) routes.add(m[1]);
  if (apiRoutes.includes('route.startsWith("/fleet/")'))
    routes.add("/fleet/prep");

  // hygiene/fixes/grid-health delegator literals (kept literal form ON
  // PURPOSE — surface-parity's comment: switch labels would hide them).
  for (const m of dispatch.matchAll(
    /route === "(\/(?:hygiene|fixes|grid-health)[a-z/-]*)"/g,
  ))
    if (m[1]) routes.add(m[1]);

  // /images/search — the inline literal in the router closure.
  if (apiRoutes.includes('route === "/images/search"'))
    routes.add("/images/search");

  return routes;
}

// ---- client leg: every /api target the web + deckctl/MCP clients emit ------

interface ClientTarget {
  /** Normalized family: interpolations collapsed to :x, query stripped. */
  family: string;
  where: string;
}

function normalizeFamily(lit: string): string {
  // Query split first, then two interpolation classes: a `${...}`
  // appended DIRECTLY to a static tail with no `/` before it (e.g.
  // `/coverage${qs}` where qs = `?min_copies=2`) is a query-ish suffix —
  // stripped; a `${...}` in segment position (`/jobs/${id}/cancel`) is a
  // path parameter — collapsed to :x.
  const noQuery = lit.split("?")[0] ?? lit;
  return noQuery
    .replace(/(?<!\/)\$\{[^}]*\}/g, "")
    .replace(/\$\{[^}]*\}/g, ":x");
}

/** First string/template literal at/after `from` (prettier wraps the
 *  literal onto the next line — whitespace-skip handles that). */
function firstLiteral(src: string, from: number): string | null {
  let i = from;
  while (i < src.length && /\s/.test(src[i] ?? "")) i += 1;
  const q: string = src[i] ?? "";
  if (q !== "`" && q !== "'" && q !== '"') return null;
  let j = i + 1;
  let lit = "";
  while (j < src.length && src[j] !== q) {
    lit += src[j];
    j += 1;
  }
  return lit;
}

function walkWebTargets(dir: string, out: ClientTarget[]): void {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "test") continue;
      walkWebTargets(rel, out);
    } else if (/\.(tsx|ts)$/.test(e.name)) {
      if (e.name === "api.ts" || e.name === "toast.tsx") continue;
      const src = read(rel);
      // JS call shapes: api/apiPost generic args put the quote after `>`;
      // the generic may nest one level (`api<Record<string, ReportSummary>>`
      // in App.tsx's /api/reports leg), so the bracket body allows one
      // nested level; the JSX `src={` shape uses a lookahead so the
      // backtick survives for firstLiteral (the audio player's stream).
      const shapes = [
        /\bapi(?:Post)?(?:<(?:[^<>]|<[^<>]*>)*>)?\s*\(/g,
        /\bfetch\s*\(/g,
        /new EventSource\s*\(/g,
        /(?:src|href)=\{(?=\s*`)/g,
      ];
      for (const re of shapes) {
        for (const m of src.matchAll(re)) {
          const lit = firstLiteral(src, (m.index ?? 0) + m[0].length);
          if (lit?.includes("/api/")) {
            out.push({ family: normalizeFamily(lit), where: rel });
          }
        }
      }
      // Scaffold-mediated: useScanApply's readPath/actionPath props plus
      // the literal scan/apply kinds it POSTs — the composite targets a
      // call-literal scan cannot see (the #231 dead-endpoint class).
      const scaffoldPaths = [
        ...src.matchAll(/(?:readPath|actionPath): "([^"]+)"/g),
      ]
        .map((m) => m[1])
        .filter((p): p is string => Boolean(p));
      for (const p of scaffoldPaths) {
        out.push({ family: p, where: rel });
        if (/actionPath/.test(src))
          for (const kind of ["scan", "apply"])
            out.push({ family: `${p}/${kind}`, where: rel });
      }
    }
  }
}

/** deckctl/MCP client legs — the server's other consumers. Their targets
 *  must ALSO resolve: a deckctl-only route that 404s is the same bug. */
function clientSourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return clientSourceFiles(rel);
      return /\.(tsx|ts)$/.test(entry.name) ? [rel] : [];
    },
  );
}

function deckctlTargets(): ClientTarget[] {
  const out: ClientTarget[] = [];
  const clientFiles = [
    // Keep the stable root entry and recursively inventory every split-out
    // command leg: a new nested client must enter parity automatically.
    "cratedeck/src/deckctl.ts",
    ...clientSourceFiles("cratedeck/src/deckctl"),
    "cratedeck/src/archive/tools.ts",
    "cratedeck/src/deckapi.ts",
    // drive-images producer whose entries carry an /api URL the web client
    // renders verbatim (`src={img.url}`).
    "cratedeck/src/image-store.ts",
  ];
  // MCP read handlers are now a prefix-domain leaf. Keep this explicit
  // client input: a root-only scan would silently stop checking its API
  // targets after the #214 layout move.
  clientFiles.push("cratedeck/src/mcp/read-tools.ts");
  for (const rel of clientFiles) {
    const src = read(rel);
    // helper-call shapes — the opening quote stays for firstLiteral
    // (longest names first so apiGetJson isn't cut at apiGet).
    const callRe =
      /\b(?:apiGetJsonT|apiGetJson|apiGet|apiPost|getJson)(?:<[^>]*>)?\s*\(/g;
    for (const m of src.matchAll(callRe)) {
      const lit = firstLiteral(src, (m.index ?? 0) + m[0].length);
      if (lit?.includes("/api/"))
        out.push({ family: normalizeFamily(lit), where: rel });
    }
    // enqueueAndFollow(h, "hygiene", sub) — the queue-leg family comes
    // from the CALL-SITE literal, not the helper's template (deckctl_hygiene
    // and deckctl_fixes both ride it: /api/<family>/scan|apply). The
    // helper's own template only adds the all-param skeleton — dropped.
    if (/enqueueAndFollow\(/.test(src)) {
      for (const m of src.matchAll(/enqueueAndFollow\([^,]+,\s*"([^"]+)"/g)) {
        const family = m[1];
        if (family)
          for (const kind of ["scan", "apply"])
            out.push({ family: `/api/${family}/${kind}`, where: rel });
      }
    }
    // url: `/api/...` producer entries (image-store's DriveImage.url —
    // consumed verbatim by PhotoTab's src={img.url}).
    for (const m of src.matchAll(/url:\s*`(\/api\/[^`]+)`/g)) {
      const path = m[1];
      if (path) out.push({ family: normalizeFamily(path), where: rel });
    }
    // the direct fetch(`${BASE}/api/...`) shape in deckapi itself
    for (const m of src.matchAll(/fetch\(\s*`\$\{BASE\}(\/api\/[^`]+)`/g)) {
      const path = m[1];
      if (path) out.push({ family: normalizeFamily(path), where: rel });
    }
  }
  return out;
}

// ---- matching: client family → server route (param-normalized) --------------

function familyMatchesRoute(family: string, route: string): boolean {
  const f = family.replace(/^\/api\//, "/");
  const r = route.replace(/^\/api\//, "/");
  const fSegs = f.split("/").filter(Boolean);
  const rSegs = r.split("/").filter(Boolean);
  if (fSegs.length !== rSegs.length) return false;
  return rSegs.every((seg, i) => seg.startsWith(":") || seg === fSegs[i]);
}

// ---- the allowlist: server routes with NO client caller + reason ------------

const SERVER_ONLY_ROUTES: Readonly<Record<string, string>> = {
  "/status":
    "front-page aggregate = the wire twin of `deckctl status --json` output; both clients compose it from /interlock + /drives + /jobs (cmdStatus, mcp/read-tools status) — the aggregate exists for curl/human parity checks",
  "/help":
    "in-app help SSOT over HTTP: serves the SAME shared/help.ts content the web bundles at build time (surface-parity pins the twin); kept reachable for curl/agent parity reads",
  "/help/jobs":
    "job-kind glossary (VERIFY_HELP) over HTTP — the deckctl explain twin; no client fetches it (deckctl reads the module directly)",
};

describe("api parity census (#249: the client↔server /api contract)", () => {
  const server = serverRoutes();
  const webTargets: ClientTarget[] = [];
  walkWebTargets("cratedeck/web", webTargets);
  const allTargets = [...webTargets, ...deckctlTargets()];
  const clientFamilies = new Set(allTargets.map((t) => t.family));

  test("the census is live, not vacuous", () => {
    expect(server.size).toBeGreaterThanOrEqual(47);
    expect(clientFamilies.size).toBeGreaterThanOrEqual(45);
  });

  test("every client /api target resolves to a producer-derived server route", () => {
    const problems: string[] = [];
    for (const t of allTargets) {
      if ([...server].some((r) => familyMatchesRoute(t.family, r))) continue;
      // All-param skeletons (every segment an interpolation — e.g. the
      // shared queue helper's /api/${family}/${action}) carry no route
      // identity; their REAL targets arrive via call-site literals.
      const segs = t.family
        .replace(/^\/api\//, "")
        .split("/")
        .filter(Boolean);
      if (segs.length > 0 && segs.every((s) => s === ":x")) continue;
      problems.push(`${t.family} (${t.where})`);
    }
    expect(
      problems,
      `web/deckctl call these but no server route serves them (the genre-why Sep-17 class — a rename shipped without its client):\n  ${[...new Set(problems)].join("\n  ")}`,
    ).toEqual([]);
  });

  test("every server route is client-reachable or allowlisted with a reason", () => {
    const problems: string[] = [];
    for (const route of server) {
      if ([...clientFamilies].some((f) => familyMatchesRoute(f, route)))
        continue;
      if (SERVER_ONLY_ROUTES[route]) continue;
      problems.push(route);
    }
    expect(
      problems,
      `server routes no client reaches — allowlist with a reason or delete the dead route:\n  ${problems.join("\n  ")}`,
    ).toEqual([]);
  });

  test("the tripwire trips: a renamed archive key fails census 2", () => {
    // Prove the pin is real: drop one archive key from a COPY of the
    // server set and confirm its client family no longer resolves.
    const genreWhy = "/archive/genre-why";
    expect(server.has(genreWhy)).toBeTrue();
    const without = new Set([...server].filter((r) => r !== genreWhy));
    expect(
      [...without].some((r) => familyMatchesRoute("/api/archive/genre-why", r)),
    ).toBeFalse();
  });
});
