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
 * reads (never hand-copied): src/test-support/surface-producers.ts.
 *
 * Scanned prose: docs/ (non-archive), src/deck/*.md, the repo READMEs,
 * and the SKILL.md files under .claude/skills -- the teaching surfaces.
 * Planned commands stay honest via an allowlist with a reason per entry;
 * every entry must stay used.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  canonicalJobKinds,
  deckctlVerbs,
  megadjCommands,
  mcpTools,
} from "../test-support/surface-producers";

const ROOT = join(import.meta.dir, "..", "..");

/* ---------- prose inventory ---------- */

function proseFiles(): string[] {
  const out: string[] = [];
  const visit = (dir: string, skipArchive: boolean): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skipArchive && (entry.name === "archive" || entry.name === "node_modules")) continue;
      const p = join(dir, entry.name);
      if (statSync(p).isDirectory()) visit(p, skipArchive);
      else if (p.endsWith(".md")) out.push(p);
    }
  };
  visit(join(ROOT, "docs"), true);
  visit(join(ROOT, ".claude", "skills"), false);
  for (const f of ["src/deck/deckctl.md", "src/deck/README.md", "plugin/README.md"]) {
    if (existsSync(join(ROOT, f))) out.push(join(ROOT, f));
  }
  return out;
}

/* ---------- allowlist: file path, then name and reason ---------- */

interface AllowEntry {
  name: string;
  reason: string;
}

const ALLOWED: Readonly<Record<string, readonly AllowEntry[]>> = {
  "docs/fulltags/fulltags-v3-rebench-and-build-plan-2026-09-29.md": [
    { name: "analyze", reason: "v3 planned verb — WS2 B2.3 #358" },
  ],
  "docs/FEATURES.md": [],
  "docs/fulltags/v4-remaining-plan-2026-10-01.md": [],
};

/* ---------- scanning ---------- */

interface Violation {
  file: string;
  name: string;
}

function scan(): { violations: Violation[]; taught: Violation[] } {
  const verbs = new Set(megadjCommands());
  const dverbs = new Set(deckctlVerbs());
  const tools = new Set(mcpTools());
  const kinds = new Set(canonicalJobKinds());

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
    for (const m of text.matchAll(/`((?:deck|archive|getdat|megaset)_[a-z_]+)`/g)) {
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
    expect(megadjCommands().length).toBeGreaterThan(30);
    expect(deckctlVerbs().length).toBeGreaterThan(15);
    expect(mcpTools().length).toBeGreaterThan(30);
    expect(canonicalJobKinds().length).toBeGreaterThan(8);
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
        const stillTaught = taught.some((v) => v.file === file && v.name.endsWith(suffix));
        expect(
          stillTaught,
          `allowlist entry no longer taught by the docs -- delete it: ${file} :: ${entry.name} -- ${entry.reason}`,
        ).toBe(true);
      }
    }
  });
});
