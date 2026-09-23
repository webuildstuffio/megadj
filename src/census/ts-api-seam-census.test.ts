// ts-api-seam-census.test.ts — the #274 tripwire: the TypeScript compiler
// API is imported through ONE module (`src/test-support/ts-ast.ts`), and
// never directly from `typescript` anywhere else.
//
// The bug class this pins: on the road to TS7 (#274, measured Sep 20-22)
// the package root stops exporting the compiler API — every
// `import * as ts from "typescript"` becomes a 2-export version stub and
// 275+ census/test/tool files break at once. With the seam, exactly one
// file migrates when the `unstable/ast` subpath API (or a vendored
// parser) becomes the target. A straying import reintroduces the whole
// migration cost silently — this census fails it loudly instead.
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, test } from "bun:test";

const REPO = join(import.meta.dir, "..", "..");
const ROOTS = ["src", "tools"];
const EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "test",
  "tests",
  "__tests__",
  "fixtures",
]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (EXT.has(extname(entry.name))) yield path;
  }
}

/** `import * as ts from "typescript"` / `from 'typescript'` — the exact
 *  shape TS7 breaks (the version stub has no compiler API). */
const NAMESPACE_IMPORT = /import\s+\*\s+as\s+\w+\s+from\s+["']typescript["']/u;
/** Named value imports (`import { createSourceFile } from "typescript"`),
 *  but NOT type-only imports — type imports vanish at runtime and
 *  `export … from "typescript"` in the seam itself is exempt. */
const NAMED_VALUE_IMPORT =
  /import\s+\{[^}]*[A-Za-z_][^}]*\}\s+from\s+["']typescript["']/u;

const SEAM = "src/test-support/ts-ast.ts";

describe("TypeScript compiler-API seam census (#274)", () => {
  test(`"typescript" is imported only through ${SEAM}`, () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const path of walk(join(REPO, root))) {
        const rel = path.slice(REPO.length + 1);
        if (rel === SEAM) continue;
        const text = readFileSync(path, "utf8");
        // Ignore import()-of-typespec comments and plain `import type`
        // (type-only imports are erased at runtime and harmless).
        const stripped = text
          .replace(/^\s*\/\/.*$/gmu, "")
          .replace(/\/\*[\s\S]*?\*\//gu, "");
        if (
          NAMESPACE_IMPORT.test(stripped) ||
          NAMED_VALUE_IMPORT.test(stripped)
        )
          offenders.push(rel);
      }
    }
    expect(
      offenders,
      `compiler API imported outside the ${SEAM} seam: ${offenders.join(", ")} — route the imports through the seam so the TS7 migration (#274) touches ONE file`,
    ).toEqual([]);
  });

  test("the seam itself still imports the compiler API (a moved seam must rename here in the same commit)", () => {
    const text = readFileSync(join(REPO, SEAM), "utf8");
    expect(text).toContain('from "typescript"');
  });
});
