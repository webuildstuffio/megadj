import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { createHash } from "node:crypto";
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

export function isProductionSourcePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  const basename = parts.at(-1) ?? "";
  if (!SOURCE_EXTENSIONS.has(extname(basename))) return false;
  if (parts.some((part) => TEST_DIRECTORIES.has(part))) return false;
  if (/\.(?:test|spec)\.[cm]?tsx?$/u.test(basename)) return false;
  if (/^test(?:util|[-_]?support)(?:\.|[-_])/u.test(basename)) return false;
  return true;
}

function productionFiles(repo: string): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        TEST_DIRECTORIES.has(entry.name)
      ) {
        continue;
      }
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (isProductionSourcePath(path)) files.push(path);
    }
  };
  for (const root of PRODUCTION_ROOTS) visit(join(repo, root));
  return files.toSorted();
}

function ownerOf(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      (ts.isFunctionDeclaration(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isFunctionExpression(parent)) &&
      parent.name
    ) {
      return parent.name.getText();
    }
    if (
      (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
      ts.isVariableDeclaration(parent.parent) &&
      ts.isIdentifier(parent.parent.name)
    ) {
      return parent.parent.name.text;
    }
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

function parseSource(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function hasFailureProperty(node: ts.Node): boolean {
  let found = false;
  const visit = (candidate: ts.Node): void => {
    if (found) return;
    if (
      (ts.isPropertyAssignment(candidate) ||
        ts.isShorthandPropertyAssignment(candidate)) &&
      ts.isIdentifier(candidate.name) &&
      /^(?:detail|error|errors|unreadable)$/u.test(candidate.name.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function catchHasVisibleFailure(block: ts.Block): boolean {
  const localNames = new Set<string>();
  const findLocals = (candidate: ts.Node): void => {
    if (candidate !== block && ts.isFunctionLike(candidate)) {
      if (ts.isFunctionDeclaration(candidate) && candidate.name)
        localNames.add(candidate.name.text);
      return;
    }
    if (ts.isVariableDeclaration(candidate) && ts.isIdentifier(candidate.name))
      localNames.add(candidate.name.text);
    ts.forEachChild(candidate, findLocals);
  };
  findLocals(block);

  let visible = false;
  const visit = (candidate: ts.Node): void => {
    if (
      candidate !== block &&
      (ts.isFunctionDeclaration(candidate) ||
        ts.isMethodDeclaration(candidate) ||
        ts.isArrowFunction(candidate) ||
        ts.isFunctionExpression(candidate) ||
        ts.isClassDeclaration(candidate) ||
        ts.isClassExpression(candidate))
    ) {
      return;
    }
    if (ts.isThrowStatement(candidate)) {
      visible = true;
      return;
    }
    if (
      ts.isReturnStatement(candidate) &&
      candidate.expression !== undefined &&
      !(
        ts.isIdentifier(candidate.expression) &&
        candidate.expression.text === "undefined"
      )
    ) {
      visible = true;
      return;
    }
    if (
      ts.isCallExpression(candidate) &&
      ts.isPropertyAccessExpression(candidate.expression) &&
      ts.isIdentifier(candidate.expression.expression) &&
      candidate.expression.expression.text === "console" &&
      (candidate.expression.name.text === "error" ||
        candidate.expression.name.text === "warn")
    ) {
      visible = true;
      return;
    }
    if (
      ts.isCallExpression(candidate) &&
      ts.isIdentifier(candidate.expression) &&
      !localNames.has(candidate.expression.text) &&
      /(?:corrupt|error|fail|invalid|log|report|unreadable|warn)/iu.test(
        candidate.expression.text,
      )
    ) {
      visible = true;
      return;
    }
    if (
      ts.isBinaryExpression(candidate) &&
      candidate.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      candidate.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      ts.isIdentifier(candidate.left) &&
      !localNames.has(candidate.left.text) &&
      (/(?:bad|corrupt|error|fail|invalid|unreadable|warn)/iu.test(
        candidate.left.text,
      ) ||
        hasFailureProperty(candidate.right))
    ) {
      visible = true;
      return;
    }
    if (
      (ts.isPostfixUnaryExpression(candidate) ||
        ts.isPrefixUnaryExpression(candidate)) &&
      ts.isIdentifier(candidate.operand) &&
      !localNames.has(candidate.operand.text) &&
      /(?:bad|corrupt|error|fail|invalid|unreadable|warn)/iu.test(
        candidate.operand.text,
      )
    ) {
      visible = true;
      return;
    }
    if (!visible) ts.forEachChild(candidate, visit);
  };
  visit(block);
  return visible;
}

function hasVisibleCatch(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isTryStatement(parent)) {
      return parent.catchClause
        ? catchHasVisibleFailure(parent.catchClause.block)
        : false;
    }
    if (
      ts.isFunctionDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isArrowFunction(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isSourceFile(parent)
    ) {
      break;
    }
  }
  return false;
}

function directNumberGuard(node: ts.CallExpression): boolean {
  const parent = node.parent;
  return (
    ts.isCallExpression(parent) &&
    parent.arguments.includes(node) &&
    ts.isPropertyAccessExpression(parent.expression) &&
    ts.isIdentifier(parent.expression.expression) &&
    parent.expression.expression.text === "Number" &&
    (parent.expression.name.text === "isFinite" ||
      parent.expression.name.text === "isInteger")
  );
}

function enclosingScope(node: ts.Node): ts.Node {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ts.isFunctionDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isArrowFunction(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isSourceFile(parent)
    ) {
      return parent;
    }
  }
  return node.getSourceFile();
}

function assignedIdentifier(node: ts.CallExpression): string | null {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isVariableDeclaration(parent)) {
      return ts.isIdentifier(parent.name) ? parent.name.text : null;
    }
    if (
      ts.isStatement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isArrowFunction(parent) ||
      ts.isFunctionExpression(parent)
    ) {
      return null;
    }
  }
  return null;
}

function finiteGuardForIdentifier(
  node: ts.Node,
  name: string,
): ts.CallExpression | null {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Number" &&
    (node.expression.name.text === "isFinite" ||
      node.expression.name.text === "isInteger") &&
    node.arguments.some(
      (argument) => ts.isIdentifier(argument) && argument.text === name,
    )
  ) {
    return node;
  }
  return null;
}

function statementAlwaysExits(statement: ts.Statement | undefined): boolean {
  if (statement === undefined) return false;
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement))
    return true;
  return (
    ts.isBlock(statement) && statementAlwaysExits(statement.statements.at(-1))
  );
}

