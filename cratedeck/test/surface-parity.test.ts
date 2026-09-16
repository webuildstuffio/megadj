import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JOB_KINDS } from "../shared/types";
import { DECK_MCP_SURFACES } from "../src/mcp_surfaces";

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

/** deckctl verb set: the switch in main(), e.g. `case "status":`, plus the
 *  PRE_SERVER_VERBS list (help works before the server boots — still a
 *  first-class verb, documented in usage). */
function deckctlVerbs(): string[] {
  const src = read("cratedeck/src/deckctl.ts");
  const verbs = src
    .map((l) => l.match(/^\s*case "([a-z-]+)":/))
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
  const verbs: string[] = [];
  const registry = read("src/command-registry.ts").join("\n");
  for (const match of registry.matchAll(/name: "([a-z][a-z-]+)"/g)) {
    if (match[1]) verbs.push(match[1]);
  }
  const maintenance = read("src/shared/maintenance-cmds.ts").join("\n");
  const family = maintenance
    .match(/export const MAINTENANCE_VERBS = \[([\s\S]*?)\] as const/)?.[1]
    ?.matchAll(/"([a-z-]+)"/g);
  if (family) for (const match of family) if (match[1]) verbs.push(match[1]);
  return [...new Set(verbs)].toSorted();
}

/** HTTP API path census. Route literals are intentionally derived from the
 * dispatchers: exact-path table keys (`"/status": …`) in api_routes.ts,
 * top-level `route ===` literals, drive subpaths get the /drives/:id
 * prefix, and archive handlers come from archive_routes.ts. */
function httpApiRoutes(): string[] {
  // route families live in their own modules since the #42 split; the
  // census reads ALL of them so a literal can't hide in a new file
  const index = [
    "cratedeck/src/index.ts",
    "cratedeck/src/api_routes.ts",
    "cratedeck/src/drive_routes.ts",
    "cratedeck/src/fleet_routes.ts",
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
  const archive = read("cratedeck/src/archive_routes.ts").join("\n");
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
  const files = ["cratedeck/src/mcp.ts", "cratedeck/src/archive_tools.ts"];
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
 *  `/${kind}` construction in products/shared.tsx; IntakeTab posts the
 *  fixed `ingest` job. All spellings are censused. */
function uiJobKinds(): string[] {
  const kinds: string[] = [];
  for (const file of [
    "cratedeck/web/products/cratedeck/DrivePage.tsx",
    "cratedeck/web/products/cratedeck/VerifyTab.tsx",
    "cratedeck/web/products/cratedeck/HygieneTab.tsx",
    "cratedeck/web/products/cratedeck/FixesTab.tsx",
    "cratedeck/web/products/getdat/IntakeTab.tsx",
    "cratedeck/web/products/shared.tsx",
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
    }
  }
  return [...new Set(kinds)].toSorted();
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
 *  nothing from the enclosing test. */
const censusCell = (n: number, unit: string): RegExp =>
  new RegExp(`\\|\\s+${n} ${unit}[^|]*\\|`);

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
    // src/command-registry.ts (usage.ts only renders); this census now
    // reads BOTH directions off the registry — dispatch census
    // (megadjCommands) vs doc census (COMMAND_DOCS) must agree exactly,
    // so a command can neither lose its help block nor gain an
    // undocumented twin.
    const registry = read("src/command-registry.ts").join("\n");
    const usage = read("src/usage.ts").join("\n");
    expect(usage).toContain("command-registry");
    const docNames = [...registry.matchAll(/name: "([a-z][a-z-]+)"/g)].map(
      (m) => m[1] ?? "",
    );
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
    const cli = read("src/cli-commands-analysis.ts").join("\n");
    expect(cli).toMatch(/^\s{2}megaset,$/m);
    expect(read("src/fulltags/megaset.ts").join("\n")).toContain(
      'from "../../cratedeck/src/megaset"',
    );
  });

  test("the product tabs exist and are hash-routed (one route per product)", () => {
    // the web shell renders one top-level tab per product; the router
    // parses one route per product. The nav strip (App) and the product
    // SSOT (products/shared.tsx PRODUCTS) are the two surfaces, keyed by
    // the router's Product union.
    const app = read("cratedeck/web/app/App.tsx").join("\n");
    for (const product of ["drives", "getdat", "fulltags", "fleet"])
      expect(app, `nav route for ${product}`).toContain(`"${product}"`);
    const products = read("cratedeck/web/products/shared.tsx").join("\n");
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

  test("job-kind lists are derived from the shared/types.ts SSOT (no hand twins)", () => {
    // The old literal lists drifted: deckctl's kinds dropped `speedtest`,
    // deck_explain's MCP enum dropped `ingest`, while server-side routes
    // accepted it. Any new hand-copied enumeration of the kinds is a
    // regression — surfaces import JOB_KINDS / DRIVE_JOB_KINDS instead.
    const types = read("cratedeck/shared/types.ts").join("\n");
    expect(types).toMatch(
      /export const JOB_KINDS = \[[\s\S]*?\] as const;\s+export type JobKind = \(typeof JOB_KINDS\)\[number\];/,
    );
    expect(types).toMatch(
      /export const DRIVE_JOB_KINDS = \[[\s\S]*?\] as const satisfies/,
    );
    for (const f of ["cratedeck/src/deckctl.ts", "cratedeck/src/mcp.ts"]) {
      const src = read(f).join("\n");
      // must name the SSOT symbol itself, not just import anything from
      // the module (deckctl already imports other types — a bare module
      // match would pass vacuously; mutation-verified)
      expect(src, `${f} must derive job kinds from the shared SSOT`).toMatch(
        /import \{[^}]*\b(JOB_KINDS|DRIVE_JOB_KINDS)\b[^}]*\} from "\.\.\/shared\/types"/,
      );
    }
    // the old hand-copied lists must NOT come back — in ANY shape. A
    // literal array containing ≥4 job kinds inside deckctl.ts/mcp.ts is a
    // twin by construction (the SSOT array is the only place that may
    // enumerate them); mutation-verified against the original 5-kind
    // literal AND a 6-kind re-twin.
    for (const f of ["cratedeck/src/deckctl.ts", "cratedeck/src/mcp.ts"]) {
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
    const src = readFileSync(join(ROOT, "cratedeck/src/mcp.ts"), "utf8");
    for (const tool of [
      "deck_run",
      "deck_cancel",
      "deck_note",
      "deck_rename",
      "deck_dismiss",
    ]) {
      const verb = tool.slice("deck_".length);
      const handlers =
        src.split("const DECK_HANDLERS: Record<DeckMcpVerb, ToolDef> = {")[1] ??
        "";
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
    const server = ["cratedeck/src/index.ts", "cratedeck/src/api_routes.ts"]
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
      join(ROOT, "cratedeck/src/deckctl_help.ts"),
      "utf8",
    );
    expect(deckctlHelp).toContain('../shared/help"');
    const mcp = readFileSync(join(ROOT, "cratedeck/src/mcp.ts"), "utf8");
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
