import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import * as ts from "typescript";

export interface BoundaryCall {
  key: string;
  file: string;
  line: number;
  owner: string;
  source: string;
}

export interface CensusResult {
  calls: BoundaryCall[];
  violations: BoundaryCall[];
  unusedAllowlist: string[];
  redundantAllowlist: string[];
  duplicateKeys: string[];
  audited: number;
  guarded: number;
  sanctioned: number;
  digest: string;
}

const PRODUCTION_ROOTS = [
  "src",
  "cratedeck/src",
  "cratedeck/shared",
  "cratedeck/web",
  "fulltags",
  "tools",
];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const TEST_DIRECTORIES = new Set([
  "test",
  "tests",
  "__tests__",
  "fixtures",
  "test-support",
]);
const NUMBER_PREDICATES = new Set(["isFinite", "isInteger", "isSafeInteger"]);
const FAILURE_WORD =
  /^(?:bad|corrupt|errors?|fail(?:ure|ures)?|invalid|log|report(?:ed)?|unreadable|warn(?:ing|ings)?)$/u;

export function isProductionSourcePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  const basename = parts.at(-1) ?? "";
  return (
    SOURCE_EXTENSIONS.has(extname(basename)) &&
    !parts.some((part) => TEST_DIRECTORIES.has(part)) &&
    !/\.(?:test|spec)\.[cm]?tsx?$/u.test(basename) &&
    !/^test(?:util|[-_]?support)(?:\.|[-_])/u.test(basename)
  );
}

function productionSources(repo: string): Record<string, string> {
  const sources: Record<string, string> = {};
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        TEST_DIRECTORIES.has(entry.name)
      )
        continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (isProductionSourcePath(path))
        sources[relative(repo, path)] = readFileSync(path, "utf8");
    }
  };
  for (const root of PRODUCTION_ROOTS) visit(join(repo, root));
  return sources;
}

function parseSource(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function isFunctionBoundary(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  );
}

function ownerOf(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      (ts.isFunctionDeclaration(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isFunctionExpression(parent)) &&
      parent.name
    )
      return parent.name.getText();
    if (
      (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
      ts.isVariableDeclaration(parent.parent) &&
      ts.isIdentifier(parent.parent.name)
    )
      return parent.parent.name.text;
  }
  return "<module>";
}

