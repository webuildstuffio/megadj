import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * FullTags two-tree bridge discipline (#145): `src/fulltags/*` are CLI
 * adapters; the package's symbols reach megadj ONLY through the
 * `fulltags/src/exports` bridge. A deep `../../fulltags/src/<module>`
 * import bypasses the bridge and rots it (the probeMediaSync incident,
 * 88ec03e) — so the rule is enforced here, repo-wide over `src/`.
 *
 * The bridge itself and `fulltags/`-internal imports are exempt; test
 * files follow the same rule as production code.
 */

const repo = join(import.meta.dir, "..");

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".git") continue;
    if (statSync(full).isDirectory()) {
      yield* walkTs(full);
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) yield full;
  }
}

const DEEP_IMPORT = /from\s+"\.\.\/\.\.\/fulltags\/src\/(?!exports")[^"]+"/;

test("src/ imports the fulltags package only through the exports bridge", () => {
  const offenders: string[] = [];
  for (const file of walkTs(join(repo, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (DEEP_IMPORT.test(line))
        offenders.push(`${file.replace(`${repo}/`, "")}: ${line.trim()}`);
    }
  }
  expect(offenders.length === 0 ? [] : offenders).toEqual([]);
});
