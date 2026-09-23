import { readFileSync } from "node:fs";
import {
  forEachChild,
  isArrowFunction,
  isBinaryExpression,
  isCaseClause,
  isCatchClause,
  isConditionalExpression,
  isConstructorDeclaration,
  isDoStatement,
  isForInStatement,
  isForOfStatement,
  isForStatement,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isIfStatement,
  isMethodDeclaration,
  isPropertyDeclaration,
  isVariableDeclaration,
  isWhileStatement,
  parseSourceFile,
  SyntaxKind,
  type ArrowFunction,
  type ConstructorDeclaration,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  type Node,
  type PropertyDeclaration,
  type VariableDeclaration,
} from "./ts-ast";

export interface FunctionMetrics {
  lines: number;
  cyclomaticComplexity: number;
}

export function functionMetrics(
  path: string,
  functionName: string,
): FunctionMetrics {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = parseSourceFile(path, sourceText);

  let target: FunctionDeclaration | undefined;
  const findTarget = (node: Node): void => {
    if (isFunctionDeclaration(node) && node.name?.text === functionName) {
      target = node;
      return;
    }
    forEachChild(node, findTarget);
  };
  findTarget(sourceFile);

  if (!target) {
    throw new Error(`function ${functionName} not found in ${path}`);
  }

  let cyclomaticComplexity = 1;
  const countBranches = (node: Node): void => {
    if (isBranchNode(node)) cyclomaticComplexity += 1;
    forEachChild(node, countBranches);
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
 *  measurer the pinned census tests use). ONE table, three callers:
 *  functionMetrics, countBranchNodes, and tools/ast-ccn.ts — the #274
 *  pass retired the last hand-copied branch-rule twins. Module-level:
 *  captures nothing. */
function isBranchNode(node: Node): boolean {
  return (
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
  );
}

function countBranchNodes(node: Node): number {
  let n = 1;
  const visit = (x: Node): void => {
    if (isBranchNode(x)) n += 1;
    forEachChild(x, visit);
  };
  visit(node);
  return n;
}

type NamedFunctionNode =
  | ArrowFunction
  | FunctionDeclaration
  | FunctionExpression
  | MethodDeclaration
  | ConstructorDeclaration;

/** Display name for a function-like node — the census table's name column
 *  (const foo = () => … / const foo = function () {…} inherit the
 *  variable/property name; everything else reports <anonymous>). */
function displayName(node: NamedFunctionNode): string {
  if (isFunctionDeclaration(node) && node.name) return node.name.text;
  if (isMethodDeclaration(node) && isIdentifier(node.name))
    return `${node.name.text} (method)`;
  if (isConstructorDeclaration(node)) return "constructor";
  if (isArrowFunction(node) || isFunctionExpression(node)) {
    const p: Node = node.parent;
    const decl = p as VariableDeclaration | PropertyDeclaration;
    const namedDecl =
      (isVariableDeclaration(p) || isPropertyDeclaration(p)) &&
      isIdentifier(decl.name)
        ? decl.name.text
        : undefined;
    return namedDecl ?? "<anonymous>";
  }
  return "<anonymous>";
}

/** Every function-like node in a file (named declarations, methods,
 *  constructors, arrow functions assigned to variables), with the same
 *  branch-counting rules as functionMetrics. */
export function allFunctions(path: string): FunctionSpan[] {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = parseSourceFile(path, sourceText);

  const out: FunctionSpan[] = [];
  const walk = (node: Node): void => {
    if (
      isFunctionDeclaration(node) ||
      isMethodDeclaration(node) ||
      isArrowFunction(node) ||
      isFunctionExpression(node) ||
      isConstructorDeclaration(node)
    ) {
      const fn = node as NamedFunctionNode;
      const start = sourceFile.getLineAndCharacterOfPosition(fn.getStart());
      const end = sourceFile.getLineAndCharacterOfPosition(fn.getEnd());
      out.push({
        name: displayName(fn),
        cyclomaticComplexity: countBranchNodes(fn),
        lines: end.line - start.line + 1,
        startLine: start.line + 1,
        endLine: end.line + 1,
      });
    }
    forEachChild(node, walk);
  };
  walk(sourceFile);
  return out;
}
