import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  forEachChild,
  isBinaryExpression,
  isCaseClause,
  isCatchClause,
  isConditionalExpression,
  isDoStatement,
  isForInStatement,
  isForOfStatement,
  isForStatement,
  isIfStatement,
  isMethodDeclaration,
  isWhileStatement,
  parseSourceFile,
  SyntaxKind,
  type MethodDeclaration,
  type Node,
} from "../../test-support/ts-ast";

interface MethodMetrics {
  lines: number;
  cyclomaticComplexity: number;
}

function methodMetrics(path: string, methodName: string): MethodMetrics {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = parseSourceFile(path, sourceText);
  let target: MethodDeclaration | undefined;
  const findTarget = (node: Node): void => {
    if (isMethodDeclaration(node) && node.name.getText() === methodName) {
      target = node;
      return;
    }
    forEachChild(node, findTarget);
  };
  findTarget(sourceFile);
  if (!target) throw new Error(`method ${methodName} not found in ${path}`);

  let cyclomaticComplexity = 1;
  const countBranches = (node: Node): void => {
    if (
      isIfStatement(node) ||
      isForStatement(node) ||
      isForInStatement(node) ||
      isForOfStatement(node) ||
      isWhileStatement(node) ||
      isDoStatement(node) ||
      isCatchClause(node) ||
      isConditionalExpression(node) ||
      (isCaseClause(node) && node.expression !== undefined) ||
      (isBinaryExpression(node) &&
        (node.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken ||
          node.operatorToken.kind === SyntaxKind.BarBarToken ||
          node.operatorToken.kind === SyntaxKind.QuestionQuestionToken))
    ) {
      cyclomaticComplexity += 1;
    }
    forEachChild(node, countBranches);
  };
  countBranches(target);

  const start = sourceFile.getLineAndCharacterOfPosition(
    target.getStart(),
  ).line;
  const end = sourceFile.getLineAndCharacterOfPosition(target.getEnd()).line;
  return { lines: end - start + 1, cyclomaticComplexity };
}

test("#40: JobEngine stays a small orchestrator", () => {
  const jobsPath = join(import.meta.dir, "..", "jobs", "engine.ts");
  const source = readFileSync(jobsPath, "utf8");
  const metrics = methodMetrics(jobsPath, "executeInner");

  expect(
    source.trimEnd().split("\n").length,
    "jobs/engine.ts must be at most 500 lines",
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
