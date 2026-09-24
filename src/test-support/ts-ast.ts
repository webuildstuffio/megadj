// ts-ast.ts — the repo's ONE TypeScript-compiler-API seam (#274).
//
// Every consumer of the TypeScript compiler API (the AST census measurer, the
// boundary-census family, the CCN probe, per-issue census tests) imports
// through THIS module — never `import * as ts from "typescript"` directly.
// The census `src/census/ts-api-seam-census.test.ts` enforces it repo-wide.
//
// TS7 era (Sep 23, #338 landed): the `typescript` package is now the Go-native
// compiler — its root resolves to a 2-export version stub and its
// `unstable/ast*` subpaths ship the 345 `is*` guards + enums but NO
// text→AST parser (probed live: no createSourceFile anywhere in the package;
// the parser lives inside the native tsc binary). The JS compiler API ships
// separately, so the seam binds the parser/guards/enums to the aliased
// devDep `typescript-compiler-api` (= typescript@5.9.3, the last release with
// the full JS API). The toolchain (tsc, type-coverage, knip) runs on
// typescript@7; ONLY this file imports the compiler-API twin.
//
// Keep this module dependency-free (imports only the compiler-API package)
// so every census, test, and tool loads its AST surface from one place.

import * as ts from "typescript-compiler-api";

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
// Only SyntaxKind is re-exported today; ScriptKind/ScriptTarget are consumed
// inside this module via the namespace import. Add re-exports when a consumer
// appears — knip fails the gate on unused seam surface.
export { SyntaxKind } from "typescript-compiler-api";

// ---- node types used across the census tooling ---------------------------
export type {
  ArrowFunction,
  BinaryExpression,
  Block,
  CallExpression,
  ConditionalExpression,
  ConstructorDeclaration,
  Expression,
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
  PropertyDeclaration,
  SourceFile,
  Statement,
  TryStatement,
  VariableDeclaration,
} from "typescript-compiler-api";
