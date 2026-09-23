/**
 * boundary-direction-census.test.ts — #222: the src ↔ cratedeck seam rule,
 * executable. The old one-way guarantee ("cratedeck/* never imports src/")
 * died with #193's fold and regrew in both directions for months because no
 * tripwire held it. This census pinned the POST-#222 rule:
 *
 *   src and cratedeck may import each other ONLY through the sanctioned
 *   leaf (src/shared/leaf/{guards,fmt,vector-space,fixes}) plus the
 *   declared seam modules enumerated in ALLOWED_CROSSINGS below.
 *
 * Sep 2026: cratedeck folded into src/deck (the #193 pattern) — the two
 * trees are one, and every crossing became an ordinary intra-src import.
 * The census keeps its job by pinning the INVARIANTS that outlived the
 * boundary: the allowlist rows now name modules that must exist at their
 * folded paths (a silent revert of the fold fails here), the leaf stays
 * dependency-free, and the seam modules keep their owning-issue rows
 * until #225A retires them.
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

/** Import specifiers (normalized to repo-relative module paths) that MAY
 *  cross the former src ↔ cratedeck boundary, each with its owner +
 *  retirement plan. The trees are one directory now; these rows pin the
 *  folded locations and keep each seam's owning issue attached until
 *  #225A closes it. If a row's module is MISSING here, the fold regressed
 *  or a module moved without moving this census. */
const ALLOWED_CROSSINGS: Readonly<Record<string, string>> = {
  // ---- the sanctioned leaf (src/shared/leaf/*) — permanent unless #225A
  // folds the shared surface wholesale, in which case these imports die too
  "src/shared/leaf/guards": "#225A retire or keep as the leaf",
  "src/shared/leaf/fmt": "#225A retire or keep as the leaf",
  "src/shared/leaf/vector-space": "#225A retire or keep as the leaf",
  "src/shared/leaf/fixes": "#225A retire or keep as the leaf",
  // ---- former src → cratedeck/src seams (config/archive/megaset/server):
  // now ordinary intra-src modules at their folded paths — #225A
  "src/deck/config": "#225A shared-only fold",
  "src/deck/db/reader": "#225A shared-only fold",
  "src/deck/megaset/engine": "#225A shared-only fold",
  "src/deck/server-port": "#225A shared-only fold",
  // ---- the former cratedeck/shared declared leaves (AGENTS.md pinned
  // types.ts as the declared import leaf; hygiene/ledger-freshness are the
  // same class) — #225A folds or re-homes these
  "src/deck/shared/types": "#225A shared-only fold (declared leaf)",
  "src/deck/shared/megaset":
    "#283 megaset wire shapes (SetSearchOverride guard) — fold with #225A",
  "src/deck/shared/hygiene": "#225A shared-only fold",
  "src/deck/shared/dump":
    "#225A shared-only fold (dump contract, used by src/core/dump-ledger)",
  "src/deck/shared/ledger-freshness": "#225A shared-only fold",
  // ---- former cratedeck → src seams: fulltags readers/fleet/grid/vote/
  // name-key/audio-exts + test-support; #225A or #214 folds these trees
  "src/shared/name-key": "#225A shared-only fold",
  "src/shared/audio-exts": "#225A shared-only fold",
  "src/test-support/testutil": "#214/#225B test tree fold",
  "src/fulltags/write/readers": "#225A shared-only fold",
  "src/fulltags/grid-audit": "#225A shared-only fold",
  "src/fulltags/genre/genre-vote": "#225A shared-only fold",
  "src/fulltags/booth/fleet": "#225A shared-only fold",
  "src/shared/progress": "#244 landed (progress lives in src/shared)",
};

/** The former boundary trees, folded: every module above must exist here. */
function exists(rel: string): boolean {
  for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx", ""])
    if (existsSync(join(ROOT, rel + suffix))) return true;
  return false;
}

test("#222: every allowlisted seam module exists at its folded path", () => {
  const missing = Object.keys(ALLOWED_CROSSINGS).filter((m) => !exists(m));
  expect(
    missing,
    `allowlisted seam modules missing from the tree — the fold regressed ` +
      `or moved without this census: ${missing.join(", ")}`,
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

test("#222: the fold held — no cratedeck/ tree remains in tracked sources", () => {
  // A revert of the Sep 2026 fold re-creates cratedeck/; fail loudly.
  expect(existsSync(join(ROOT, "cratedeck")), "cratedeck/ regrew").toBeFalse();
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
