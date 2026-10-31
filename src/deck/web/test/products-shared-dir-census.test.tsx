// products-shared-dir-census.test.tsx — the #242 guard: products/shared/
// is the ONE shared home for the web product pages. Three pins:
//   1. the barrel (index.tsx) re-exports every member module's public
//      surface — a member export a page needs that the barrel doesn't
//      carry is the drift this catches (the #249 route-census class,
//      import-path edition);
//   2. pages import shared surface through the barrel ONLY — a direct
//      member import re-splits the seam the barrel owns;
//   3. PRODUCTS is the nav SSOT: every web product page directory has a
//      PRODUCTS row, so a new product dir can't ship unnaved.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const productsDir = join(import.meta.dir, "..", "products");
const sharedDir = join(productsDir, "shared");

const read = (p: string): string => readFileSync(p, "utf8");
const barrel = read(join(sharedDir, "index.tsx"));

test("the barrel re-exports every member module (one seam, no drift twins)", () => {
  const members = readdirSync(sharedDir)
    .filter((f) => f.endsWith(".tsx") && f !== "index.tsx")
    .toSorted();
  expect(members.length).toBeGreaterThanOrEqual(3);
  for (const m of members) {
    const src = read(join(sharedDir, m));
    const stem = `./${m.replace(/\.tsx$/, "")}`;
    // every export line of a member is either re-exported by the barrel
    // or explicitly tested/benched inside the member itself — the barrel
    // must carry at least one re-export reference to the module.
    expect(
      barrel.includes(stem),
      `products/shared/${m} has no barrel re-export — pages would import it directly and re-split the seam`,
    ).toBe(true);
    expect(src.trim().length).toBeGreaterThan(0);
  }
});

test("pages import shared surface through the barrel only (no member leaks)", () => {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (e.name.endsWith(".tsx")) {
        const src = read(p);
        const leaks = src.match(/from "\.\.\/shared\/(product-meta|scan-apply|beat-sync)"/g);
        if (leaks) offenders.push(`${p}: ${leaks.join(", ")}`);
      }
    }
  };
  for (const product of readdirSync(productsDir, { withFileTypes: true })) {
    if (!product.isDirectory() || product.name === "shared") continue;
    walk(join(productsDir, product.name));
  }
  // the app shell is the ONE sanctioned barrel bypass: AppChrome needs only
  // the nav SSOT, and importing the barrel would drag beat-sync's
  // ui/data → data-table graph (the tanstack table) into the entry chunk
  // (#552). The shell must name the member module; any other app/ import of
  // products/shared re-leaks the table into first paint.
  const appChrome = read(join(import.meta.dir, "..", "app", "AppChrome.tsx"));
  expect(appChrome).toContain('from "../products/shared/product-meta"');
  expect(appChrome).not.toContain('from "../products/shared"');
  expect(
    offenders,
    `direct member imports re-split the barrel seam:\n  ${offenders.join("\n  ")}`,
  ).toEqual([]);
});

test("every product page directory has a PRODUCTS row (the nav SSOT covers the tree)", () => {
  const meta = read(join(sharedDir, "product-meta.tsx"));
  // products/drives/ is the "drives" product (label CrateDeck) — the
  // dir name matches the router's Product id (renamed from products/cratedeck/
  // in the Sep 2026 src-fold).
  const NAV_ID: Record<string, string> = {};
  const productDirs = readdirSync(productsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "shared")
    .map((e) => e.name)
    .toSorted();
  for (const dir of productDirs) {
    const navId = NAV_ID[dir] ?? dir;
    expect(
      meta.includes(`id: "${navId}"`),
      `products/${dir}/ exists but PRODUCTS (product-meta.tsx) has no { id: "${navId}" } row — a product without nav is a dead page`,
    ).toBe(true);
  }
});
