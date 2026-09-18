/**
 * json-summary-census.test.ts — #159 acceptance: the repo has ONE JSON
 * emit path (`writeJson` in src/shared/cli-output.ts, the awaited seam
 * from #53). A raw `console.log(JSON.stringify(...))` on a `--json` exit
 * reintroduces the pipe-truncation EOF class and breaks test-console
 * capture; this census guards the whole surface, MULTILINE-SAFE — the
 * raw sites this guards against historically spanned two lines
 * (`console.log(\n  JSON.stringify(...)`) so a flat single-line grep
 * silently passed them.
 *
 * Scope: src/ + fulltags/src + cratedeck/src production files. Tests
 * deliberately keep their own emit idioms (capture harnesses stringify by
 * hand).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, type Stats } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["src", "cratedeck/src"] as const; // fulltags -> src/fulltags (#193)
const SKIP_DIRS = new Set(["node_modules", ".git", "test", "test-support"]);
/** tools/ ships operator CLIs with the same --json contract; scan them too
 *  but skip the intentional string fixtures (loc-budget writes raw text). */
const EXTRA_ROOTS = ["tools"] as const;
const EXTRA_SKIP = new Set(["legacy", "__pycache__"]);

function* tsFiles(dir: string): Generator<string> {
  let stats: Stats;
  try {
    stats = statSync(dir);
  } catch {
    return;
  }
  if (!stats.isDirectory()) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* tsFiles(abs);
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      yield abs;
    }
  }
}

/** Matches `console.log(` followed by optional whitespace/newline and
 *  `JSON.stringify` — the raw-emit shape, across line breaks. */
const RAW_EMIT = /console\.log\(\s*JSON\.stringify/u;

describe("#159: one awaited JSON emit path (writeJson)", () => {
  test("no production file raw-prints JSON.stringify to stdout", () => {
    const offenders: string[] = [];
    const roots = [...ROOTS, ...EXTRA_ROOTS];
    const skip = new Set([...SKIP_DIRS, ...EXTRA_SKIP]);
    for (const root of roots) {
      for (const file of tsFiles(root)) {
        if (file.split("/").some((segment) => skip.has(segment))) continue;
        const code = readFileSync(file, "utf8");
        if (RAW_EMIT.test(code)) offenders.push(relative(".", file));
      }
    }
    expect(
      offenders,
      `raw console.log(JSON.stringify) bypasses the awaited writeJson seam (#53 EOF class, #159). Migrate: await writeJson(payload) from src/shared/cli-output. Offenders:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  test("the seam itself still guards the two-channel contract", async () => {
    // writeJson defers to a REPLACED console.log (test capture) but uses
    // the awaited Bun.write path on real stdout — pin both branches so a
    // "simplification" of the seam can't silently drop one.
    const { writeJson } = await import("../../src/shared/cli-output");
    const orig = console.log;
    const captured: string[] = [];
    console.log = (s: string) => captured.push(s);
    try {
      await writeJson({ probe: true });
    } finally {
      console.log = orig;
    }
    expect(captured).toEqual([JSON.stringify({ probe: true })]);
  });
});
