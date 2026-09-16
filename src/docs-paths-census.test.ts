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
  "docs/fulltags/fulltags-roadmap.md": {
    // rev-6 re-gate note describes the deleted bar-lag readout as it
    // was (the #42 split later moved the probes to sibling modules).
    "fulltags/src/analysis.ts":
      "historical rev line (deleted tempoFromBeatGrid, former module path)",
    // §4 lesson 7 names the deleted shim's fold-in + CUT dates (#93);
    // recoverable from git history, referenced as history on purpose.
    "tools/fix-years.ts":
      "historical retirement note (deleted shim, #93 CUT)",
  },
  "docs/surface-parity.md": {
    // rev-9/rev-10 lines describe the PAST web restructure ("same
    // surfaces, new paths (...)") — historical rev prose, deliberately
    // not rewritten.
    "web/app/App.tsx": "historical rev line (rev-9 restructure note)",
    "web/products/shared.tsx": "historical rev line (rev-9 restructure note)",
  },
  "docs/megaset/08-audit-and-plan.md": {
    // Dated 2026-09-13 audit: names the setbuild.* layout as it was when
    // written; the #56 rename executed 2026-09-15.
    "web/products/fulltags/SimilarTab.tsx":
      "dated scope block (pre-rename layout, rename executed)",
    "cratedeck/src/setbuild.ts": "dated audit text (rename executed)",
    "cratedeck/shared/setbuild.ts": "dated audit text (rename executed)",
    "src/fulltags/setbuild.ts": "dated audit text (rename executed)",
  },
  "docs/archive/set-09-migration-plan-2026-09-15.md": {
    // The dated migration plan names setbuild.* paths throughout; the
    // rename EXECUTED 2026-09-15 (megaset is canonical), so the doc's
    // old-name references are historical plan text, not staleness.
    // (Archived 2026-09-15 in the docs→GitHub SSOT move.)
    "cratedeck/src/setbuild.ts": "dated migration plan (rename executed)",
    "cratedeck/shared/setbuild.ts": "dated migration plan (rename executed)",
    "cratedeck/test/setbuild.test.ts": "dated migration plan (rename executed)",
    "cratedeck/test/archive-setbuild-surface.test.ts":
      "dated migration plan (rename executed)",
    "src/fulltags/setbuild.ts": "dated migration plan (rename executed)",
    "fulltags/intake-cue-postmortem.md":
      "relative link inside the planned-docs table (resolves from docs/)",
  },
  "docs/archive/set-04-sequencing-benchmarks-2026-09-14.md": {
    "cratedeck/src/setbuild.ts": "dated benchmark doc (rename executed)",
  },
  "docs/megaset/02-architecture.md": {
    // Dated architecture diagram naming the setbuild layout as it was
    // when written — historical structure text.
    "cratedeck/src/setbuild.ts": "dated architecture diagram (rename executed)",
    "cratedeck/shared/setbuild.ts":
      "dated architecture diagram (rename executed)",
    "src/fulltags/setbuild.ts": "dated architecture diagram (rename executed)",
  },
  // docs/usb-sync-log.md is INTENTIONALLY GITIGNORED (.gitignore) — the
  // local append-only operator evidence log. Docs reference it as a
  // local-only store by design; the missing file is the convention, not
  // staleness.
  "docs/README.md": {
    "fulltags/intake-cue-postmortem.md":
      "relative link — resolves correctly from docs/ to docs/fulltags/…",
    "web/ui/DESIGN-NOTES.md": "cratedeck/web-scoped path (link is correct)",
    "web/products/fulltags/DESIGN-NOTES.md":
      "cratedeck/web-scoped path (link is correct)",
    "docs/usb-sync-log.md":
      "intentionally gitignored local operator log (.gitignore)",
  },
  "docs/FEATURES.md": {
    "docs/usb-sync-log.md":
      "intentionally gitignored local operator log (.gitignore)",
  },
  "docs/product-state-2026-09-07.md": {
    "docs/usb-sync-log.md":
      "intentionally gitignored local operator log (.gitignore)",
  },
  "docs/agent-playbook.md": {
    "docs/usb-sync-log.md":
      "intentionally gitignored local operator log (.gitignore)",
    "fulltags/test/analysis.test.ts":
      "past-tense perf note ('the former … monolith')",
  },
  "docs/runbooks/0a-evacuate-extra.md": {
    "docs/usb-sync-log.md":
      "intentionally gitignored local operator log (.gitignore)",
  },
  "docs/runbooks/0b-cold-backup.md": {
    "docs/usb-sync-log.md":
      "intentionally gitignored local operator log (.gitignore)",
  },
  "docs/runbooks/0c-orphan-verdict.md": {
    "docs/usb-sync-log.md":
      "intentionally gitignored local operator log (.gitignore)",
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

    // set findings: no volatile concurrent-agent WIP status
    const findings = readFileSync(
      join(ROOT, "docs/megaset/10-findings.md"),
      "utf8",
    );
    expect(findings).not.toMatch(/do not touch; wait/u);
  });
});
