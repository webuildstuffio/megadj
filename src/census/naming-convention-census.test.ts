// naming-convention-census.test.ts — the #240 guard: repo-wide kebab-case
// file naming. The Sep-2026 pass renamed the 77-file snake majority in
// cratedeck/src (13% kebab → 100%) plus the 3 src/core strays, the
// fulltags mb_lookup stray, the 2 cratedeck/shared strays, and their 9
// tests; without this pin the next extraction re-splits the convention
// (#207 re-created a kebab/snake pair inside one directory three days
// after its own split). Python keeps snake_case (PEP 8): module names are
// exempt, enforced by the *.py exclusion, not by chance.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const repo = join(import.meta.dir, "..", "..");

const SNAKE_TREES = ["src", "tools"];

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(join(repo, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      yield* walk(rel);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      yield rel;
    }
  }
}

const SNAKE = /[a-z0-9]_[a-z0-9]/;

test("module files are kebab-case: no snake_case basenames outside tests", () => {
  const offenders = [...walk(".")]
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
    .filter((f) => SNAKE.test(f.split("/").pop() ?? ""));
  expect(
    offenders,
    `snake_case module files re-appeared (the #240 pre-pass tree was 13% kebab in cratedeck/src — the convention is kebab repo-wide):\n  ${offenders.join("\n  ")}`,
  ).toEqual([]);
});

test("test files are kebab-case too", () => {
  const offenders = [...walk(".")]
    .filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"))
    .filter((f) => SNAKE.test(f.split("/").pop() ?? ""));
  expect(
    offenders,
    `snake_case test files re-appeared:\n  ${offenders.join("\n  ")}`,
  ).toEqual([]);
});

test("the census watches the trees that were snake-majority", () => {
  for (const tree of SNAKE_TREES) {
    expect(
      walk(tree).next().done,
      `${tree} is a watched tree but walk() found nothing — if the tree moved, move this census with it`,
    ).toBe(false);
  }
});

test("AGENTS.md teaches the convention so the next extraction inherits it", async () => {
  const agents = await Bun.file(join(repo, "AGENTS.md")).text();
  expect(agents).toContain("naming-convention-census.test.ts");
});
