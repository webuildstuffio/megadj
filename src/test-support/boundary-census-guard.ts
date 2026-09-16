// boundary-census-guard.ts — the Number-guard proof machinery, split from
// boundary-census.ts (#42). Answers one question: given a `Number(x)` call,
// does a `Number.isFinite`-style predicate later in the same scope protect
// EVERY subsequent use of `x` (condition-path analysis, write detection,
// always-exits branches)? The JSON census does not use this module.
import * as ts from "typescript";
import { isFunctionBoundary } from "./boundary-census-shared";

const NUMBER_PREDICATES = new Set(["isFinite", "isInteger", "isSafeInteger"]);

export function numberPredicate(
  node: ts.Node,
  identifier?: string,
): ts.CallExpression | null {
  if (
    !ts.isCallExpression(node) ||
    node.arguments.length !== 1 ||
    !ts.isPropertyAccessExpression(node.expression) ||
    !ts.isIdentifier(node.expression.expression) ||
    node.expression.expression.text !== "Number" ||
    !NUMBER_PREDICATES.has(node.expression.name.text)
  )
    return null;
  const [argument] = node.arguments;
  return identifier === undefined ||
    (argument !== undefined &&
      ts.isIdentifier(argument) &&
      argument.text === identifier)
    ? node
    : null;
}

function enclosingScope(node: ts.Node): ts.Node {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (isFunctionBoundary(parent) || ts.isSourceFile(parent)) return parent;
  return node.getSourceFile();
}

function assignedIdentifier(node: ts.CallExpression): string | null {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isVariableDeclaration(parent))
      return ts.isIdentifier(parent.name) ? parent.name.text : null;
    if (ts.isStatement(parent) || isFunctionBoundary(parent)) return null;
  }
  return null;
}

function contains(container: ts.Node, candidate: ts.Node): boolean {
  return (
    container.getStart() <= candidate.getStart() &&
    container.getEnd() >= candidate.getEnd()
  );
}

function ignoredIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node)
  );
}

function walkScope(scope: ts.Node, visit: (node: ts.Node) => void): void {
  const walk = (node: ts.Node): void => {
    if (node !== scope && isFunctionBoundary(node)) return;
    visit(node);
    ts.forEachChild(node, walk);
  };
  walk(scope);
}

function statementAlwaysExits(statement: ts.Statement | undefined): boolean {
  if (statement === undefined) return false;
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement))
    return true;
  if (ts.isBlock(statement))
    return statementAlwaysExits(statement.statements.at(-1));
  return (
    ts.isIfStatement(statement) &&
    statementAlwaysExits(statement.thenStatement) &&
    statementAlwaysExits(statement.elseStatement)
  );
}

function isWrite(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isBinaryExpression(parent) &&
      parent.left === node &&
      isAssignmentKind(parent.operatorToken.kind)) ||
    ((ts.isPrefixUnaryExpression(parent) ||
      ts.isPostfixUnaryExpression(parent)) &&
      parent.operand === node &&
      (parent.operator === ts.SyntaxKind.PlusPlusToken ||
        parent.operator === ts.SyntaxKind.MinusMinusToken))
  );
}

function isAssignmentKind(kind: ts.SyntaxKind): boolean {
  return (
    kind >= ts.SyntaxKind.FirstAssignment &&
    kind <= ts.SyntaxKind.LastAssignment
  );
}

function enclosingPredicate(node: ts.Node): ts.CallExpression | null {
  for (let parent = node.parent; parent; parent = parent.parent) {
    const predicate = numberPredicate(parent);
    if (predicate) return predicate;
    if (ts.isStatement(parent) || isFunctionBoundary(parent)) break;
  }
  return null;
}

function isNegatedBetween(node: ts.Node, ancestor: ts.Node): boolean {
  if (node === ancestor) return false;
  let negated = false;
  for (
    let parent: ts.Node | undefined = node.parent;
    parent;
    parent = parent.parent
  ) {
    if (
      ts.isPrefixUnaryExpression(parent) &&
      parent.operator === ts.SyntaxKind.ExclamationToken
    )
      negated = !negated;
    if (parent === ancestor) break;
  }
  return negated;
}

