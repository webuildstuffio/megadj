// intake.test.ts — #262 wire-contract pin: the dump shapes on the intake
// wire are DERIVED from src/deck/shared/dump.ts (the owner), never
// redeclared here. Two structurally identical interfaces compile fine
// and drift silently the day the ledger adds a field — a hand-copied
// twin is exactly the bug class this census catches (the dispatch-twin
// precedent: the pin watches the redeclaration itself, not the shape).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(import.meta.dir, "intake.ts"), "utf8");

describe("#262 dump wire contract (derived, never redeclared)", () => {
  test("intake.ts redeclares neither dump wire shape", () => {
    expect(/interface\s+DumpRecord\b/.test(SOURCE)).toBe(false);
    expect(/interface\s+IntakeDumpsResponse\b/.test(SOURCE)).toBe(false);
  });

  test("both shapes re-export from the dump owner leaf", () => {
    // DumpRecord has no barrel consumers (dump-ledger.ts reads the leaf
    // directly; knip flags the re-export as dead) — only the census shape
    // routes through here, so that is the pinned re-export.
    expect(SOURCE).not.toContain("interface DumpRecord");
    expect(SOURCE).toContain(
      'export type { DumpCensus as IntakeDumpsResponse } from "../dump"',
    );
  });

  test("the owner leaf actually declares the shapes", () => {
    const owner = readFileSync(join(import.meta.dir, "..", "dump.ts"), "utf8");
    expect(/interface\s+DumpRecord\b/.test(owner)).toBe(true);
    expect(/interface\s+DumpCensus\b/.test(owner)).toBe(true);
  });
});