function callSite(
  sourceFile: ts.SourceFile,
  node: ts.CallExpression,
  file: string,
): BoundaryCall {
  const source = node.getText(sourceFile).replace(/\s+/g, " ");
  const owner = ownerOf(node);
  return {
    key: `${file}::${owner}::${source}`,
    file,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    owner,
    source,
  };
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

function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

function isFailureName(name: string): boolean {
  return nameWords(name).some((word) => FAILURE_WORD.test(word));
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

function isFailureExpression(node: ts.Expression): boolean {
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

function catchHasVisibleFailure(block: ts.Block): boolean {
  const locals = localNames(block);
  let visible = false;
  const visit = (node: ts.Node): void => {
    if (
      visible ||
      (node !== block && (isFunctionBoundary(node) || ts.isClassLike(node)))
    )
      return;
    if (ts.isThrowStatement(node)) visible = true;
    else if (
      ts.isReturnStatement(node) &&
      node.expression !== undefined &&
      isFailureExpression(node.expression)
    )
      visible = true;
    else if (ts.isCallExpression(node) && isVisibleReporter(node, locals))
      visible = true;
    else if (
      ts.isBinaryExpression(node) &&
      isAssignment(node.operatorToken.kind) &&
      ts.isIdentifier(node.left) &&
      !locals.has(node.left.text) &&
      (isFailureName(node.left.text) || hasFailureProperty(node.right))
    )
      visible = true;
    else if (
      (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
      ts.isIdentifier(node.operand) &&
      !locals.has(node.operand.text) &&
      isFailureName(node.operand.text)
    )
      visible = true;
    else ts.forEachChild(node, visit);
  };
  visit(block);
  return visible;
}

function hasVisibleCatch(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isTryStatement(parent))
      return parent.catchClause
        ? catchHasVisibleFailure(parent.catchClause.block)
        : false;
    if (isFunctionBoundary(parent) || ts.isSourceFile(parent)) break;
  }
  return false;
}

function numberPredicate(
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
      isAssignment(parent.operatorToken.kind)) ||
    ((ts.isPrefixUnaryExpression(parent) ||
      ts.isPostfixUnaryExpression(parent)) &&
      parent.operand === node &&
      (parent.operator === ts.SyntaxKind.PlusPlusToken ||
        parent.operator === ts.SyntaxKind.MinusMinusToken))
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

function hasOrderedNumberGuard(node: ts.CallExpression): boolean {
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

function isNumberCall(node: ts.CallExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === "Number";
}

function isJsonParse(node: ts.CallExpression): boolean {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "JSON" &&
    node.expression.name.text === "parse"
  );
}

function disambiguateDuplicateKeys(calls: BoundaryCall[]): void {
  const groups = new Map<string, BoundaryCall[]>();
  for (const call of calls) {
    const group = groups.get(call.key) ?? [];
    group.push(call);
    groups.set(call.key, group);
  }
  for (const group of groups.values())
    if (group.length > 1)
      group.forEach((call, index) => {
        call.key += `#${index + 1}`;
      });
}

function census(
  calls: BoundaryCall[],
  guardedCalls: ReadonlySet<BoundaryCall>,
  allowlist: Readonly<Record<string, string>>,
): CensusResult {
  disambiguateDuplicateKeys(calls);
  const guardedKeys = new Set(
    calls.filter((call) => guardedCalls.has(call)).map((call) => call.key),
  );
  const actualKeys = new Set(calls.map((call) => call.key));
  const violations = calls.filter(
    (call) => !guardedKeys.has(call.key) && allowlist[call.key] === undefined,
  );
  const sanctioned = calls.filter(
    (call) => !guardedKeys.has(call.key) && allowlist[call.key] !== undefined,
  ).length;
  return {
    calls: calls.toSorted((a, b) => a.key.localeCompare(b.key)),
    violations,
    unusedAllowlist: Object.keys(allowlist).filter(
      (key) => !actualKeys.has(key),
    ),
    redundantAllowlist: Object.keys(allowlist).filter(
      (key) => actualKeys.has(key) && guardedKeys.has(key),
    ),
    duplicateKeys: [],
    audited: calls.length,
    guarded: guardedKeys.size,
    sanctioned,
    digest: createHash("sha256")
      .update(
        calls
          .map((call) => call.key)
          .toSorted()
          .join("\n"),
      )
      .digest("hex"),
  };
}

type CallPredicate = (node: ts.CallExpression) => boolean;
type GuardPredicate = (node: ts.CallExpression, call: BoundaryCall) => boolean;

function scanSources(
  sources: Readonly<Record<string, string>>,
  matches: CallPredicate,
  guardedBy: GuardPredicate = () => false,
): { calls: BoundaryCall[]; guarded: Set<BoundaryCall> } {
  const calls: BoundaryCall[] = [];
  const guarded = new Set<BoundaryCall>();
  for (const [file, text] of Object.entries(sources).toSorted(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const sourceFile = parseSource(file, text);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && matches(node)) {
        const call = callSite(sourceFile, node, file);
        calls.push(call);
        if (guardedBy(node, call)) guarded.add(call);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { calls, guarded };
}

function scanOne(
  file: string,
  text: string,
  matches: CallPredicate,
): BoundaryCall[] {
  return scanSources({ [file]: text }, matches).calls;
}

export function scanNumberSource(file: string, text: string): BoundaryCall[] {
  return scanOne(file, text, isNumberCall);
}

export function scanJsonSource(file: string, text: string): BoundaryCall[] {
  return scanOne(file, text, isJsonParse);
}

export function numberBoundaryCensus(
  repo: string,
  allowlist: Readonly<Record<string, string>>,
): CensusResult {
  return numberBoundaryCensusForSources(productionSources(repo), allowlist);
}

export function numberBoundaryCensusForSources(
  sources: Readonly<Record<string, string>>,
  allowlist: Readonly<Record<string, string>>,
): CensusResult {
  const { calls, guarded } = scanSources(sources, isNumberCall, (node) =>
    hasOrderedNumberGuard(node),
  );
  return census(calls, guarded, allowlist);
}

export function persistedJsonCensus(
  repo: string,
  allowlist: Readonly<Record<string, string>>,
): CensusResult {
  return persistedJsonCensusForSources(productionSources(repo), allowlist);
}

export function persistedJsonCensusForSources(
  sources: Readonly<Record<string, string>>,
  allowlist: Readonly<Record<string, string>>,
): CensusResult {
  const { calls, guarded } = scanSources(
    sources,
    isJsonParse,
    (node, call) => call.owner === "parseSnapshotJson" || hasVisibleCatch(node),
  );
  return census(calls, guarded, allowlist);
}

export function formatCensusFailure(
  kind: string,
  result: CensusResult,
): string {
  return [
    `${kind} boundary census failed`,
    ...result.violations.map(
      (call) => `  ${call.file}:${call.line} ${call.source}`,
    ),
    ...result.unusedAllowlist.map((key) => `  stale allowlist: ${key}`),
    ...result.redundantAllowlist.map(
      (key) => `  redundant allowlist (now guarded): ${key}`,
    ),
    ...result.duplicateKeys.map((key) => `  duplicate fingerprint: ${key}`),
    `audited=${result.audited} guarded=${result.guarded} sanctioned=${result.sanctioned}`,
  ].join("\n");
}
