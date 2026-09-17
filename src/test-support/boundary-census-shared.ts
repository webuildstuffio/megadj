// boundary-census-shared.ts — the census's file-walk + AST-positioning
// half, split from boundary-census.ts (#42): source discovery, TS parsing,
// and the owner/key extraction that both the Number and JSON censuses
// share. No guard-proof logic lives here.
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

export const PRODUCTION_ROOTS = [
  "src",
  "cratedeck/src",
  "cratedeck/shared",
  "cratedeck/web",
  "tools",
];
// fulltags merged into src/fulltags (#193) — "src" already covers it.
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
  return (
    SOURCE_EXTENSIONS.has(extname(basename)) &&
    !parts.some((part) => TEST_DIRECTORIES.has(part)) &&
    !/\.(?:test|spec)\.[cm]?tsx?$/u.test(basename) &&
    !/^test(?:util|[-_]?support)(?:\.|[-_])/u.test(basename)
  );
}

export function productionSources(repo: string): Record<string, string> {
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

export function parseSource(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

export function isFunctionBoundary(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  );
}

export function ownerOf(node: ts.Node): string {
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

export function callSite(
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

/** The census fingerprint: sha256 over the sorted call keys. */
export function censusDigest(calls: readonly BoundaryCall[]): string {
  return createHash("sha256")
    .update(
      calls
        .map((call) => call.key)
        .toSorted()
        .join("\n"),
    )
    .digest("hex");
}
