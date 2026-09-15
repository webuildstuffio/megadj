/**
 * docs-paths-census.test.ts — the reusable #58 docs check: backticked
 * repo paths in current docs must point at real files, and the specific
 * staleness classes #58 fixed cannot return. This replaces the
 * hand-maintained "check every doc for pre-refactor paths" inventory with
 * a mechanical gate.
 *
 * Scoping: docs like `docs/cratedeck/acceptance.md` describe the
 * `cratedeck/` package and cite paths relative to it — the validator
 * resolves candidates against repo root AND the owning package root
 * before calling a path stale.
 *
 * Historical text (rev lines, dated snapshots, archived docs, migration
 * plans describing the CURRENT state) is exempt via the per-path
 * allowlist below — every entry carries its reason.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** Backticked repo-looking paths: `src/...`, `tools/...`, `cratedeck/...`,
 *  `fulltags/...`, `web/...`, `plugin/...`, `docs/...` + known extension. */
const PATH_RE =
  /`((?:src|tools|fulltags|cratedeck|plugin|docs|web)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|py|css|json|sh|toml|md))`/gu;

/** Package roots a doc may cite paths against (its own subtree). */
const PACKAGE_ROOTS = ["cratedeck", "fulltags", "plugin", "tools"];

/** allowlist: file → { stalePath → reason }. Every entry needs a reason
 *  that explains why the old path is LEGITIMATE text. */
const ALLOWED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "docs/surface-parity.md": {
    // rev-9/rev-10 lines describe the PAST web restructure ("same
    // surfaces, new paths (...)") — historical rev prose, deliberately
    // not rewritten.
    "web/app/App.tsx": "historical rev line (rev-9 restructure note)",
    "web/products/shared.tsx": "historical rev line (rev-9 restructure note)",
  },
  "docs/megaset/08-audit-and-plan.md": {
    // Dated 2026-09-13 scope block naming the setbuild-era layout; the
    // paths flip with #56's rename, not before.
    "web/products/fulltags/SimilarTab.tsx":
      "dated scope block (setbuild-era, flips with #56)",
  },
  "docs/megaset/09-migration-plan.md": {
    // The migration plan describes the CURRENT setbuild→megaset future
    // state; its megaset paths are the plan's TARGETS, not staleness.
    "cratedeck/src/megaset.ts": "migration plan target path (issue #56)",
    "cratedeck/shared/megaset.ts": "migration plan target path (issue #56)",
    "cratedeck/test/megaset.test.ts": "migration plan target path (issue #56)",
    "cratedeck/test/archive-megaset-surface.test.ts":
      "migration plan target path (issue #56)",
    "src/fulltags/megaset.ts": "migration plan target path (issue #56)",
    "fulltags/intake-cue-postmortem.md":
      "relative link inside the planned-docs table (resolves from docs/)",
  },
  "docs/README.md": {
    "fulltags/intake-cue-postmortem.md":
      "relative link — resolves correctly from docs/ to docs/fulltags/…",
    "web/ui/DESIGN-NOTES.md": "cratedeck/web-scoped path (link is correct)",
    "web/products/fulltags/DESIGN-NOTES.md":
      "cratedeck/web-scoped path (link is correct)",
  },
  // docs/archive/ is skipped by the walker, so the archived
  // src-layout-refactor receipt needs no exemptions — its historical
  // paths are out of census scope by design.
  "docs/usb-sync-log.md": {
    "cratedeck/src/fleet.ts": "dated log entry (Sep 8) — historical evidence",
  },
  "docs/agent-playbook.md": {
    "fulltags/test/analysis.test.ts":
      "past-tense perf note ('the former … monolith')",
  },
};

function docFiles(): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "archive" || entry.name === "node_modules") continue;
      const p = join(dir, entry.name);
      if (statSync(p).isDirectory()) visit(p);
      else if (p.endsWith(".md")) out.push(p);
    }
  };
  visit(join(ROOT, "docs"));
  return out;
}

function stalePathsFor(
  doc: string,
  text: string,
): {
  path: string;
  reason?: string;
}[] {
  const stale: { path: string; reason?: string }[] = [];
  const rel = relative(ROOT, doc);
  const allowed = ALLOWED[rel] ?? {};
  // Which package subtree does this doc describe? (acceptance.md and the
  // cratedeck/* docs cite cratedeck/-relative paths)
  const packageRoot = PACKAGE_ROOTS.find((pkg) =>
    rel.startsWith(`docs/${pkg}/`),
  );
  for (const m of text.matchAll(PATH_RE)) {
    const p = m[1];
    if (!p) continue;
    if (allowed[p] !== undefined) {
      stale.push({ path: p, reason: allowed[p] });
      continue;
    }
    const candidates = packageRoot
      ? [join(ROOT, p), join(ROOT, packageRoot, p)]
      : [join(ROOT, p)];
    if (!candidates.some((c) => existsSync(c))) stale.push({ path: p });
  }
  return stale;
}

describe("docs paths census (issue #58 regression gate)", () => {
  const docs = docFiles();

  test("the census actually walks the docs tree", () => {
    expect(docs.length).toBeGreaterThan(10);
  });

  test("every backticked repo path in current docs resolves (or is allowlisted)", () => {
    const problems: string[] = [];
    for (const doc of docs) {
      const rel = relative(ROOT, doc);
      const text = readFileSync(doc, "utf8");
      for (const s of stalePathsFor(doc, text)) {
        if (s.reason === undefined) problems.push(`  ${rel}: ${s.path}`);
      }
    }
    expect(
      problems,
      `stale repo paths in current docs — fix the doc or allowlist with a reason:\n${problems.join("\n")}`,
    ).toEqual([]);
  });

  test("every allowlist entry is still used (no stale exemptions)", () => {
    const used = new Set<string>();
    for (const doc of docs) {
      const rel = relative(ROOT, doc);
      const text = readFileSync(doc, "utf8");
      for (const s of stalePathsFor(doc, text))
        if (s.reason) used.add(`${rel}::${s.path}`);
    }
    const unused: string[] = [];
    for (const [file, entries] of Object.entries(ALLOWED)) {
      for (const [path, reason] of Object.entries(entries)) {
        if (!used.has(`${file}::${path}`))
          unused.push(`  ${file}::${path} — ${reason}`);
      }
    }
    expect(
      unused,
      "allowlist entries the docs no longer contain — delete them:",
    ).toEqual(unused.length ? unused : []);
  });

  test("the #58 classes stay fixed", () => {
    // acceptance.md: three hardware checks + release policy, not "four"
    const acceptance = readFileSync(
      join(ROOT, "docs/cratedeck/acceptance.md"),
      "utf8",
    );
    expect(acceptance).toMatch(/three hardware checks/u);
    expect(acceptance).not.toMatch(/four hardware checks/u);
    expect(acceptance).toMatch(/issue #29/u);

    // deckctl.md: no narrative "only mutating" list (that list drifts; the
    // census/registry is the source of truth)
    const deckctl = readFileSync(join(ROOT, "cratedeck/deckctl.md"), "utf8");
    expect(deckctl).not.toMatch(/only mutating/u);

    // megaset findings: no volatile concurrent-agent WIP status
    const findings = readFileSync(
      join(ROOT, "docs/megaset/10-findings.md"),
      "utf8",
    );
    expect(findings).not.toMatch(/do not touch; wait/u);
  });
});
