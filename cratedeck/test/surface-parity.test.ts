import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { COMMAND_DOCS } from "../../src/command-registry";
import { JOB_KINDS } from "../shared/types";
import { DECK_MCP_SURFACES } from "../src/mcp/surfaces";

/**
 * Surface-parity regression guard (docs/surface-parity.md).
 *
 * PRINCIPLES.md §1 extended: every capability exposed on one surface
 * (CLI / MCP / UI) must be reachable on the others or carry an explicit
 * exemption in the doc's §4 registry — and this test is the mechanical
 * enforcement. It parses the actual sources (no fixtures, no server
 * needed), so a new verb/tool/button without its twins is a red build,
 * not a six-weeks-later discovery.
 *
 * The exemption lists below and docs/surface-parity.md §4 are edited in
 * the same commit or neither (that's the point).
 */

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) =>
  readFileSync(join(ROOT, p), "utf8").split("\n") as string[];

// ---- census: derive each surface from source -----------------------------

/** deckctl verb set: the DECK_COMMANDS dispatch table in deckctl.ts (the
 *  old switch's `case "x":` arms — #89 turned it into a verb table), plus
 *  the PRE_SERVER_VERBS list (help works before the server boots — still a
 *  first-class verb, documented in usage). */
function deckctlVerbs(): string[] {
  const src = read("cratedeck/src/deckctl.ts");
  const tableStart = src.findIndex((l) => l.includes("DECK_COMMANDS: Record<"));
  const tableEnd = src.indexOf("};");
  const verbs = src
    .slice(tableStart, tableEnd > tableStart ? tableEnd : src.length)
    .map((l) => l.match(/^\s{2}([a-z-]+):/))
    .map((m) => (m ? m[1] : undefined))
    .filter((v): v is string => v !== undefined);
  const pre = src
    .find((l) => l.includes("PRE_SERVER_VERBS = ["))
    ?.match(/\[([^\]]*)\]/)?.[1];
  if (pre)
    for (const v of pre.split(",").map((s) => s.trim().replace(/['"]/g, "")))
      if (v) verbs.push(v);
  return [...new Set(verbs)].toSorted();
}

/** megadj CLI command set: derived from the #143 command registry (the
 *  help/census SSOT) plus the maintenance dispatch table read. This
 *  surface was historically NOT censused (deckctl + MCP were), which is
 *  exactly how the doc drifted to "19 commands" while the code carried 30
 *  (the whole shelf family + booth-fix + similar + upgrade landed with no
 *  census to fail). */
function megadjCommands(): string[] {
  const verbs = COMMAND_DOCS.map(({ name }) => name);
  // #235: the MAINTENANCE_VERBS list dissolved into the domain records —
  // the rb-*/shelf-hygiene verbs derive from those tables now.
  for (const f of [
    "src/shelf/cli-commands.ts",
    "src/rekordbox/cli-commands.ts",
  ]) {
    const src = read(f).join("\n");
    for (const tbl of src.matchAll(
      /export const \w+_COMMANDS(?::[^=]*)?= \{[\s\S]*?\n\};/g,
    )) {
      for (const match of (tbl[0] ?? "").matchAll(/"([a-z-]+)":/g))
        if (match[1]) verbs.push(match[1]);
    }
  }
  return [...new Set(verbs)].toSorted();
}

/** HTTP API path census. Route literals are intentionally derived from the
 * dispatchers: exact-path table keys (`"/status": …`) in api_routes.ts,
 * top-level `route ===` literals, drive subpaths get the /drives/:id
 * prefix, and archive handlers come from archive/routes.ts. */
function httpApiRoutes(): string[] {
  // route families live in their own modules since the #42 split; the
  // census reads ALL of them so a literal can't hide in a new file
  const index = [
    "cratedeck/src/index.ts",
    "cratedeck/src/api/routes.ts",
    "cratedeck/src/api/dispatch.ts",
    "cratedeck/src/drive-routes.ts",
    "cratedeck/src/fleet/routes.ts",
  ]
    .map((f) => read(f).join("\n"))
    .join("\n");
  const routes = new Set<string>();
  // exact-path dispatch-table keys in api_routes.ts (`"/status": …`)
  for (const match of index.matchAll(/^\s{4}"(\/[^"]+)":/gm)) {
    const path = match[1];
    if (path) routes.add(path);
  }
  for (const match of index.matchAll(/(route|sub) === "(\/[^"]+)"/g)) {
    const path = match[2];
    if (!path) continue;
    const canonical = path === "/events/" ? "/events" : path;
    routes.add(match[1] === "sub" ? `/drives/:id${canonical}` : canonical);
  }
  if (index.includes("jobMatch = route.match")) {
    routes.add("/jobs/:id");
    routes.add("/jobs/:id/cancel");
  }
  // Regex/dispatch-shaped routes the `===` scan can't see, each verified
  // against its source pattern so a rename of the regex fails the census:
  // /jobs/:id + /jobs/:id/cancel live in the jobMatch regex above;
  // /drives/:id is the `!sub` detail arm in driveSubroute;
  // /drives/:id/notes/:id/dismiss is the noteMatch regex in drive_routes;
  // /fleet/prep is the fall-through tail of the fleet router (no guard —
  // the /fleet/ prefix delegator in api_routes.ts routes it there).
  if (index.includes("const noteMatch = sub.match"))
    routes.add("/drives/:id/notes/:id/dismiss");
  if (index.includes('if (route.startsWith("/fleet/"))'))
    routes.add("/fleet/prep");
  if (index.includes("if (!sub) {")) routes.add("/drives/:id");
  const archive = read("cratedeck/src/archive/routes.ts").join("\n");
  const handlers = archive.match(
    /function archiveHandlers\(\)[\s\S]*?return \{([\s\S]*?)\n  \};/,
  );
  for (const match of handlers?.[1]?.matchAll(
    /^\s{4}(?:"([a-z-]+)"|([a-z-]+)):/gm,
  ) ?? []) {
    const name = match[1] ?? match[2];
    if (name) routes.add(`/archive/${name}`);
  }
  return [...routes].toSorted();
}

/** MCP tool set: tool keys in mcp.ts's table + the extracted archive_tools
 *  module (both are part of the server's tool census; the module's keys sit
 *  one level deeper — 4 spaces — inside its factory). */
function mcpTools(): string[] {
  const files = [
    "cratedeck/src/mcp.ts",
    "cratedeck/src/archive/tools.ts",
    "cratedeck/src/getdat-tools.ts",
  ];
  const tools = files
    .flatMap((f) =>
      read(f).map((l) =>
        l.match(/^\s{2,4}((?:deck|archive|getdat|megaset)_[a-z_]+):/),
      ),
    )
    .map((m) => (m ? m[1] : undefined))
    .filter((v): v is string => v !== undefined);
  return [
    ...new Set([...DECK_MCP_SURFACES.map((surface) => surface.tool), ...tools]),
  ].toSorted();
}

/** UI job-enqueue surface: every kind the web can POST to /jobs. The
 *  five drive kinds POST /api/drives/:id/jobs with a kind literal
 *  (DrivePage/VerifyTab); the family kinds POST their family route with
 *  the kind as the URL tail — either via the tabs' own `api/hygiene/${kind}`
 *  spelling or via the shared `useScanApply` hook's `actionPath` +
 *  `/${kind}` construction in products/shared/index.tsx; IntakeTab posts the
 *  fixed `ingest` job. All spellings are censused. */
function uiJobKinds(): string[] {
  const kinds: string[] = [];
  for (const file of [
    "cratedeck/web/products/cratedeck/DrivePage.tsx",
    "cratedeck/web/products/cratedeck/VerifyTab.tsx",
    "cratedeck/web/products/cratedeck/HygieneTab.tsx",
    "cratedeck/web/products/cratedeck/FixesTab.tsx",
    "cratedeck/web/products/cratedeck/GridHealthCard.tsx",
    "cratedeck/web/products/getdat/IntakeTab.tsx",
    "cratedeck/web/products/fulltags/GenreRunTab.tsx",
    "cratedeck/web/products/shared/index.tsx",
  ]) {
    for (const line of read(file)) {
      for (const m of line.matchAll(/run\("([a-z]+)"\)/g))
        if (m[1]) kinds.push(m[1]);
      for (const m of line.matchAll(/kind:\s*"([a-z]+)"/g))
        if (m[1]) kinds.push(m[1]);
      // family-route enqueues: the URL tail maps to the job kind (hygiene
      // scan → hygiene-scan, fixes scan → fixes-scan)
      if (line.includes("/api/hygiene"))
        kinds.push("hygiene-scan", "hygiene-apply");
      if (line.includes("/api/fixes")) kinds.push("fixes-scan", "fixes-apply");
      if (line.includes("/api/intake/start")) kinds.push("ingest");
      // grid-health scan → the grid-health job kind (#167)
      if (line.includes("/api/grid-health/scan")) kinds.push("grid-health");
      // fetch start → the fetch job kind (#215 live-run pass)
      if (line.includes("/api/fetch/start")) kinds.push("fetch");
    }
  }
  return [...new Set(kinds)].toSorted();
}

/** UI endpoint surface (audit gap G4): every distinct `/api/...` path
 *  family the web app talks to — the source-derived replacement for the
 *  doc's old hand-approximated "~22 actions" cell. Derived by scanning
 *  every web module (not just the tab list: a call site hiding in a
 *  product dir must count too) for the four transport shapes:
 *  `api<T>(...)`/`apiPost(...)` (ui/api.ts via ui/toast.ts), raw
 *  `fetch("/api/...")` (hygiene-compare's stats loader), `actionPath:`
 *  props (the useScanApply scan/apply scaffold), and the SSE
 *  `EventSource("/api/events")` feed. Query strings strip (a family is
 *  an endpoint, not its params) and `${...}` interpolations collapse to
 *  `:x` (drive id changes don't fork the family). The transport hosts
 *  themselves (ui/api.ts, ui/toast.tsx) are excluded so the wrapper
 *  doesn't census itself. */
function uiEndpointFamilies(): string[] {
  const WEB_ROOT = "cratedeck/web";
  const families = new Set<string>();
  const walk = (dir: string): void => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "test") continue;
        walk(rel);
      } else if (/\.(tsx|ts)$/.test(e.name)) {
        if (e.name === "api.ts" || e.name === "toast.tsx") continue;
        const src = read(rel).join("\n");
        const callShapes = [
          /\bapi(?:Post)?(?:<[^>]*>)?\s*\(/g,
          /\bfetch\s*\(/g,
          /new EventSource\s*\(/g,
        ];
        for (const re of callShapes) {
          for (const m of src.matchAll(re)) {
            // first string literal after the call's open paren — handles
            // literals on the next line (prettier-wrapped api( calls)
            let i = (m.index ?? 0) + m[0].length;
            while (i < src.length && /\s/.test(src[i] ?? "")) i += 1;
            const q: string = src[i] ?? "";
            if (q !== "`" && q !== "'" && q !== '"') continue;
            let j = i + 1;
            let lit = "";
            while (j < src.length && src[j] !== q) {
              lit += src[j];
              j += 1;
            }
            if (lit.startsWith("/api/")) {
              const head = lit.split("?")[0];
              if (head !== undefined)
                families.add(head.replace(/\$\{[^}]*\}/g, ":x"));
            }
          }
        }
        // scaffold-mediated families: actionPath + `/${kind}`
        for (const m of src.matchAll(/actionPath: "([^"]+)"/g))
          if (m[1]) families.add(m[1]);
      }
    }
  };
  walk(WEB_ROOT);
  return [...families].toSorted();
}