function containsNode(container: ts.Node, candidate: ts.Node): boolean {
  return (
    container.getStart() <= candidate.getStart() &&
    container.getEnd() >= candidate.getEnd()
  );
}

function isIdentifierPropertyName(candidate: ts.Identifier): boolean {
  const { parent } = candidate;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === candidate) ||
    (ts.isPropertyAssignment(parent) && parent.name === candidate)
  );
}

function conditionalGuardProtectsUses(
  guard: ts.CallExpression,
  scope: ts.Node,
  conversion: ts.CallExpression,
  name: string,
  negated: boolean,
): boolean {
  let conditional: ts.ConditionalExpression | null = null;
  for (
    let parent = guard.parent;
    parent && parent !== scope;
    parent = parent.parent
  ) {
    if (
      ts.isConditionalExpression(parent) &&
      containsNode(parent.condition, guard)
    ) {
      conditional = parent;
      break;
    }
    if (ts.isStatement(parent)) return false;
  }
  if (conditional === null) return false;

  const requiredOperator = negated
    ? ts.SyntaxKind.BarBarToken
    : ts.SyntaxKind.AmpersandAmpersandToken;
  for (let child: ts.Node = guard; child !== conditional.condition;) {
    const parent = child.parent;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind !== requiredOperator
    ) {
      return false;
    }
    child = parent;
  }

  const safeArm = negated ? conditional.whenFalse : conditional.whenTrue;
  let protectedUses = true;
  const visit = (candidate: ts.Node): void => {
    if (!protectedUses) return;
    if (
      candidate !== scope &&
      (ts.isFunctionDeclaration(candidate) ||
        ts.isMethodDeclaration(candidate) ||
        ts.isArrowFunction(candidate) ||
        ts.isFunctionExpression(candidate))
    ) {
      return;
    }
    if (
      ts.isIdentifier(candidate) &&
      candidate.text === name &&
      !isIdentifierPropertyName(candidate) &&
      candidate.getStart() > conversion.getEnd() &&
      !containsNode(guard, candidate)
    ) {
      if (containsNode(safeArm, candidate)) return;
      if (containsNode(conditional!.condition, candidate)) {
        for (
          let child: ts.Node = candidate;
          child !== conditional!.condition;
        ) {
          const parent = child.parent;
          if (
            ts.isBinaryExpression(parent) &&
            parent.operatorToken.kind === requiredOperator &&
            containsNode(parent.left, guard) &&
            containsNode(parent.right, candidate)
          ) {
            return;
          }
          child = parent;
        }
      }
      protectedUses = false;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(scope);
  return protectedUses;
}

function ifGuardProtectsUses(
  guard: ts.CallExpression,
  scope: ts.Node,
  conversion: ts.CallExpression,
  name: string,
  negated: boolean,
  statement: ts.IfStatement,
): boolean {
  const requiredOperator = negated
    ? ts.SyntaxKind.BarBarToken
    : ts.SyntaxKind.AmpersandAmpersandToken;
  for (let child: ts.Node = guard; child !== statement.expression;) {
    const parent = child.parent;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind !== requiredOperator
    )
      return false;
    child = parent;
  }

  const safeBranch = negated
    ? statement.elseStatement
    : statement.thenStatement;
  const unsafeBranch = negated
    ? statement.thenStatement
    : statement.elseStatement;
  const unsafeExits = statementAlwaysExits(unsafeBranch);
  let protectedUses = true;
  const visit = (candidate: ts.Node): void => {
    if (!protectedUses) return;
    if (
      candidate !== scope &&
      (ts.isFunctionDeclaration(candidate) ||
        ts.isMethodDeclaration(candidate) ||
        ts.isArrowFunction(candidate) ||
        ts.isFunctionExpression(candidate))
    )
      return;
    if (
      ts.isIdentifier(candidate) &&
      candidate.text === name &&
      !isIdentifierPropertyName(candidate) &&
      candidate.getStart() > conversion.getEnd() &&
      !containsNode(guard, candidate)
    ) {
      if (safeBranch && containsNode(safeBranch, candidate)) return;
      if (containsNode(statement.expression, candidate)) {
        for (let child: ts.Node = candidate; child !== statement.expression;) {
          const parent = child.parent;
          if (
            ts.isBinaryExpression(parent) &&
            parent.operatorToken.kind === requiredOperator &&
            containsNode(parent.left, guard) &&
            containsNode(parent.right, candidate)
          )
            return;
          child = parent;
        }
      }
      if (unsafeExits && candidate.getStart() > statement.getEnd()) return;
      protectedUses = false;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(scope);
  return protectedUses;
}

function hasOrderedNumberGuard(node: ts.CallExpression): boolean {
  if (directNumberGuard(node)) return true;
  const name = assignedIdentifier(node);
  if (name === null) return false;

  const scope = enclosingScope(node);
  const guards: ts.CallExpression[] = [];
  const findGuard = (candidate: ts.Node): void => {
    if (
      candidate !== scope &&
      (ts.isFunctionDeclaration(candidate) ||
        ts.isMethodDeclaration(candidate) ||
        ts.isArrowFunction(candidate) ||
        ts.isFunctionExpression(candidate))
    ) {
      return;
    }
    const guard = finiteGuardForIdentifier(candidate, name);
    if (guard && guard.getStart() > node.getEnd()) guards.push(guard);
    ts.forEachChild(candidate, findGuard);
  };
  findGuard(scope);
  const guard = guards.toSorted((a, b) => a.getStart() - b.getStart())[0];
  if (guard === undefined) return false;
  const guardStart = guard.getStart();
  let unsafeUseBeforeGuard = false;
  const findPriorUse = (candidate: ts.Node): void => {
    const isPropertyName =
      candidate.parent !== undefined &&
      ((ts.isPropertyAccessExpression(candidate.parent) &&
        candidate.parent.name === candidate) ||
        (ts.isPropertyAssignment(candidate.parent) &&
          candidate.parent.name === candidate));
    if (
      ts.isIdentifier(candidate) &&
      candidate.text === name &&
      !isPropertyName &&
      candidate.getStart() > node.getEnd() &&
      candidate.getStart() < guardStart
    ) {
      unsafeUseBeforeGuard = true;
      return;
    }
    if (!unsafeUseBeforeGuard) ts.forEachChild(candidate, findPriorUse);
  };
  findPriorUse(scope);
  if (unsafeUseBeforeGuard) return false;

  let guardIf: ts.IfStatement | null = null;
  let negated = false;
  for (
    let parent = guard.parent;
    parent && parent !== scope;
    parent = parent.parent
  ) {
    if (
      ts.isPrefixUnaryExpression(parent) &&
      parent.operator === ts.SyntaxKind.ExclamationToken
    )
      negated = !negated;
    if (
      ts.isIfStatement(parent) &&
      parent.expression.getStart() <= guardStart &&
      parent.expression.getEnd() >= guard.getEnd()
    ) {
      guardIf = parent;
      break;
    }
  }
  if (guardIf === null)
    return conditionalGuardProtectsUses(guard, scope, node, name, negated);
  return ifGuardProtectsUses(guard, scope, node, name, negated, guardIf);
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
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.forEach((call, index) => {
      call.key = `${call.key}#${index + 1}`;
    });
  }
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
  const keys = calls.map((call) => call.key).toSorted();
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
    digest: createHash("sha256").update(keys.join("\n")).digest("hex"),
  };
}

