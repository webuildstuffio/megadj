// boundary-census-failure.ts — "did this failure become visible?" analysis
// for the JSON census's bare-catch rule, split from boundary-census.ts
// (#42). A caught boundary failure counts as handled only when the catch
// block SURFACES it: a throw, a failure-shaped return, a console-style
// reporter call, or an assignment to a failure-named variable — all the
// silent-swallow shapes this census exists to reject.
import { isFunctionBoundary } from "./boundary-census-shared";
import {
  forEachChild,
  isBinaryExpression,
  isCallExpression,
  isClassLike,
  isFunctionDeclaration,
  isIdentifier,
  isNewExpression,
  isObjectLiteralExpression,
  isPostfixUnaryExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isShorthandPropertyAssignment,
  isSourceFile,
  isThrowStatement,
  isTryStatement,
  isVariableDeclaration,
  SyntaxKind,
  type BinaryExpression,
  type Block,
  type CallExpression,
  type Expression,
  type FunctionDeclaration,
  type NewExpression,
  type Node,
  type ObjectLiteralExpression,
  type PostfixUnaryExpression,
  type PrefixUnaryExpression,
  type PropertyAccessExpression,
  type TryStatement,
  type VariableDeclaration,
} from "./ts-ast";

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

function identifierName(node: Node): string | null {
  if (isIdentifier(node)) return node.text;
  if (
    (isPropertyAssignment(node) || isShorthandPropertyAssignment(node)) &&
    isIdentifier(node.name)
  )
    return node.name.text;
  return null;
}

/** The `property` parameter is EXPLICITLY typed: under TS7 the widened
 *  inference left it implicit-any (the one TS7006 the #274 probe caught
 *  in this file — keep the annotation through any future seam change). */
function hasFailureProperty(node: Node): boolean {
  if (!isObjectLiteralExpression(node)) return false;
  const literal = node as ObjectLiteralExpression;
  return literal.properties.some((property: Node): boolean => {
    const name = identifierName(property);
    if (name === null) return false;
    if (isFailureName(name)) return true;
    return (
      isPropertyAssignment(property) &&
      (name === "ok" || name === "success") &&
      property.initializer.kind === SyntaxKind.FalseKeyword
    );
  });
}

export function isFailureExpression(node: Expression): boolean {
  if (hasFailureProperty(node)) return true;
  if (isIdentifier(node)) return isFailureName(node.text);
  if (isNewExpression(node)) {
    const newExpr = node as NewExpression;
    return (
      isIdentifier(newExpr.expression) && newExpr.expression.text === "Error"
    );
  }
  return false;
}

function localNames(block: Block): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: Node): void => {
    if (node !== block && isFunctionBoundary(node)) {
      const decl = isFunctionDeclaration(node)
        ? (node as FunctionDeclaration)
        : null;
      if (decl?.name !== undefined) names.add(decl.name.text);
      return;
    }
    if (isVariableDeclaration(node)) {
      const decl = node as VariableDeclaration;
      if (isIdentifier(decl.name)) names.add(decl.name.text);
    }
    forEachChild(node, visit);
  };
  visit(block);
  return names;
}

function isVisibleReporter(
  call: CallExpression,
  locals: ReadonlySet<string>,
): boolean {
  const callee = call.expression;
  if (isIdentifier(callee))
    return !locals.has(callee.text) && isFailureName(callee.text);
  if (!isPropertyAccessExpression(callee)) return false;
  const access = callee as PropertyAccessExpression;
  const method = access.name.text;
  if (method !== "error" && method !== "warn") return false;
  return (
    !isIdentifier(access.expression) || !locals.has(access.expression.text)
  );
}

function isAssignment(kind: SyntaxKind): boolean {
  return (
    kind >= SyntaxKind.FirstAssignment && kind <= SyntaxKind.LastAssignment
  );
}

/** One predicate per silent-swallow shape (#199). Splitting the shape
 *  matchers out of the visitor keeps `catchHasVisibleFailure` a flat
 *  dispatch; adding a shape is one row here, not another visitor branch. */
function unaryOperand(node: Node): string | null {
  const unary =
    isPostfixUnaryExpression(node) || isPrefixUnaryExpression(node)
      ? (node as PostfixUnaryExpression | PrefixUnaryExpression)
      : null;
  return unary !== null && isIdentifier(unary.operand)
    ? unary.operand.text
    : null;
}

function failureShapes(
  locals: ReadonlySet<string>,
): ((node: Node) => boolean)[] {
  return [
    (node) => isThrowStatement(node),
    (node) =>
      isReturnStatement(node) &&
      node.expression !== undefined &&
      isFailureExpression(node.expression),
    (node) => isCallExpression(node) && isVisibleReporter(node, locals),
    (node) => {
      if (!isBinaryExpression(node)) return false;
      const binary = node as BinaryExpression;
      const left = isIdentifier(binary.left) ? binary.left : null;
      return (
        left !== null &&
        isAssignment(binary.operatorToken.kind) &&
        !locals.has(left.text) &&
        (isFailureName(left.text) || hasFailureProperty(binary.right))
      );
    },
    (node) => {
      const operand = unaryOperand(node);
      return operand !== null && !locals.has(operand) && isFailureName(operand);
    },
  ];
}

function catchHasVisibleFailure(block: Block): boolean {
  const locals = localNames(block);
  const shapes = failureShapes(locals);
  let visible = false;
  const visit = (node: Node): void => {
    if (
      visible ||
      (node !== block && (isFunctionBoundary(node) || isClassLike(node)))
    )
      return;
    if (shapes.some((matches) => matches(node))) visible = true;
    else forEachChild(node, visit);
  };
  visit(block);
  return visible;
}

export function hasVisibleCatch(node: Node): boolean {
  for (
    let parent: Node | undefined = node.parent;
    parent;
    parent = parent.parent
  ) {
    if (isTryStatement(parent)) {
      const tryStatement = parent as TryStatement;
      return tryStatement.catchClause
        ? catchHasVisibleFailure(tryStatement.catchClause.block)
        : false;
    }
    if (isFunctionBoundary(parent) || isSourceFile(parent)) break;
  }
  return false;
}
