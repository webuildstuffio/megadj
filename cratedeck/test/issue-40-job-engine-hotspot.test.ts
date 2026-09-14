import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

interface MethodMetrics {
  lines: number;
  cyclomaticComplexity: number;
}

function methodMetrics(path: string, methodName: string): MethodMetrics {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let target: ts.MethodDeclaration | undefined;
  const findTarget = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && node.name.getText() === methodName) {
      target = node;
      return;
    }
    ts.forEachChild(node, findTarget);
  };
  findTarget(sourceFile);
  if (!target) throw new Error(`method ${methodName} not found in ${path}`);

  let cyclomaticComplexity = 1;
  const countBranches = (node: ts.Node): void => {
    if (
      ts.isIfStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isCatchClause(node) ||
      ts.isConditionalExpression(node) ||
      (ts.isCaseClause(node) && node.expression !== undefined) ||
      (ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
    ) {
      cyclomaticComplexity += 1;
    }
    ts.forEachChild(node, countBranches);
  };
  countBranches(target);

  const start = sourceFile.getLineAndCharacterOfPosition(
    target.getStart(),
  ).line;
  const end = sourceFile.getLineAndCharacterOfPosition(target.getEnd()).line;
  return { lines: end - start + 1, cyclomaticComplexity };
}

test("#40: JobEngine stays a small orchestrator", () => {
  const jobsPath = join(import.meta.dir, "..", "src", "jobs.ts");
  const source = readFileSync(jobsPath, "utf8");
  const metrics = methodMetrics(jobsPath, "executeInner");

  expect(
    source.trimEnd().split("\n").length,
    "jobs.ts must be at most 500 lines",
  ).toBeLessThanOrEqual(500);
  expect(
    metrics.lines,
    "executeInner() must be at most 120 lines",
  ).toBeLessThanOrEqual(120);
  expect(
    metrics.cyclomaticComplexity,
    "executeInner() cyclomatic complexity must be at most 12",
  ).toBeLessThanOrEqual(12);
});
