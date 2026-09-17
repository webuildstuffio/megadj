// fetch-ai-fallback-census.test.ts — #160-ring discipline for the AI
// fallback legs: `megadj fetch --json` must emit ZERO human lines before
// the one summary object (stdout is a boundary — P1). The legs predate
// the extraction with `progressLog`, which carried the jsonOut gate;
// when they moved to fetch-ai-fallback.ts the gate briefly dropped
// (caught by the 2026-09-17 /super-fix pass). Every console.log in the
// fallback legs must sit behind `!jsonOut`.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FILE = join(import.meta.dir, "fulltags/fetch-ai-fallback.ts");

test("fetch AI fallback: every console.log is gated on !jsonOut", () => {
  const src = readFileSync(FILE, "utf8");
  const lines = src.split("\n");
  const ungated: string[] = [];
  let found = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("console.log(")) continue;
    found += 1;
    // gated same-line (`if (!jsonOut) console.log(...)`) OR gated via a
    // multi-line `if (!jsonOut) {` wrapping — accept either shape.
    const prev = lines.slice(Math.max(0, i - 3), i).join(" ");
    if (line.includes("!jsonOut") || prev.includes("!jsonOut")) continue;
    ungated.push(`${i + 1}: ${line.trim()}`);
  }
  expect(
    found,
    "no console.log lines found — did the legs move?",
  ).toBeGreaterThan(0);
  expect(
    ungated,
    `ungated console.log in fetch-ai-fallback.ts (would leak human lines into --json stdout):\n${ungated.join("\n")}`,
  ).toEqual([]);
});
