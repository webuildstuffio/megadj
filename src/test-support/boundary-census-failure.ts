// boundary-census-failure.ts — "did this failure become visible?" analysis
// for the JSON census's bare-catch rule, split from boundary-census.ts
// (#42). A caught boundary failure counts as handled only when the catch
// block SURFACES it: a throw, a failure-shaped return, a console-style
// reporter call, or an assignment to a failure-named variable — all the
// silent-swallow shapes this census exists to reject.
import * as ts from "typescript";
import { isFunctionBoundary } from "./boundary-census-shared";

const FAILURE_WORD =
  /^(?:bad|corrupt|errors?|fail(?:ure|ures)?|invalid|log|report(?:ed)?|unreadable|warn(?:ing|ings)?)$/u;

export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

export function isFailureName(name: string): boolean {
  return nameWords(name).some((word) => FAILURE_WORD.test(word));
}

function identifierName(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (
    (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
    ts.isIdentifier(node.name)
  )
    return node.name.text;
  return null;
}

function hasFailureProperty(node: ts.Node): boolean {
  if (!ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some((property) => {
    const name = identifierName(property);
    if (name === null) return false;
    if (isFailureName(name)) return true;
    return (
      ts.isPropertyAssignment(property) &&
      (name === "ok" || name === "success") &&
      property.initializer.kind === ts.SyntaxKind.FalseKeyword
    );
  });
}

export function isFailureExpression(node: ts.Expression): boolean {
  return (
    hasFailureProperty(node) ||
    (ts.isIdentifier(node) && isFailureName(node.text)) ||
    (ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Error")
  );
}

function localNames(block: ts.Block): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node !== block && isFunctionBoundary(node)) {
      if (ts.isFunctionDeclaration(node) && node.name)
        names.add(node.name.text);
      return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
      names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(block);
  return names;
}

function isVisibleReporter(
  call: ts.CallExpression,
  locals: ReadonlySet<string>,
): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee))
    return !locals.has(callee.text) && isFailureName(callee.text);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const method = callee.name.text;
  if (method !== "error" && method !== "warn") return false;
  return (
    !ts.isIdentifier(callee.expression) || !locals.has(callee.expression.text)
  );
}

function isAssignment(kind: ts.SyntaxKind): boolean {
  return (
    kind >= ts.SyntaxKind.FirstAssignment &&
    kind <= ts.SyntaxKind.LastAssignment
  );
}

/** One predicate per silent-swallow shape (#199). Splitting the shape
 *  matchers out of the visitor keeps `catchHasVisibleFailure` a flat
 *  dispatch; adding a shape is one row here, not another visitor branch. */
function failureShapes(
  locals: ReadonlySet<string>,
): ((node: ts.Node) => boolean)[] {
  return [
    (node) => ts.isThrowStatement(node),
    (node) =>
      ts.isReturnStatement(node) &&
      node.expression !== undefined &&
      isFailureExpression(node.expression),
    (node) => ts.isCallExpression(node) && isVisibleReporter(node, locals),
    (node) =>
      ts.isBinaryExpression(node) &&
      isAssignment(node.operatorToken.kind) &&
      ts.isIdentifier(node.left) &&
      !locals.has(node.left.text) &&
      (isFailureName(node.left.text) || hasFailureProperty(node.right)),
    (node) =>
      (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
      ts.isIdentifier(node.operand) &&
      !locals.has(node.operand.text) &&
      isFailureName(node.operand.text),
  ];
}

function catchHasVisibleFailure(block: ts.Block): boolean {
  const locals = localNames(block);
  const shapes = failureShapes(locals);
  let visible = false;
  const visit = (node: ts.Node): void => {
    if (
      visible ||
      (node !== block && (isFunctionBoundary(node) || ts.isClassLike(node)))
    )
      return;
    if (shapes.some((matches) => matches(node))) visible = true;
    else ts.forEachChild(node, visit);
  };
  visit(block);
  return visible;
}

export function hasVisibleCatch(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isTryStatement(parent))
      return parent.catchClause
        ? catchHasVisibleFailure(parent.catchClause.block)
        : false;
    if (isFunctionBoundary(parent) || ts.isSourceFile(parent)) break;
  }
  return false;
}
