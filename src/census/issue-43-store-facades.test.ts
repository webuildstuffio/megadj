import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

function classMemberCount(path: string, className: string): number {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let count: number | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      count = node.members.length;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (count === undefined)
    throw new Error(`class ${className} not found in ${path}`);
  return count;
}

test("#43: DB and ArchiveState are thin store facades", () => {
  const repo = join(import.meta.dir, "..", "..");
  const dbPath = join(repo, "src", "deck", "db.ts");
  const archiveStatePath = join(repo, "src", "archive", "state.ts");

  expect(
    classMemberCount(dbPath, "DB"),
    "DB must have at most 25 own members",
  ).toBeLessThanOrEqual(25);
  expect(
    classMemberCount(archiveStatePath, "ArchiveState"),
    "ArchiveState must have at most 25 own members",
  ).toBeLessThanOrEqual(25);
});
