// app-lazy-chunks-census.test.tsx — the #552 bundle-split guard: the deck
// web entry chunk pays only for the shell (~27 KB gz). The five product
// canvases and the ⌘K palette load through dynamic import() (vite splits
// them into async chunks — a static import re-fattens first paint to
// ~134 KB gz with the tanstack table and fuse.js aboard), async swaps get
// a Suspense fallback, and the shell never statically reaches the heavy
// ui kit (tables / charts / DrivePanels) that belongs to product chunks.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const appDir = join(import.meta.dir, "..", "app");
const read = (p: string): string => readFileSync(join(appDir, p), "utf8");

const CANVAS_IMPORTS = [
  'import("../products/drives/DrivePage")',
  'import("../products/drives/FleetPage")',
  'import("../products/getdat/GetDatPage")',
  'import("../products/fulltags/FullTagsPage")',
  'import("../products/megaset/MegasetPage")',
];

test("product canvases are lazy-loaded (async chunks, not the entry)", () => {
  const src = read("App.tsx");
  expect(src).toContain("lazy(() =>");
  for (const dynamic of CANVAS_IMPORTS) expect(src).toContain(dynamic);
  // no canvas keeps a static named import beside the lazy one
  expect(src.match(/import \{ (Drive|Fleet|GetDat|FullTags|Megaset)Page \}/)).toBeNull();
  // async swaps get a Suspense fallback (a blank canvas reads as a hang)
  expect(src).toContain("<Suspense fallback=");
});

test("the ⌘K palette (fuse.js) loads with the palette, not first paint", () => {
  const src = read("App.tsx");
  expect(src).toContain('import("../ui/Palette")');
  expect(src).not.toContain('from "../ui/Palette"');
});

test("app/ never statically imports the heavy ui kit", () => {
  const offenders: string[] = [];
  for (const f of readdirSync(appDir)) {
    if (!f.endsWith(".tsx") && !f.endsWith(".ts")) continue;
    const src = read(f);
    for (const heavy of ['from "../ui/data"', 'from "../ui/DrivePanels"', 'from "../ui/charts"']) {
      if (src.includes(heavy)) offenders.push(`${f}: ${heavy}`);
    }
  }
  expect(offenders).toEqual([]);
});
