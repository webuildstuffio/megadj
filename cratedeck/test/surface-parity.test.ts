import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  return [...new Set(verbs)].sort();
}

/** MCP tool set: tool keys in mcp.ts's table + the extracted archive_tools
 *  module (both are part of the server's tool census; the module's keys sit
 *  one level deeper — 4 spaces — inside its factory). */
function mcpTools(): string[] {
  const files = ["cratedeck/src/mcp.ts", "cratedeck/src/archive_tools.ts"];
  const tools = files
    .flatMap((f) =>
      read(f).map((l) => l.match(/^\s{2,4}((?:deck|archive)_[a-z_]+):/)),
    )
    .map((m) => (m ? m[1] : undefined))
    .filter((v): v is string => v !== undefined);
  return [...new Set(tools)].sort();
}

/** UI job-enqueue surface: every kind the web can POST to /jobs. */
function uiJobKinds(): string[] {
  const kinds: string[] = [];
  for (const file of [
    "cratedeck/web/products/cratedeck/DrivePage.tsx",
    "cratedeck/web/products/cratedeck/VerifyTab.tsx",
  ]) {
    for (const line of read(file)) {
      for (const m of line.matchAll(/run\("([a-z]+)"\)/g))
        if (m[1]) kinds.push(m[1]);
      for (const m of line.matchAll(/kind:\s*"([a-z]+)"/g))
        if (m[1]) kinds.push(m[1]);
    }
  }
  return [...new Set(kinds)].sort();
}

/** The canonical job-kind set: deckctl's kinds list (the SSOT). */
function canonicalJobKinds(): string[] {
  const kindsLine = read("cratedeck/src/deckctl.ts").find((l) =>
    /^\s*const kinds = \[/.test(l),
  );
  const listed = kindsLine?.match(/\[([^\]]+)\]/)?.[1] ?? "";
  const kinds = listed
    .split(",")
    .map((s) => s.trim().replace(/['"]/g, ""))
    .filter(Boolean);
  if (kinds.length === 0)
    throw new Error("could not parse job kinds from deckctl.ts");
  return [...new Set(kinds)].sort();
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
  archive_sweep:
    "A3 (also folded into deckctl prep via the D30 digest section)",
};

/** UI job buttons exempt from existing (none today; mirror closes GAP-1). */
const UI_KIND_EXEMPTIONS: Record<string, string> = {};

// ---- tests ----------------------------------------------------------------

describe("surface parity (docs/surface-parity.md)", () => {
  test("census matches the doc's §1 table", () => {
    // keep this file and the doc honest about each other
    const verbs = deckctlVerbs();
    const tools = mcpTools();
    // 20 verbs (help + dismiss joined rev 4); 19 deck_* + 15 archive_*
    // = 34 MCP tools (source census; mcpTools() dedupes).
    expect(verbs.length).toBeGreaterThanOrEqual(20);
    expect(tools.length).toBeGreaterThanOrEqual(34);
    const doc = readFileSync(join(ROOT, "docs/surface-parity.md"), "utf8");
    expect(doc).toContain("| 20 verbs |");
    expect(doc).toContain("| 34 tools |");
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
    // exactly three rows, and Fleet rides the drives scope tabs.
    expect(
      (products.match(/id: "(?:drives|getdat|fulltags)",/g) ?? []).length,
    ).toBe(3);
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

  test("mutating MCP tools are flagged destructive + interlock-guarded", () => {
    const src = readFileSync(join(ROOT, "cratedeck/src/mcp.ts"), "utf8");
    for (const tool of [
      "deck_run",
      "deck_cancel",
      "deck_note",
      "deck_rename",
      "deck_dismiss",
    ]) {
      const def = src.split(`${tool}: {`)[1]?.split(/\n\s{2}\}/)[0] ?? "";
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
    const server = readFileSync(join(ROOT, "cratedeck/src/index.ts"), "utf8");
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
});