/** The canonical job-kind set comes directly from the runtime SSOT. Importing
 *  the producer avoids a text parser that can drift when its type declaration
 *  changes — exactly the class of hand-maintained twin this test forbids. */
function canonicalJobKinds(): string[] {
  return [...JOB_KINDS].toSorted();
}

// ---- the parity registry (mirror of docs/surface-parity.md §3/§4) --------

/** deckctl verbs with NO MCP twin, each with its exemption tag. */
const VERB_EXEMPTIONS: Record<string, string> = {
  stop: "P1 — MCP/UI can't kill the host server (clients kill their own transport)",
};

/** MCP tools with no deckctl verb, with exemption tags. */
const TOOL_EXEMPTIONS: Record<string, string> = {
  // readonly archive reads are agent-surface by design (doc §4-A3)
  archive_search_tracks:
    "A3 — archive reads are agent-facing, not CLI-verb-shaped",
  archive_track_stats: "A3",
  archive_ingest_status: "A3",
  archive_lowq_queue: "A3",
  archive_source_diff: "A3",
  archive_grid_cross_check: "A3",
  archive_mood_profile: "A3",
  archive_similar_tracks: "A3 (I49 sounds-like: embeddings kNN, readonly)",
  archive_cue_ledger: "A3",
  archive_library_overview: "A3",
  archive_skip_census: "A3",
  archive_sources: "A3",
  archive_analysis_coverage: "A3",
  archive_tag_census: "A3 (FullTags ↔ rekordbox mirror census, readonly)",
  archive_tag_compare: "A3 (per-track three-source tag read, readonly)",
  archive_sweep:
    "A3 (also folded into deckctl prep via the D30 digest section)",
};

