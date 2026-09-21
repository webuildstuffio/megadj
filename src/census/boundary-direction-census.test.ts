/**
 * boundary-direction-census.test.ts — #222: the src ↔ cratedeck seam rule,
 * executable. The old one-way guarantee ("cratedeck/* never imports src/")
 * died with #193's fold and regrew in both directions for months because no
 * tripwire held it. This census pins the POST-#222 rule:
 *
 *   src and cratedeck may import each other ONLY through the sanctioned
 *   leaf (src/shared/leaf/{guards,fmt,vector-space,fixes}) plus the
 *   declared seam modules enumerated in ALLOWED_CROSSINGS below. Anything
 *   else crossing the boundary is a red build — #225A (shared-only fold)
 *   retires rows from this list one commit at a time until it is empty.
 *
 * Form: import-literal scan (madge would also work, but the literal form
 * names the exact file:line and is trivially diffable in review).
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, type Stats } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

/** Import specifiers (normalized to repo-relative module paths) that MAY
 *  cross the src ↔ cratedeck boundary, each with its owner + retirement
 *  plan. Every row must name the issue that kills it. */
const ALLOWED_CROSSINGS: Readonly<Record<string, string>> = {
  // ---- the sanctioned leaf (src/shared/leaf/*) — permanent unless #225A
  // folds cratedeck/shared wholesale, in which case these imports die too
  "src/shared/leaf/guards": "#225A retire or keep as the leaf",
  "src/shared/leaf/fmt": "#225A retire or keep as the leaf",
  "src/shared/leaf/vector-space": "#225A retire or keep as the leaf",
  "src/shared/leaf/fixes": "#225A retire or keep as the leaf",
  // ---- src → cratedeck/src seams (config/archive/megaset/server): #225A
  "cratedeck/src/config": "#225A shared-only fold",
  "cratedeck/src/archive": "#225A shared-only fold",
  "cratedeck/src/megaset/engine": "#225A shared-only fold",
  "cratedeck/src/server-port": "#225A shared-only fold",
  // ---- the remaining cratedeck/shared declared leaves (AGENTS.md pins
  // types.ts as the declared import leaf; hygiene/ledger-freshness are the
  // same class) — #225A folds or re-homes these
  "cratedeck/shared/types": "#225A shared-only fold (declared leaf)",
  "cratedeck/shared/hygiene": "#225A shared-only fold",
  "cratedeck/shared/dump":
    "#225A shared-only fold (dump contract, used by src/archive/dump-ledger)",
  "cratedeck/shared/ledger-freshness": "#225A shared-only fold",
  // ---- cratedeck → src seams: fulltags readers/fleet/grid/vote/name-key/
  // audio-exts + test-support; #225A or #214 folds these trees
  "src/shared/name-key": "#225A shared-only fold",
  "src/shared/audio-exts": "#225A shared-only fold",
  "src/shared/testutil": "#214/#225B test tree fold",
  "src/test-support/testutil": "#214/#225B test tree fold",
  "src/fulltags/write/readers": "#225A shared-only fold",
  "src/fulltags/grid-audit": "#225A shared-only fold",
  "src/fulltags/genre/genre-vote": "#225A shared-only fold",
  "src/fulltags/booth/fleet": "#225A shared-only fold",
  "src/shared/progress": "#244 landed (progress lives in src/shared)",
};

/** Which tree a module path belongs to. */
function treeOf(modulePath: string): "src" | "cratedeck" | null {
  if (modulePath === "src" || modulePath.startsWith("src/")) return "src";
  if (modulePath.startsWith("cratedeck/")) return "cratedeck";
  return null;
}

/** Resolve a relative import specifier from `fromFile` to a repo-relative
 *  module path (no extension — TS resolves .ts/.tsx/index). */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // package import — not a crossing
  const dir = join(ROOT, fromFile, "..");
  const abs = join(dir, spec);
  const rel = abs.slice(ROOT.length + 1);
  // normalize: strip .js/.ts extension forms
  return rel.replace(/\.(ts|js|tsx)$/u, "");
}

function* tsFiles(dir: string): Generator<string> {
  let st: Stats;
  try {
    st = statSync(dir);
  } catch {
    return;
  }
  if (!st.isDirectory()) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      yield* tsFiles(abs);
    } else if (/\.(ts|tsx)$/u.test(entry.name)) yield abs;
  }
}

/** The IMPORT_RE matches static + dynamic import specifiers; comment lines
 *  are stripped first so the census never flags its own documentation. */
const IMPORT_RE =
  /(?:^|\n)\s*(?:import[^"']*?|export[^"']*?from|await import)\s*\(?\s*["']([^"']+)["']/gu;

function crossings(): { file: string; spec: string; resolved: string }[] {
  const out: { file: string; spec: string; resolved: string }[] = [];
  for (const root of [
    "src",
    "cratedeck/src",
    "cratedeck/shared",
    "cratedeck/web",
  ]) {
    for (const abs of tsFiles(join(ROOT, root))) {
      const file = abs.slice(ROOT.length + 1);
      const fromTree =
        treeOf(file.split("/").slice(0, 1).join("/")) ??
        (file.startsWith("cratedeck/") ? "cratedeck" : "src");
      const text = readFileSync(abs, "utf8");
      const code = text
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      for (const m of code.matchAll(IMPORT_RE)) {
        const spec = m[1];
        if (!spec) continue;
        const resolved = resolveSpecifier(file, spec);
        if (!resolved) continue;
        const toTree = treeOf(resolved);
        if (!toTree || toTree === fromTree) continue;
        out.push({ file, spec, resolved });
      }
    }
  }
  return out;
}

test("#222: boundary crossings are leaf-or-allowlisted (direction rule)", () => {
  const offenders: string[] = [];
  for (const c of crossings()) {
    if (!(c.resolved in ALLOWED_CROSSINGS))
      offenders.push(`${c.file}: "${c.spec}" -> ${c.resolved}`);
  }
  expect(
    offenders,
    `unsanctioned src ↔ cratedeck crossings — add the module to the leaf ` +
      `(src/shared/leaf/*) or to ALLOWED_CROSSINGS with its owning issue ` +
      `(rule + list: #222; retire rows via #225A/#214):\n  ${offenders.join("\n  ")}`,
  ).toEqual([]);
});

test("#222: every allowlist row carries a retirement plan (owning issue)", () => {
  const bad = Object.entries(ALLOWED_CROSSINGS)
    .filter(([, plan]) => !/#\d+/u.test(plan))
    .map(([k]) => k);
  expect(
    bad,
    `allowlist rows without an owning issue: ${bad.join(", ")}`,
  ).toEqual([]);
});

test("#222: the leaf modules stay dependency-free (leaf of the leaf)", () => {
  for (const leaf of ["guards", "fmt", "vector-space", "fixes"]) {
    const text = readFileSync(join(ROOT, `src/shared/leaf/${leaf}.ts`), "utf8");
    expect(
      text.match(/^import /mu),
      `src/shared/leaf/${leaf}.ts must not import anything (leaf rule)`,
    ).toBeNull();
  }
});

test("#222: the rule is recorded in AGENTS.md (rule without docs regrows)", () => {
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  expect(agents).toContain("src/shared/leaf/");
});
