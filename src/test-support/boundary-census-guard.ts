// boundary-census-guard.ts — the Number-guard proof machinery, split from
// boundary-census.ts (#42). Answers one question: given a `Number(x)` call,
// does a `Number.isFinite`-style predicate later in the same scope protect
// EVERY subsequent use of `x` (condition-path analysis, write detection,
// always-exits branches)? The JSON census does not use this module.
import { isFunctionBoundary } from "./boundary-census-shared";
import {
  forEachChild,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isConditionalExpression,
  isIdentifier,
  isIfStatement,
  isPostfixUnaryExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isSourceFile,
  isStatement,
  isThrowStatement,
  isVariableDeclaration,
  SyntaxKind,
  type Block,
  type CallExpression,
  type ConditionalExpression,
  type Expression,
  type Identifier,
  type IfStatement,
  type Node,
  type Statement,
} from "./ts-ast";

const NUMBER_PREDICATES = new Set(["isFinite", "isInteger", "isSafeInteger"]);

export function numberPredicate(
  node: Node,
  identifier?: string,
): CallExpression | null {
  if (
    !isCallExpression(node) ||
    node.arguments.length !== 1 ||
    !isPropertyAccessExpression(node.expression) ||
    !isIdentifier(node.expression.expression) ||
    node.expression.expression.text !== "Number" ||
    !NUMBER_PREDICATES.has(node.expression.name.text)
  )
    return null;
  const [argument] = node.arguments;
  return identifier === undefined ||
    (argument !== undefined &&
      isIdentifier(argument) &&
      argument.text === identifier)
    ? node
    : null;
}

function enclosingScope(node: Node): Node {
  for (
    let parent: Node | undefined = node.parent;
    parent;
    parent = parent.parent
  )
    if (isFunctionBoundary(parent) || isSourceFile(parent)) return parent;
  return node.getSourceFile();
}

function assignedIdentifier(node: CallExpression): string | null {
  for (
    let parent: Node | undefined = node.parent;
    parent;
    parent = parent.parent
  ) {
    if (isVariableDeclaration(parent))
      return isIdentifier(parent.name) ? parent.name.text : null;
    if (isStatement(parent) || isFunctionBoundary(parent)) return null;
  }
  return null;
}

function contains(container: Node, candidate: Node): boolean {
  return (
    container.getStart() <= candidate.getStart() &&
    container.getEnd() >= candidate.getEnd()
  );
}

function ignoredIdentifier(node: Identifier): boolean {
  const parent: Node | undefined = node.parent;
  return (
    (isPropertyAccessExpression(parent) && parent.name === node) ||
    (isPropertyAssignment(parent) && parent.name === node) ||
    (isVariableDeclaration(parent) && parent.name === node)
  );
}

function walkScope(scope: Node, visit: (node: Node) => void): void {
  const walk = (node: Node): void => {
    if (node !== scope && isFunctionBoundary(node)) return;
    visit(node);
    forEachChild(node, walk);
  };
  walk(scope);
}

function statementAlwaysExits(statement: Statement | undefined): boolean {
  if (statement === undefined) return false;
  if (isReturnStatement(statement) || isThrowStatement(statement)) return true;
  if (isBlock(statement))
    return statementAlwaysExits((statement as Block).statements.at(-1));
  return (
    isIfStatement(statement) &&
    statementAlwaysExits(statement.thenStatement) &&
    statementAlwaysExits(statement.elseStatement)
  );
}

function isWrite(node: Identifier): boolean {
  const parent: Node | undefined = node.parent;
  return (
    (isBinaryExpression(parent) &&
      parent.left === node &&
      isAssignmentKind(parent.operatorToken.kind)) ||
    ((isPrefixUnaryExpression(parent) || isPostfixUnaryExpression(parent)) &&
      parent.operand === node &&
      (parent.operator === SyntaxKind.PlusPlusToken ||
        parent.operator === SyntaxKind.MinusMinusToken))
  );
}