function booleanPathValid(
  guard: ts.Node,
  condition: ts.Expression,
  safeWhenTrue: boolean,
): boolean {
  const operator = safeWhenTrue
    ? ts.SyntaxKind.AmpersandAmpersandToken
    : ts.SyntaxKind.BarBarToken;
  for (let child = guard; child !== condition; child = child.parent)
    if (
      ts.isBinaryExpression(child.parent) &&
      child.parent.operatorToken.kind !== operator
    )
      return false;
  return true;
}

function conditionUseIsProtected(
  use: ts.Identifier,
  guard: ts.CallExpression,
  condition: ts.Expression,
  safeWhenTrue: boolean,
): boolean {
  const operator = safeWhenTrue
    ? ts.SyntaxKind.AmpersandAmpersandToken
    : ts.SyntaxKind.BarBarToken;
  for (let child: ts.Node = use; child !== condition; child = child.parent) {
    const parent = child.parent;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === operator &&
      contains(parent.left, guard) &&
      contains(parent.right, use)
    )
      return true;
  }
  return false;
}

type GuardContext =
  | { kind: "if"; node: ts.IfStatement }
  | { kind: "ternary"; node: ts.ConditionalExpression };

function guardContext(
  guard: ts.CallExpression,
  scope: ts.Node,
): GuardContext | null {
  for (let parent = guard.parent; parent !== scope; parent = parent.parent) {
    if (ts.isIfStatement(parent) && contains(parent.expression, guard))
      return { kind: "if", node: parent };
    if (ts.isConditionalExpression(parent) && contains(parent.condition, guard))
      return { kind: "ternary", node: parent };
    if (ts.isStatement(parent)) return null;
  }
  return null;
}

function guardProtectsUses(
  guard: ts.CallExpression,
  conversion: ts.CallExpression,
  scope: ts.Node,
  name: string,
): boolean {
  const context = guardContext(guard, scope);
  if (context === null) return false;
  const condition =
    context.kind === "if" ? context.node.expression : context.node.condition;
  const safeWhenTrue = !isNegatedBetween(guard, condition);
  if (!booleanPathValid(guard, condition, safeWhenTrue)) return false;

  const safeBranch =
    context.kind === "if"
      ? safeWhenTrue
        ? context.node.thenStatement
        : context.node.elseStatement
      : safeWhenTrue
        ? context.node.whenTrue
        : context.node.whenFalse;
  const unsafeExits =
    context.kind === "if" &&
    statementAlwaysExits(
      safeWhenTrue ? context.node.elseStatement : context.node.thenStatement,
    );
  let protectedUses = true;

  walkScope(scope, (node) => {
    if (
      !protectedUses ||
      !ts.isIdentifier(node) ||
      node.text !== name ||
      ignoredIdentifier(node) ||
      node.getStart() <= conversion.getEnd() ||
      contains(guard, node)
    )
      return;
    const predicate = enclosingPredicate(node);
    if (predicate && predicate !== guard) return;
    if (isWrite(node)) {
      protectedUses = false;
      return;
    }
    if (node.getStart() < guard.getStart()) {
      protectedUses = false;
      return;
    }
    if (safeBranch && contains(safeBranch, node)) return;
    if (
      contains(condition, node) &&
      conditionUseIsProtected(node, guard, condition, safeWhenTrue)
    )
      return;
    if (
      context.kind === "if" &&
      unsafeExits &&
      node.getStart() > context.node.getEnd()
    )
      return;
    protectedUses = false;
  });
  return protectedUses;
}

export function hasOrderedNumberGuard(node: ts.CallExpression): boolean {
  const parentPredicate = numberPredicate(node.parent);
  if (parentPredicate?.arguments[0] === node) return true;
  const name = assignedIdentifier(node);
  if (name === null) return false;
  const scope = enclosingScope(node);
  const guards: ts.CallExpression[] = [];
  walkScope(scope, (candidate) => {
    const guard = numberPredicate(candidate, name);
    if (guard && guard.getStart() > node.getEnd()) guards.push(guard);
  });
  return guards.some((guard) => guardProtectsUses(guard, node, scope, name));
}
