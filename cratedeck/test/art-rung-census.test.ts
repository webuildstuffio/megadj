import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Art-rung census: the artwork_status stamp vocabulary that the batch
 * enrichment ladder (tools/fetch-stages.ts) can emit must be fully
 * phrased in the GetDat library UI (LibraryTab artLang map) — a rung
 * without a phrase falls through to raw stamp text in the track list.
 *
 * DERIVED from the producer source, never a hand list (one SSOT per
 * shared artifact): this test extracts every `label: "…"` entry in the
 * fallback ladder plus the sc/sc-orig runs, and asserts the UI map
 * covers each one exactly.
 */

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** The rungs the batch ladder can stamp into tracks.artwork_status. */
function producerRungs(): string[] {
  const src = read("tools/fetch-stages.ts");
  const rungs = new Set<string>(["sc", "sc-orig"]);
  for (const m of src.matchAll(/label: "([a-z0-9-]+)"/g)) {
    if (m[1]) rungs.add(m[1]);
  }
  return [...rungs].toSorted();
}

/** The rungs the UI map phrases. Extracted from LibraryTab's `langs`
 *  table literal only (not the whole file). */
function uiRungs(): string[] {
  const src = read("cratedeck/web/products/getdat/LibraryTab.tsx");
  const start = src.indexOf("const langs: Record<string, string> = {");
  const end = src.indexOf("};", start);
  const body = src.slice(start, end);
  const keys = new Set<string>();
  for (const m of body.matchAll(/^\s+"?([a-z0-9-]+)"?:\s+"[^"]+",?$/gm)) {
    if (m[1]) keys.add(m[1]);
  }
  return [...keys].toSorted();
}

describe("art-rung census (producer ↔ UI 1:1)", () => {
  test("every producer stamp has a UI phrase", () => {
    const prod = producerRungs();
    const ui = new Set(uiRungs());
    const missing = prod.filter((r) => !ui.has(r));
    expect(missing).toEqual([]);
  });

  test("producer ladder still covers the Beatport rung", () => {
    expect(producerRungs()).toContain("beatport");
  });
});
