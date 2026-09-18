import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("#50: boundary rules have permanent executable censuses", () => {
  const repo = join(import.meta.dir, "..", "..");
  const dir = join(repo, "src/census");
  const number = "boundary-number-census.test.ts";
  const json = "boundary-json-census.test.ts";
  expect(
    existsSync(join(dir, number)),
    "missing Number() boundary census",
  ).toBe(true);
  expect(
    existsSync(join(dir, json)),
    "missing JSON.parse persisted-blob census",
  ).toBe(true);
  const instructions = readFileSync(join(repo, "AGENTS.md"), "utf8");
  expect(instructions).toContain(number);
  expect(instructions).toContain(json);
});