/** UI job buttons exempt from existing (none today; mirror closes GAP-1). */
const UI_KIND_EXEMPTIONS: Record<string, string> = {};

/** Whitespace-tolerant census-cell matcher. Module-level — captures
 *  nothing from the enclosing test. The number may be preceded by other
 *  words in the same cell ("6 pages, 54 UI calls"), so the pattern
 *  anchors on a word boundary, not the pipe. */
const censusCell = (n: number, unit: string): RegExp =>
  new RegExp(`\\|\\s*[^|]*\\b${n} ${unit}\\b[^|]*\\|`);

/** escapeRegExp hoisted to module scope (oxlint consistent-function-scoping). */
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- tests ----------------------------------------------------------------

describe("surface parity (docs/surface-parity.md)", () => {
  test("census matches the doc's §1 table", () => {
    // keep this file and the doc honest about each other. The counts are
    // DERIVED from source, and the doc strings the doc must carry are
    // built from those counts — a bump that forgets the doc fails here
    // (the booth fleet commit added deck_booth and every doc still said
    // 34; a >= floor assertion can't catch a stale EXACT number).
    const verbs = deckctlVerbs();
    const tools = mcpTools();
    const megadj = megadjCommands();
    // deck_* + archive_* split, for the drift post-mortem in the message
    const deck = tools.filter((t) => t.startsWith("deck_")).length;
    const archive = tools.length - deck;
    expect(verbs.length).toBeGreaterThan(0);
    expect(tools.length).toBeGreaterThan(0);
    expect(megadj.length).toBeGreaterThan(0);
    const doc = readFileSync(join(ROOT, "docs/surface-parity.md"), "utf8");
    // Whitespace-tolerant on PURPOSE: formatters may pad table cells ("| 23
    // verbs   |"), which must not read as a census drift. The COUNT itself
    // stays exact — only the padding is flexible.
    expect(doc).toMatch(censusCell(verbs.length, "verbs"));
    expect(doc).toMatch(censusCell(tools.length, "tools"));
    expect(doc).toMatch(censusCell(megadj.length, "commands"));
    const routes = httpApiRoutes();
    expect(routes.length).toBeGreaterThan(0);
    expect(doc).toMatch(censusCell(routes.length, "routes"));
    // G4: the UI cell is source-derived too — the doc's old "~22 actions"
    // was a hand approximation that no test could fail. The census counts
    // distinct /api/ endpoint families the web app calls (api/apiPost/
    // fetch/EventSource call sites + the useScanApply actionPath props).
    const uiFamilies = uiEndpointFamilies();
    expect(uiFamilies.length).toBeGreaterThan(20);
    expect(doc).toMatch(censusCell(uiFamilies.length, "UI calls"));
    // every UI-called family must exist in the route census — a UI button
    // pointing at a non-route is a broken promise, not a parity gap.
    // Notation normalization: the route census stores paths AFTER the
    // server's `/api` slice (`/drives/:id`, `/archive/search`), while UI
    // families are full client paths with interpolations collapsed to
    // `:x`. Matching is per-segment: a route `:id` segment becomes a
    // `[^/]+` wildcard (which swallows the UI side's literal `:x`
    // marker); everything else escapes literally.
    const routeRegexes = routes.map((r) => {
      const segs = r
        .replace(/^\/api\//, "")
        .replace(/^\//, "")
        .split("/")
        .map((seg) => (seg === ":id" ? "[^/]+" : escapeRegExp(seg)));
      return new RegExp(`^${segs.join("\\/")}$`);
    });
    const unmatched = uiFamilies.filter((f) => {
      const fam = f.replace(/^\/api\//, "").replace(/^\//, "");
      return !routeRegexes.some((re) => re.test(fam));
    });
    expect(
      unmatched,
      `UI calls these endpoints but the route census has no such route: ${unmatched.join(", ")}`,
    ).toEqual([]);
    // the dated-revs header must also carry the CURRENT tool count when
    // it names one (rev entries may name a past count only if a LATER rev
    // names the newer one — simplest honest rule: the doc must contain
    // the derived count somewhere, which the three asserts above pin).
    expect(doc).toContain(`${tools.length} tools`);
    console.log(
      `census: ${megadj.length} megadj commands, ${verbs.length} deckctl verbs (${[
        ...verbs,
      ]
        .slice(0, 3)
        .join(
          "/",
        )}, …), ${tools.length} MCP tools (${deck} deck_* + ${archive} archive_*)`,
    );
  });

  test("every megadj command appears in its help text (usage can't rot)", () => {
    // P1 (--json on every command) makes the help text an agent-facing
    // contract: a command missing from the help is a capability half
    // the agent surface can't discover. #143: help content lives in
    // command-doc producer leaves (usage.ts only renders); this census now
    // reads BOTH directions off the registry data — dispatch census
    // (megadjCommands) vs doc census (COMMAND_DOCS) must agree exactly,
    // so a command can neither lose its help block nor gain an
    // undocumented twin.
    const usage = read("src/usage.ts").join("\n");
    expect(usage).toContain("command-registry");
    const docNames = COMMAND_DOCS.map(({ name }) => name);
    const dispatch = megadjCommands();
    const missing = dispatch.filter((cmd) => !docNames.includes(cmd));
    expect(
      missing,
      `commands with handlers but no registry block: ${missing.join(", ")}`,
    ).toEqual([]);
    const undocumented = docNames.filter(
      (cmd) => !dispatch.includes(cmd) && cmd !== "help",
    );
    expect(
      undocumented,
      `registry blocks with no dispatch entry: ${undocumented.join(", ")}`,
    ).toEqual([]);
  });

  test("every megadj command appears in the doc's §2d matrix (G2 can't rot)", () => {
    // The Sep 14 audit (surface-parity canvas, gap G2) found 16 of 45
    // commands missing from the §2d capability matrix: the census pinned
    // the COUNTS while the audit table — the actual contract — silently
    // omitted a third of the surface. This closes it mechanically: every
    // command from the census must appear in docs/surface-parity.md
    // (matrix row or exemption prose). A new command without either is a
    // red build, same as the help census above.
    const doc = readFileSync(join(ROOT, "docs/surface-parity.md"), "utf8");
    for (const verb of megadjCommands()) {
      expect(
        new RegExp(`\\b${verb}\\b`).test(doc),
        `command "${verb}" appears nowhere in docs/surface-parity.md — add its §2d matrix row or cite its §4 exemption (audit gap G2)`,
      ).toBe(true);
    }
  });

  test("§4-A1 cites the MAINTENANCE_VERBS SSOT instead of a hand list (G3 can't rot)", () => {
    // Audit gap G3: the A1 exemption hand-enumerated its command set
    // (sync/ingest/fetch/beats/mood/cues/organize/upgrade/rb-adopt) —
    // nine names copied from an older tree that had already drifted by
    // construction (12 MAINTENANCE_VERBS existed when it was written).
    // The fix is derive-don't-duplicate, same rule the census follows:
    // the doc must NAME the SSOT, and the old hand-enumeration must NOT
    // come back as an inline verb list in that row.
    const doc = readFileSync(join(ROOT, "docs/surface-parity.md"), "utf8");
    const a1 = doc.split("**A1 —")[1]?.split(/\n- \*\*[A-Z]/)[0] ?? "";
    expect(a1.length).toBeGreaterThan(0);
    expect(a1).toContain("cli-commands.ts");
    expect(a1).toMatch(/rekordbox\/cli-commands|shelf\/cli-commands/);
    // the old hand list's signature: a slash-chained enumeration of the
    // pipeline verbs inside the A1 row — any return of that shape fails
    const handList = a1.match(/`sync`\/`ingest`\/`fetch`|sync\/ingest\/fetch/);
    expect(handList === null).toBeTrue();
  });

  test("GetDat CLI intake commands have MCP twins", () => {
    const tools = new Set(mcpTools());
    expect(tools.has("getdat_ingest")).toBeTrue();
    expect(tools.has("getdat_convert")).toBeTrue();
    expect(megadjCommands()).toContain("ingest");
    expect(megadjCommands()).toContain("convert");
  });

  test("archive reads with a CLI shape keep their megadj twins (megaset/similar)", () => {
    // these two were the doc §4's named CLI↔MCP gaps; each closed by the
    // same-pattern `megadj <verb>` read. The twins must not rot apart
    // again: drop either CLI command and this fails with the doc pointer.
    const cmds = megadjCommands();
    const tools = new Set(mcpTools());
    for (const [cmd, tool] of [
      ["similar", "archive_similar_tracks"],
      ["megaset", "megaset_propose"],
    ] as const) {
      expect(cmds).toContain(cmd);
      expect(tools.has(tool)).toBeTrue();
    }
    // the CLI megaset case must use the shared engine seam (no local
    // re-parse — the whole point of the parity fix)
    const cli = read("src/fulltags/cli-commands.ts").join("\n");
    expect(cli).toMatch(/^\s{2}megaset,$/m);
    expect(read("src/fulltags/megaset.ts").join("\n")).toContain(
      'from "../../cratedeck/src/megaset"',
    );
  });

  test("the product tabs exist and are hash-routed (one route per product)", () => {
    // the web shell renders one top-level tab per product; the router
    // parses one route per product. The nav strip (App) and the product
    // SSOT (products/shared/index.tsx PRODUCTS) are the two surfaces, keyed by
    // the router's Product union.
    const app = read("cratedeck/web/app/App.tsx").join("\n");
    for (const product of ["drives", "getdat", "fulltags", "fleet"])
      expect(app, `nav route for ${product}`).toContain(`"${product}"`);
    // #89/#90 split: PRODUCTS/PRODUCT_TABS live in shared/product-meta.tsx,
    // re-exported through shared.tsx — the pin follows the SSOT.
    const products = read(
      "cratedeck/web/products/shared/product-meta.tsx",
    ).join("\n");
    for (const product of ["drives", "getdat", "fulltags"])
      expect(products, `nav tab for ${product}`).toContain(`id: "${product}"`);
    const router = read("cratedeck/web/app/router.ts").join("\n");
    expect(router).toContain('"getdat"');
    expect(router).toContain('"fulltags"');
    // each product canvas is a page component wired into App
    expect(app).toContain("<GetDatPage");
    expect(app).toContain("<FullTagsPage");
    expect(app).toContain("<FleetPage");
    // Fleet is a CrateDeck scope, not a product: the product list has
    // exactly four rows (MegaSet graduated from a FullTags tab), and
    // Fleet rides the drives scope tabs.
    expect(
      (products.match(/id: "(?:drives|getdat|fulltags|megaset)",/g) ?? [])
        .length,
    ).toBe(4);
    expect(products).toContain('id: "fleet"');
  });

  test("every deckctl verb has an MCP twin or a registered exemption", () => {
    const tools = new Set(mcpTools());
    for (const verb of deckctlVerbs()) {
      if (tools.has(`deck_${verb}`)) continue;
      const why = VERB_EXEMPTIONS[verb] as string | undefined;
      expect(
        why,
        `deckctl verb "${verb}" has no deck_${verb} MCP tool and no exemption — add the tool (docs/surface-parity.md §3) or register §4`,
      ).toBeTruthy();
      // "open" exemptions mark known gaps — they must reference the doc
      if (why && why.startsWith("GAP")) {
        expect(why).toMatch(/see doc §3/);
      }
    }
  });

  test("every deck_* MCP tool has a deckctl verb or a registered exemption", () => {
    const verbs = new Set(deckctlVerbs());
    for (const tool of mcpTools()) {
      if (!tool.startsWith("deck_")) continue; // archive_* covered below
      const verb = tool.slice("deck_".length);
      if (verbs.has(verb)) continue;
      expect(
        TOOL_EXEMPTIONS[tool],
        `MCP tool "${tool}" has no deckctl verb and no exemption — add the verb or register §4`,
      ).toBeTruthy();
    }
  });

  test("every job kind is runnable from the UI (or exempt)", () => {
    const ui = new Set(uiJobKinds());
    for (const kind of canonicalJobKinds()) {
      if (ui.has(kind)) continue;
      expect(
        UI_KIND_EXEMPTIONS[kind],
        `job kind "${kind}" can't be enqueued from the web UI and has no exemption — add the button (docs/surface-parity.md GAP-1) or register §4`,
      ).toBeTruthy();
    }
  });

  test("job-kind lists are derived from the shared/types SSOT (no hand twins)", () => {
    // The old literal lists drifted: deckctl's kinds dropped `speedtest`,
    // deck_explain's MCP enum dropped `ingest`, while server-side routes
    // accepted it. Any new hand-copied enumeration of the kinds is a
    // regression — surfaces import JOB_KINDS / DRIVE_JOB_KINDS instead.
    // (#196: the SSOT source lives in shared/types/jobs.ts; the barrel
    // re-exports it.)
    const types = [
      ...read("cratedeck/shared/types.ts"),
      ...read("cratedeck/shared/types/jobs.ts"),
    ].join("\n");
    expect(types).toMatch(
      /export const JOB_KINDS = \[[\s\S]*?\] as const;\s+export type JobKind = \(typeof JOB_KINDS\)\[number\];/,
    );
    expect(types).toMatch(
      /export const DRIVE_JOB_KINDS = \[[\s\S]*?\] as const satisfies/,
    );
    for (const f of [
      "cratedeck/src/deckctl.ts",
      "cratedeck/src/mcp/action-tools.ts",
    ]) {
      const src = read(f).join("\n");
      // must name the SSOT symbol itself, not just import anything from
      // the module (deckctl already imports other types — a bare module
      // match would pass vacuously; mutation-verified)
      expect(src, `${f} must derive job kinds from the shared SSOT`).toMatch(
        /import \{[^}]*\b(JOB_KINDS|DRIVE_JOB_KINDS)\b[^}]*\} from "\.\.(?:\/\.\.)?\/shared\/types"/,
      );
    }
    // the old hand-copied lists must NOT come back — in ANY shape. A
    // literal array containing ≥4 job kinds inside deckctl.ts/mcp.ts is a
    // twin by construction (the SSOT array is the only place that may
    // enumerate them); mutation-verified against the original 5-kind
    // literal AND a 6-kind re-twin.
    for (const f of [
      "cratedeck/src/deckctl.ts",
      "cratedeck/src/mcp/action-tools.ts",
    ]) {
      const src = read(f).join("\n");
      // enumerate ≥3 JOB kinds in a validation position (kinds = [...],
      // JOB_KINDS.includes) — action enums like sEnum(["scan","apply",
      // "confirm","dismiss"]) are subcommand lists, not job-kind twins
      const kindListLiterals = [
        ...src.matchAll(
          /(?:const kinds = |JOB_KINDS\.includes\(|kind as )[^;\n]{0,120}/g,
        ),
      ].map((m) => m[0]);
      for (const frag of kindListLiterals)
        expect(
          frag.match(/"[a-z-]+"(?:\s*,\s*"[a-z-]+"){2,}/g) ?? [],
          `${f} hand-copies a job-kind list (${frag.slice(0, 60)}…) — derive from JOB_KINDS/DRIVE_JOB_KINDS instead`,
        ).toEqual([]);
    }
  });

  test("mutating MCP tools are flagged destructive + interlock-guarded", () => {
    // #89 split: the mutating handler table lives in mcp/action-tools.ts
    const src = readFileSync(
      join(ROOT, "cratedeck/src/mcp/action-tools.ts"),
      "utf8",
    );
    for (const tool of [
      "deck_run",
      "deck_cancel",
      "deck_booth",
      "deck_note",
      "deck_rename",
      "deck_dismiss",
    ]) {
      const verb = tool.slice("deck_".length);
      const handlers = src.split("export const DECK_ACTION_HANDLERS")[1] ?? "";
      const def =
        handlers.split(`\n  ${verb}: {`)[1]?.split(/\n\s{2}\}/)[0] ?? "";
      expect(def.length, `${tool} definition found`).toBeGreaterThan(0);
      expect(def, `${tool} must carry destructive: true`).toContain(
        "destructive: true",
      );
    }
    // the mutating surface runs the interlock guard before enqueue
    expect(src).toContain("await interlockGuard()");
  });

  test("the help SSOT is reachable from every surface", () => {
    // UI: shared/help.ts feeds the tooltips + Welcome tour (Onboard/JobsDock)
    const ui = ["cratedeck/web/ui/Onboard.tsx", "cratedeck/web/ui/JobsDock.tsx"]
      .map((f) => readFileSync(join(ROOT, f), "utf8"))
      .join("\n");
    expect(ui).toContain("../../shared/help");
    // server: GET /api/help serves the same content
    const server = ["cratedeck/src/index.ts", "cratedeck/src/api/routes.ts"]
      .map((f) => readFileSync(join(ROOT, f), "utf8"))
      .join("\n");
    expect(server).toContain('"/help"');
    // CLI: deckctl help [topic]
    expect(deckctlVerbs()).toContain("help");
    // MCP: deck_help {term?}
    expect(mcpTools()).toContain("deck_help");
    // every surface imports the SAME SSOT module — wording can't fork
    // (deckctl's help leg lives in deckctl_help.ts, the extraction)
    const deckctlHelp = readFileSync(
      join(ROOT, "cratedeck/src/deckctl/help.ts"),
      "utf8",
    );
    expect(deckctlHelp).toContain('../shared/help"');
    // #89 split: the help handler lives in mcp/read-tools.ts
    const mcp = readFileSync(
      join(ROOT, "cratedeck/src/mcp/read-tools.ts"),
      "utf8",
    );
    expect(mcp).toContain('../shared/help"');
  });

  test("note dismissal is reachable from the UI and the agent surfaces", () => {
    // UI: the timeline card dismiss button
    const timeline = readFileSync(
      join(ROOT, "cratedeck/web/products/cratedeck/TimelineTab.tsx"),
      "utf8",
    );
    expect(timeline).toContain("/dismiss");
    // CLI: deckctl dismiss
    expect(deckctlVerbs()).toContain("dismiss");
    // MCP: deck_dismiss
    expect(mcpTools()).toContain("deck_dismiss");
  });

  test("archive tools stay readonly (the sqlite handle never opens rw)", () => {
    const src = readFileSync(join(ROOT, "cratedeck/src/archive.ts"), "utf8");
    expect(src).toContain("readonly: true");
    expect(src).not.toMatch(/readonly:\s*false/);
  });

  test("the exemption registry stays honest: every entry cites a live surface string", () => {
    // an exemption for a verb/tool that no longer exists is stale — prune it
    const verbs = new Set(deckctlVerbs());
    for (const v of Object.keys(VERB_EXEMPTIONS)) {
      expect(
        verbs.has(v),
        `stale verb exemption: "${v}" no longer exists`,
      ).toBe(true);
    }
    const tools = new Set(mcpTools());
    for (const t of Object.keys(TOOL_EXEMPTIONS)) {
      expect(
        tools.has(t),
        `stale tool exemption: "${t}" no longer exists`,
      ).toBe(true);
    }
    for (const k of Object.keys(UI_KIND_EXEMPTIONS)) {
      expect(
        canonicalJobKinds().includes(k),
        `stale UI-kind exemption: "${k}" is not a job kind`,
      ).toBe(true);
    }
  });
  test("deckctl and MCP derive their shared capability census from one map", () => {
    const deckctlTwinVerbs = deckctlVerbs().filter((verb) => verb !== "stop");
    expect(deckctlTwinVerbs).toEqual(
      DECK_MCP_SURFACES.map((surface) => surface.verb).toSorted(),
    );
    expect(mcpTools().filter((tool) => tool.startsWith("deck_"))).toEqual(
      DECK_MCP_SURFACES.map((surface) => surface.tool).toSorted(),
    );
  });
});
