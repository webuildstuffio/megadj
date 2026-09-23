// ts-ast.ts — the repo's ONE TypeScript-compiler-API seam (#274).
//
// Every consumer of the `typescript` package (the AST census measurer, the
// boundary-census family, the CCN probe, per-issue census tests) imports
// through THIS module — never `import * as ts from "typescript"` directly.
// The census `src/census/ts-api-seam-census.test.ts` enforces it repo-wide.
//
// Why the seam exists: TS7 (the Go-native compiler, measured Sep 20-22)
// drops the compiler API from the package root — `import * as ts from
// "typescript"` resolves to a 2-export version stub under TS7, and the AST
// surface moves behind `typescript/unstable/ast*` subpaths that (as probed
// live against typescript@7.0.2) ship the 345 `is*` guards + enums but NO
// text→SourceFile parser (`createSourceFile` there only assembles
// pre-parsed statements; the parser lives behind the `unstable/sync`
// Program server API). The day `typescript@7` lands in devDependencies,
// THIS is the only file that migrates — and every census that depends on
// these helpers keeps its pinned digests byte-identical.
//
// Keep this module dependency-free (imports only `typescript`) so both the
// TS5 and TS7 eras can load it from any census, test, or tool.

import * as ts from "typescript";

/** Parse `text` as a TS/TSX source file at the latest supported target,
 *  with parent pointers set. TSX is chosen purely by the `.tsx` suffix —
 *  the same convention every caller used before the seam. */
export function parseSourceFile(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Walk one level of the AST. Typed alias (not a re-export) so the TS7-era
 *  migration can rebind the implementation without touching callers. */
export const forEachChild: typeof ts.forEachChild = ts.forEachChild;

// ---- type-narrowing guards (typed aliases preserve the type predicates) --
export const isArrowFunction: typeof ts.isArrowFunction = ts.isArrowFunction;
export const isBinaryExpression: typeof ts.isBinaryExpression =
  ts.isBinaryExpression;
export const isBlock: typeof ts.isBlock = ts.isBlock;
export const isCallExpression: typeof ts.isCallExpression = ts.isCallExpression;
export const isCaseClause: typeof ts.isCaseClause = ts.isCaseClause;
export const isCatchClause: typeof ts.isCatchClause = ts.isCatchClause;
export const isClassDeclaration: typeof ts.isClassDeclaration =
  ts.isClassDeclaration;
export const isClassLike: typeof ts.isClassLike = ts.isClassLike;
export const isConditionalExpression: typeof ts.isConditionalExpression =
  ts.isConditionalExpression;
export const isConstructorDeclaration: typeof ts.isConstructorDeclaration =
  ts.isConstructorDeclaration;
export const isDoStatement: typeof ts.isDoStatement = ts.isDoStatement;
export const isForInStatement: typeof ts.isForInStatement = ts.isForInStatement;
export const isForOfStatement: typeof ts.isForOfStatement = ts.isForOfStatement;
export const isForStatement: typeof ts.isForStatement = ts.isForStatement;
export const isFunctionDeclaration: typeof ts.isFunctionDeclaration =
  ts.isFunctionDeclaration;
export const isFunctionExpression: typeof ts.isFunctionExpression =
  ts.isFunctionExpression;
export const isIdentifier: typeof ts.isIdentifier = ts.isIdentifier;
export const isIfStatement: typeof ts.isIfStatement = ts.isIfStatement;
export const isMethodDeclaration: typeof ts.isMethodDeclaration =
  ts.isMethodDeclaration;
export const isNewExpression: typeof ts.isNewExpression = ts.isNewExpression;
export const isNoSubstitutionTemplateLiteral: typeof ts.isNoSubstitutionTemplateLiteral =
  ts.isNoSubstitutionTemplateLiteral;
export const isObjectLiteralExpression: typeof ts.isObjectLiteralExpression =
  ts.isObjectLiteralExpression;
export const isPostfixUnaryExpression: typeof ts.isPostfixUnaryExpression =
  ts.isPostfixUnaryExpression;
export const isPrefixUnaryExpression: typeof ts.isPrefixUnaryExpression =
  ts.isPrefixUnaryExpression;
export const isPropertyAccessExpression: typeof ts.isPropertyAccessExpression =
  ts.isPropertyAccessExpression;
export const isPropertyAssignment: typeof ts.isPropertyAssignment =
  ts.isPropertyAssignment;
export const isPropertyDeclaration: typeof ts.isPropertyDeclaration =
  ts.isPropertyDeclaration;
export const isReturnStatement: typeof ts.isReturnStatement =
  ts.isReturnStatement;
export const isShorthandPropertyAssignment: typeof ts.isShorthandPropertyAssignment =
  ts.isShorthandPropertyAssignment;
export const isSourceFile: typeof ts.isSourceFile = ts.isSourceFile;
export const isStatement: typeof ts.isStatement = ts.isStatement;
export const isStringLiteral: typeof ts.isStringLiteral = ts.isStringLiteral;
export const isThrowStatement: typeof ts.isThrowStatement = ts.isThrowStatement;
export const isTryStatement: typeof ts.isTryStatement = ts.isTryStatement;
export const isVariableDeclaration: typeof ts.isVariableDeclaration =
  ts.isVariableDeclaration;
export const isWhileStatement: typeof ts.isWhileStatement = ts.isWhileStatement;

// ---- enums (value + type in one name, as the compiler API exposes them) --
export { ScriptKind, ScriptTarget, SyntaxKind } from "typescript";

// ---- node types used across the census tooling ---------------------------
export type {
  ArrowFunction,
  BinaryExpression,
  Block,
  CallExpression,
  CaseClause,
  CatchClause,
  ClassDeclaration,
  ConditionalExpression,
  ConstructorDeclaration,
  Expression,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  IfStatement,
  MethodDeclaration,
  NewExpression,
  Node,
  ObjectLiteralExpression,
  PostfixUnaryExpression,
  PrefixUnaryExpression,
  PropertyAccessExpression,
  PropertyAssignment,
  PropertyDeclaration,
  SourceFile,
  Statement,
  ShorthandPropertyAssignment,
  TryStatement,
  VariableDeclaration,
} from "typescript";
