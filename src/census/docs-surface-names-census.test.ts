/**
 * docs-surface-names-census.test.ts - the names half of the docs-vs-code
 * gate. The paths census (#58) catches stale repo paths; this catches
 * stale SURFACE NAMES: a CLI verb, deckctl verb, MCP tool, or job kind
 * that the docs/skills teach but the producer tables no longer define
 * (the archive_set_build name survived its Sep 15 rename in four docs
 * for two days; "megadj setbuild" survived in a skill for two more --
 * none of it was mechanically visible).
 *
 * Names are DERIVED from the same producers the surface-parity census
 * reads (never hand-copied): src/command-registry.ts + MAINTENANCE_VERBS,
 * cratedeck/src/deckctl.ts DECK_COMMANDS + PRE_SERVER_VERBS, the tool
 * keys in mcp.ts / archive_tools.ts / getdat_tools.ts + MCP_SURFACES,
 * and JOB_KINDS.
 *
 * Scanned prose: docs/ (non-archive), cratedeck/*.md, the repo READMEs,
 * and the SKILL.md files under .claude/skills -- the teaching surfaces.
 * Planned commands stay honest via an allowlist with a reason per entry;
 * every entry must stay used.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

/* ---------- producers ---------- */

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function megadjVerbs(): string[] {
  const verbs: string[] = [];
  for (const m of read("src/command-registry.ts").matchAll(
    /name: "([a-z][a-z-]+)"/g,
  )) {
    const v = m[1];
    if (v) verbs.push(v);
  }
  // #235: the maintenance verb list is gone — the rb-*/shelf-hygiene
  // verbs derive from the domain command records like every other family.
  for (const f of [
    "src/shelf/cli-commands.ts",
    "src/rekordbox/cli-commands.ts",
  ]) {
    const src = read(f);
    for (const tbl of src.matchAll(
      /export const \w+_COMMANDS(?::[^=]*)?= \{[\s\S]*?\n\};/g,
    )) {
      for (const m of (tbl[0] ?? "").matchAll(/"([a-z-]+)":/g)) {
        const v = m[1];
        if (v) verbs.push(v);
      }
    }
  }
  return [...new Set(verbs)].toSorted();
}

function deckctlVerbs(): string[] {
  const src = read("cratedeck/src/deckctl.ts");
  const verbs: string[] = [];
  const start = src.indexOf("DECK_COMMANDS");
  const end = src.indexOf("};", start);
  if (start !== -1 && end > start) {
    const table = src.slice(start, end);
    for (const m of table.matchAll(/\n  ([a-z-]+):/g)) {
      const v = m[1];
      if (v) verbs.push(v);
    }
  }
  const preLine = src
    .split("\n")
    .find((l) => l.includes("PRE_SERVER_VERBS = ["));
  if (preLine) {
    const inner = preLine.match(/\[([^\]]*)\]/);
    if (inner && inner[1]) {
      for (const tok of inner[1].split(",")) {
        const v = tok.trim().replaceAll('"', "");
        if (v) verbs.push(v);
      }
    }
  }
  return [...new Set(verbs)].toSorted();
}

function mcpTools(): string[] {
  const tools: string[] = [];
  const files = [
    "cratedeck/src/mcp.ts",
    "cratedeck/src/archive_tools.ts",
    "cratedeck/src/getdat_tools.ts",
  ];
  for (const f of files) {
    for (const line of read(f).split("\n")) {
      const m = line.match(/^ {2,4}((?:deck|archive|getdat|megaset)_[a-z_]+):/);
      if (m && m[1]) tools.push(m[1]);
    }
  }
  const surfacesFile = [
    "cratedeck/src/mcp_surfaces.ts",
    "cratedeck/src/mcp.ts",
  ].find((f) => existsSync(join(ROOT, f)));
  if (surfacesFile) {
    for (const m of read(surfacesFile).matchAll(/tool: "([a-z_]+)"/g)) {
      const t = m[1];
      if (t) tools.push(t);
    }
  }
  return [...new Set(tools)].toSorted();
}

function jobKinds(): string[] {
  const src = read("cratedeck/shared/types/jobs.ts");
  const block = src.match(/export const JOB_KINDS = \[([^\]]*)\]/);
  const kinds: string[] = [];
  if (block && block[1]) {
    for (const m of block[1].matchAll(/"([a-z-]+)"/g)) {
      const k = m[1];
      if (k) kinds.push(k);
    }
  }
  return kinds;
}

