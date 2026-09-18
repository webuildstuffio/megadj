import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("#50: boundary rules have permanent executable censuses", () => {
  const repo = join(import.meta.dir, "..", "..");
  const numberCensus = join(repo, "src/census", "boundary-number-census");
  const jsonCensus = join(repo, "src/census", "boundary-json-census");
  expect(existsSync(`${numberCensus}.test.ts`), "missing Number() census").toBe(
    true,
  );
  expect(
    existsSync(`${jsonCensus}.test.ts`),
    "missing JSON.parse persisted-blob census",
  ).toBe(true);

  const instructions = readFileSync(join(repo, "AGENTS.md"), "utf8");
  expect(instructions).toContain("boundary-number-census.test.ts");
  expect(instructions).toContain("boundary-json-census.test.ts");
});
