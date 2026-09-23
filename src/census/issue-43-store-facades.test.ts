import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  forEachChild,
  isClassDeclaration,
  parseSourceFile,
  type Node,
} from "../test-support/ts-ast";

function classMemberCount(path: string, className: string): number {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = parseSourceFile(path, sourceText);
  let count: number | undefined;
  const visit = (node: Node): void => {
    if (isClassDeclaration(node) && node.name?.text === className) {
      count = node.members.length;
      return;
    }
    forEachChild(node, visit);
  };
  visit(sourceFile);
  if (count === undefined)
    throw new Error(`class ${className} not found in ${path}`);
  return count;
}

test("#43: DB and ArchiveState are thin store facades", () => {
  const repo = join(import.meta.dir, "..", "..");
  const dbPath = join(repo, "src", "deck", "db.ts");
  const archiveStatePath = join(repo, "src", "core", "state.ts");

  expect(
    classMemberCount(dbPath, "DB"),
    "DB must have at most 25 own members",
  ).toBeLessThanOrEqual(25);
  expect(
    classMemberCount(archiveStatePath, "ArchiveState"),
    "ArchiveState must have at most 25 own members",
  ).toBeLessThanOrEqual(25);
});