/* ---------- prose inventory ---------- */

function proseFiles(): string[] {
  const out: string[] = [];
  const visit = (dir: string, skipArchive: boolean): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        skipArchive &&
        (entry.name === "archive" || entry.name === "node_modules")
      )
        continue;
      const p = join(dir, entry.name);
      if (statSync(p).isDirectory()) visit(p, skipArchive);
      else if (p.endsWith(".md")) out.push(p);
    }
  };
  visit(join(ROOT, "docs"), true);
  visit(join(ROOT, ".claude", "skills"), false);
  for (const f of [
    "cratedeck/deckctl.md",
    "cratedeck/README.md",
    "plugin/README.md",
  ]) {
    if (existsSync(join(ROOT, f))) out.push(join(ROOT, f));
  }
  return out;
}

/* ---------- allowlist: file path, then name and reason ---------- */

interface AllowEntry {
  name: string;
  reason: string;
}

const ALLOWED: Readonly<Record<string, readonly AllowEntry[]>> = {};

/* ---------- scanning ---------- */

interface Violation {
  file: string;
  name: string;
}

function scan(): { violations: Violation[]; taught: Violation[] } {
  const verbs = new Set(megadjVerbs());
  const dverbs = new Set(deckctlVerbs());
  const tools = new Set(mcpTools());
  const kinds = new Set(jobKinds());

  const violations: Violation[] = [];
  const taught: Violation[] = [];

  for (const file of proseFiles()) {
    const rel = relative(ROOT, file);
    const text = readFileSync(file, "utf8");
    const allowed = ALLOWED[rel] ?? [];

    // every taught name lands here; "allowed" marks it exempt from
    // violations while keeping it visible for the allowlist-liveness test
    const record = (name: string, ok: boolean, kind: string): void => {
      const full = `${kind}:${name}`;
      if (!ok && !allowed.some((a) => a.name === name)) {
        violations.push({ file: rel, name: full });
      }
      taught.push({ file: rel, name: full });
    };

    // "megadj verb" / "deckctl verb" invocations in backticks
    const invoke = /`(megadj|deckctl) ([a-z][a-z-]+)[ `).,;]/g;
    for (const m of text.matchAll(invoke)) {
      const cmd = m[1] ?? "";
      const verb = m[2] ?? "";
      if (cmd === "megadj") record(verb, verbs.has(verb), "megadj");
      else record(verb, dverbs.has(verb), "deckctl");
    }
    // MCP-style tool names in backticks
    for (const m of text.matchAll(
      /`((?:deck|archive|getdat|megaset)_[a-z_]+)`/g,
    )) {
      const t = m[1] ?? "";
      record(t, tools.has(t), "tool");
    }
    // job kinds taught in Kinds: lists
    for (const m of text.matchAll(/Kinds: ?([a-z0-9 `·/]+)/g)) {
      const list = m[1] ?? "";
      for (const k of list.matchAll(/`([a-z-]+)`/g)) {
        const kind = k[1] ?? "";
        record(kind, kinds.has(kind), "kind");
      }
    }
  }
  return { violations, taught };
}

/* ---------- tests ---------- */

describe("docs surface-names census (the names half of docs-vs-code)", () => {
  test("the producers actually define the surfaces", () => {
    expect(megadjVerbs().length).toBeGreaterThan(30);
    expect(deckctlVerbs().length).toBeGreaterThan(15);
    expect(mcpTools().length).toBeGreaterThan(30);
    expect(jobKinds().length).toBeGreaterThan(8);
  });

  test("every taught megadj/deckctl verb, MCP tool, and job kind is real", () => {
    const { violations } = scan();
    const lines = violations.map((v) => `  ${v.file}: ${v.name}`);
    expect(
      violations,
      `docs/skills teach surface names the producers don't define:\n${lines.join("\n")}`,
    ).toEqual([]);
  });

  test("every allowlist entry is still taught (no stale exemptions)", () => {
    const { taught } = scan();
    for (const [file, entries] of Object.entries(ALLOWED)) {
      for (const entry of entries) {
        const suffix = `:${entry.name}`;
        const stillTaught = taught.some(
          (v) => v.file === file && v.name.endsWith(suffix),
        );
        expect(
          stillTaught,
          `allowlist entry no longer taught by the docs -- delete it: ${file} :: ${entry.name} -- ${entry.reason}`,
        ).toBe(true);
      }
    }
  });
});