function isAssignmentKind(kind: SyntaxKind): boolean {
  return (
    kind >= SyntaxKind.FirstAssignment && kind <= SyntaxKind.LastAssignment
  );
}

function enclosingPredicate(node: Node): CallExpression | null {
  for (
    let parent: Node | undefined = node.parent;
    parent;
    parent = parent.parent
  ) {
    const predicate = numberPredicate(parent);
    if (predicate) return predicate;
    if (isStatement(parent) || isFunctionBoundary(parent)) break;
  }
  return null;
}

function isNegatedBetween(node: Node, ancestor: Node): boolean {
  if (node === ancestor) return false;
  let negated = false;
  for (
    let parent: Node | undefined = node.parent;
    parent;
    parent = parent.parent
  ) {
    if (
      isPrefixUnaryExpression(parent) &&
      parent.operator === SyntaxKind.ExclamationToken
    )
      negated = !negated;
    if (parent === ancestor) break;
  }
  return negated;
}

function booleanPathValid(
  guard: Node,
  condition: Expression,
  safeWhenTrue: boolean,
): boolean {
  const operator = safeWhenTrue
    ? SyntaxKind.AmpersandAmpersandToken
    : SyntaxKind.BarBarToken;
  for (let child: Node = guard; child !== condition; child = child.parent)
    if (
      isBinaryExpression(child.parent) &&
      child.parent.operatorToken.kind !== operator
    )
      return false;
  return true;
}

function conditionUseIsProtected(
  use: Identifier,
  guard: CallExpression,
  condition: Expression,
  safeWhenTrue: boolean,
): boolean {
  const operator = safeWhenTrue
    ? SyntaxKind.AmpersandAmpersandToken
    : SyntaxKind.BarBarToken;
  for (let child: Node = use; child !== condition; child = child.parent) {
    const parent: Node | undefined = child.parent;
    if (
      isBinaryExpression(parent) &&
      parent.operatorToken.kind === operator &&
      contains(parent.left, guard) &&
      contains(parent.right, use)
    )
      return true;
  }
  return false;
}

type GuardContext =
  | { kind: "if"; node: IfStatement }
  | { kind: "ternary"; node: ConditionalExpression };

function guardContext(guard: CallExpression, scope: Node): GuardContext | null {
  for (
    let parent: Node | undefined = guard.parent;
    parent !== scope;
    parent = parent.parent
  ) {
    if (isIfStatement(parent) && contains(parent.expression, guard))
      return { kind: "if", node: parent };
    if (isConditionalExpression(parent) && contains(parent.condition, guard))
      return { kind: "ternary", node: parent };
    if (isStatement(parent)) return null;
  }
  return null;
}

function guardProtectsUses(
  guard: CallExpression,
  conversion: CallExpression,
  scope: Node,
  name: string,
): boolean {
  const context = guardContext(guard, scope);
  if (context === null) return false;
  const condition =
    context.kind === "if" ? context.node.expression : context.node.condition;
  const safeWhenTrue = !isNegatedBetween(guard, condition);
  if (!booleanPathValid(guard, condition, safeWhenTrue)) return false;

  const safeBranch: Statement | Expression | undefined =
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
      !isIdentifier(node) ||
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

export function hasOrderedNumberGuard(node: CallExpression): boolean {
  const parentPredicate = numberPredicate(node.parent);
  if (parentPredicate?.arguments[0] === node) return true;
  const name = assignedIdentifier(node);
  if (name === null) return false;
  const scope = enclosingScope(node);
  const guards: CallExpression[] = [];
  walkScope(scope, (candidate) => {
    const guard = numberPredicate(candidate, name);
    if (guard && guard.getStart() > node.getEnd()) guards.push(guard);
  });
  return guards.some((guard) => guardProtectsUses(guard, node, scope, name));
}
