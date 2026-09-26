// census-walk.ts — shared file-walk helpers for the src/census/ tests.
//
// 13+ census tests duplicated a ~10-line readdirSync walk with minor
// filter variations (TS-only, TS+tests, TS+Py+SQL, all). This module
// owns the one recursive walk; each census picks its extension filter.
import { readdirSync, type Dirent } from "node:fs";
import { extname, join } from "node:path";

const INFRA_DIRS = new Set(["node_modules", "dist", ".git"]);
const TEST_DIRS = new Set([
  "test",
  "tests",
  "__tests__",
  "fixtures",
  "test-support",
]);

export interface WalkOpts {
  /** Skip test directories (test/, tests/, __tests__, fixtures, test-support). */
  skipTests?: boolean | undefined;
}

/** Recursively yield every file under `dir` whose extension is in `exts`.
 *  Skips node_modules, dist, and dot-prefixed directories.
 *  Pass `{ skipTests: true }` to also skip test directories. */
export function* walkFiles(
  dir: string,
  exts: ReadonlySet<string>,
  opts?: WalkOpts | undefined,
): Generator<string> {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const skipTests = opts?.skipTests === true;
  for (const e of entries) {
    if (e.name.startsWith(".") || INFRA_DIRS.has(e.name)) continue;
    if (skipTests && TEST_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(p, exts, opts);
    else if (exts.has(extname(e.name))) yield p;
  }
}

/** TS/TSX source files (the most common census walk). */
export const TS_EXTS = new Set([".ts", ".tsx"]);

/** All TS extensions including CJS/ESM variants. */
export const TS_ALL_EXTS = new Set([".ts", ".tsx", ".mts", ".cts"]);

/** TS + Python + SQL (for cross-language censuses like sc-genre-ids). */
export const ALL_SOURCE_EXTS = new Set([".ts", ".tsx", ".py", ".sql"]);

/** Walk only test files (*.test.ts). Uses the same walkFiles engine. */
export function* walkTestFiles(dir: string): Generator<string> {
  for (const p of walkFiles(dir, TS_EXTS)) {
    if (p.endsWith(".test.ts")) yield p;
  }
}