export function scanNumberSource(file: string, text: string): BoundaryCall[] {
  const sourceFile = parseSource(file, text);
  const calls: BoundaryCall[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isNumberCall(node)) {
      calls.push(callSite(sourceFile, node, file));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

export function scanJsonSource(file: string, text: string): BoundaryCall[] {
  const sourceFile = parseSource(file, text);
  const calls: BoundaryCall[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isJsonParse(node)) {
      calls.push(callSite(sourceFile, node, file));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

export function numberBoundaryCensus(
  repo: string,
  allowlist: Readonly<Record<string, string>>,
): CensusResult {
  const sources: Record<string, string> = {};
  for (const path of productionFiles(repo)) {
    sources[relative(repo, path)] = readFileSync(path, "utf8");
  }
  return numberBoundaryCensusForSources(sources, allowlist);
}

export function numberBoundaryCensusForSources(
  sources: Readonly<Record<string, string>>,
  allowlist: Readonly<Record<string, string>>,
): CensusResult {
  const calls: BoundaryCall[] = [];
  const guarded = new Set<BoundaryCall>();
  for (const [file, text] of Object.entries(sources).toSorted(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const sourceFile = parseSource(file, text);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isNumberCall(node)) {
        const call = callSite(sourceFile, node, file);
        calls.push(call);
        if (hasOrderedNumberGuard(node)) {
          guarded.add(call);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return census(calls, guarded, allowlist);
}

export function persistedJsonCensus(
  repo: string,
  allowlist: Readonly<Record<string, string>>,
): CensusResult {
  const sources: Record<string, string> = {};
  for (const path of productionFiles(repo)) {
    sources[relative(repo, path)] = readFileSync(path, "utf8");
  }
  return persistedJsonCensusForSources(sources, allowlist);
}

export function persistedJsonCensusForSources(
  sources: Readonly<Record<string, string>>,
  allowlist: Readonly<Record<string, string>>,
): CensusResult {
  const calls: BoundaryCall[] = [];
  const guarded = new Set<BoundaryCall>();
  for (const [file, text] of Object.entries(sources).toSorted(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const sourceFile = parseSource(file, text);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isJsonParse(node)) {
        const call = callSite(sourceFile, node, file);
        calls.push(call);
        if (call.owner === "parseSnapshotJson" || hasVisibleCatch(node)) {
          guarded.add(call);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return census(calls, guarded, allowlist);
}

export function formatCensusFailure(
  kind: string,
  result: CensusResult,
): string {
  const violations = result.violations.map(
    (call) => `  ${call.file}:${call.line} ${call.source}`,
  );
  const stale = result.unusedAllowlist.map(
    (key) => `  stale allowlist: ${key}`,
  );
  const redundant = result.redundantAllowlist.map(
    (key) => `  redundant allowlist (now guarded): ${key}`,
  );
  const duplicates = result.duplicateKeys.map(
    (key) => `  duplicate fingerprint: ${key}`,
  );
  return [
    `${kind} boundary census failed`,
    ...violations,
    ...stale,
    ...redundant,
    ...duplicates,
    `audited=${result.audited} guarded=${result.guarded} sanctioned=${result.sanctioned}`,
  ].join("\n");
}
