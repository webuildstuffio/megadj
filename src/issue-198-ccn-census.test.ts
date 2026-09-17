/**
 * #198 — the span-verified CCN census.
 *
 * lizard's CCN table phantom-folds regex-literal data tables and adjacent
 * small functions into hotspots, and is blind to anonymous closures
 * entirely (5 of #195's 7 "hotspots" were ghosts — c3d7bf4). This census
 * measures REAL function spans with the TypeScript AST (the same rules as
 * src/test-support/source-metrics.ts) and pins the repo ceiling.
 *
 * Ceiling policy: ratchet, may only move DOWN. Sep 17 (#88 item 1): the
 * 159–64 tier (enrichTrack, parseVerifyReport, runFetch, ingestOne,
 * rbDedup) was split into per-concern functions; the live max is 56
 * (DataTable, web). Ceiling sits just above it; when the top function
 * drops, lower the ceiling to just above the new max in the SAME commit.
 */
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  allFunctions,
  type FunctionSpan,
} from "../src/test-support/source-metrics";

const ROOT = join(import.meta.dir, "..");
const CEILING = 60;

function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
    cwd: ROOT,
  })
    .toString()
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !l.includes(".test.") &&
        !l.includes("/test/") &&
        !l.includes("test-support/") &&
        !l.endsWith(".d.ts"),
    );
  return out;
}

test("#198: no real function exceeds the CCN ceiling (AST span-verified)", () => {
  const offenders: string[] = [];
  for (const rel of trackedFiles()) {
    let fns: FunctionSpan[] = [];
    try {
      fns = allFunctions(join(ROOT, rel));
    } catch {
      continue; // unparseable/removed mid-run — not this test's concern
    }
    for (const fn of fns) {
      if (fn.cyclomaticComplexity > CEILING) {
        offenders.push(
          `${rel}:${fn.startLine}-${fn.endLine} ${fn.name} CCN ${fn.cyclomaticComplexity}`,
        );
      }
    }
  }
  expect(
    offenders,
    `functions over the CCN ceiling (${CEILING}) — refactor them, then LOWER the ceiling (ratchet, never raise):\n${offenders.join("\n")}`,
  ).toEqual([]);
});

test("#198: the ceiling is honest — the max real CCN is within 15 of it", () => {
  // Guards against ceiling rot: if the max falls far below the ceiling,
  // the ratchet must be tightened (in the same commit that lowered it).
  let max = 0;
  for (const rel of trackedFiles()) {
    try {
      for (const fn of allFunctions(join(ROOT, rel))) {
        max = Math.max(max, fn.cyclomaticComplexity);
      }
    } catch {
      continue;
    }
  }
  expect(max).toBeGreaterThan(CEILING - 15);
  expect(max).toBeLessThanOrEqual(CEILING);
});
