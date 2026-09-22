import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * sc_genre_ids census (#108, verdict: DROPPED 2026-09-15). The ID→name
 * cache existed only as a ghost table — built by a never-committed
 * one-off scraper, read and written by nothing. Dated backup:
 * ~/.local/state/megadj/archive-db-before-sc-genre-ids-drop-2026-09-15.db
 * (+ the 269 rows as a CSV sidecar). This census keeps it dead: no repo
 * file may reference the table, and the schema must not grow a new
 * sc_genre_ids without this test being consciously updated.
 */

const ROOT = join(import.meta.dir, "..", "..");

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      out.push(...walkFiles(p));
    } else if (/\.(ts|tsx|py|sql)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

test("census: sc_genre_ids stays dropped (no reference in code)", () => {
  const offenders: string[] = [];
  // Scoped to the trees that could own the schema or a reader/writer.
  for (const dir of ["src", "fulltags", "tools"]) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const p of walkFiles(abs)) {
      if (p === join(ROOT, "src/census/sc-genre-ids-census.test.ts")) continue; // self
      if (readFileSync(p, "utf8").includes("sc_genre_ids")) {
        offenders.push(p);
      }
    }
  }
  expect(offenders).toEqual([]);
});

describe("sc_genre_ids verdict", () => {
  test("genre-pipeline.md §5 records the dated drop verdict", () => {
    const doc = readFileSync(
      join(ROOT, "docs/fulltags/genre-pipeline.md"),
      "utf8",
    );
    expect(doc).toMatch(/DROPPED 2026-09-15/);
  });
});
