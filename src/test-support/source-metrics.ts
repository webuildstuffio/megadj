import { readFileSync } from "node:fs";
import * as ts from "typescript";

export interface FunctionMetrics {
  lines: number;
  cyclomaticComplexity: number;
}

export function functionMetrics(
  path: string,
  functionName: string,
): FunctionMetrics {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  let target: ts.FunctionDeclaration | undefined;
  const findTarget = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      target = node;
      return;
    }
    ts.forEachChild(node, findTarget);
  };
  findTarget(sourceFile);

  if (!target) {
    throw new Error(`function ${functionName} not found in ${path}`);
  }

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

  const startLine = sourceFile.getLineAndCharacterOfPosition(
    target.getStart(),
  ).line;
  const endLine = sourceFile.getLineAndCharacterOfPosition(
    target.getEnd(),
  ).line;
  return {
    lines: endLine - startLine + 1,
    cyclomaticComplexity,
  };
}
