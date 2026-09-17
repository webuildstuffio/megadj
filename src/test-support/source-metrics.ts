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

/** Every function-like node in a file (named declarations, methods,
 *  constructors, arrow functions assigned to variables), with the same
 *  branch-counting rules as functionMetrics. This is the measurer the
 *  census tests use — lizard phantom-folds regex-literal data tables and
 *  misses anonymous closures entirely (see AGENTS.md, #195/#198). */
export interface FunctionSpan {
  name: string;
  cyclomaticComplexity: number;
  lines: number;
  startLine: number;
  endLine: number;
}

/** Branch-count rules shared by functionMetrics + allFunctions (the
 *  measurer the pinned census tests use). Module-level: captures nothing. */
function countBranchNodes(node: ts.Node): number {
  let n = 1;
  const visit = (x: ts.Node): void => {
    if (
      ts.isIfStatement(x) ||
      ts.isForStatement(x) ||
      ts.isForInStatement(x) ||
      ts.isForOfStatement(x) ||
      ts.isWhileStatement(x) ||
      ts.isDoStatement(x) ||
      ts.isCatchClause(x) ||
      ts.isConditionalExpression(x) ||
      (ts.isCaseClause(x) && x.expression !== undefined) ||
      (ts.isBinaryExpression(x) &&
        (x.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          x.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
    ) {
      n += 1;
    }
    ts.forEachChild(x, visit);
  };
  visit(node);
  return n;
}

/** Every function-like node in a file (named declarations, methods,
 *  constructors, arrow functions assigned to variables), with the same
 *  branch-counting rules as functionMetrics. */
export function allFunctions(path: string): FunctionSpan[] {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const out: FunctionSpan[] = [];
  const walk = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isConstructorDeclaration(node)
    ) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      let name = "<anonymous>";
      if (ts.isFunctionDeclaration(node) && node.name) name = node.name.text;
      else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name))
        name = `${node.name.text} (method)`;
      else if (ts.isConstructorDeclaration(node)) name = "constructor";
      else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        // const foo = () => … / const foo = function () {…}
        const p = node.parent;
        if (
          (ts.isVariableDeclaration(p) || ts.isPropertyDeclaration(p)) &&
          ts.isIdentifier(p.name)
        )
          name = p.name.text;
      }
      out.push({
        name,
        cyclomaticComplexity: countBranchNodes(node),
        lines: end.line - start.line + 1,
        startLine: start.line + 1,
        endLine: end.line + 1,
      });
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return out;
}
