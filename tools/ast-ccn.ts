// ast-ccn.ts — AST-truth CCN per function (census-parity rules), CLI probe.
// Usage: bun tools/ast-ccn.ts <file>... [topN]
// Prints the top-N functions by AST cyclomatic complexity across the given
// files, using the SAME branch-counting rules as
// src/test-support/source-metrics.ts (the measurer the pinned census tests
// use — lizard phantom-folds regex tables and anonymous closures).
import { readFileSync } from "node:fs";
import * as ts from "typescript";

const args = process.argv.slice(2);
// numeric boundary (census-guarded shape): digits-only argv, else the
// default (a typo'd topN silently shrinking the probe was the #105 class;
// a non-numeric trailing arg is usually a FILE path the old ternary
// misread as the count).
const tail = args[args.length - 1] ?? "";
const tailN = Number(tail);
const topN =
  /^\d+$/.test(tail) && Number.isFinite(tailN) && tailN > 0 ? tailN : 10;
if (topN > 0 && /^\d+$/.test(tail)) args.pop();
// list-file mode: --list FILE.txt (one path per line — argv length limits
// make 400+ files unpassable inline)
const listIdx = args.indexOf("--list");
const files =
  listIdx !== -1 && args[listIdx + 1] !== undefined
    ? readFileSync(args[listIdx + 1]!, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : // plain argv mode: every remaining arg is a file path (no --list
      // present, so no list-file slot to excise — the old
      // `i !== listIdx && i !== listIdx + 1` filter ran with listIdx -1
      // and silently dropped index 0, making `<file>` mode print nothing).
      args;
interface Row {
  ccn: number;
  lines: number;
  name: string;
  file: string;
}

const rows: Row[] = [];

function complexity(node: ts.Node): number {
  let n = 1;
  const visit = (x: ts.Node): void => {
    if (
      ts.isIfStatement(x) ||
      ts.isForStatement(x) ||
      ts.isForInStatement(x) ||
      ts.isForOfStatement(x) ||
      ts.isWhileStatement(x) ||
      ts.isDoStatement(x) ||
      ts.isCatchClause(x) ||
      ts.isConditionalExpression(x) ||
      (ts.isCaseClause(x) && x.expression !== undefined) ||
      (ts.isBinaryExpression(x) &&
        (x.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          x.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
    ) {
      n += 1;
    }
    ts.forEachChild(x, visit);
  };
  visit(node);
  return n;
}

for (const file of files) {
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const walk = (node: ts.Node): void => {
    const named =
      (ts.isFunctionDeclaration(node) && node.name?.text) ||
      ((ts.isMethodDeclaration(node) || ts.isFunctionExpression(node)) &&
        node.parent !== undefined);
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isConstructorDeclaration(node)
    ) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      let name = "<anonymous>";
      if (ts.isFunctionDeclaration(node) && node.name) name = node.name.text;
      else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name))
        name = node.name.text;
      else if (ts.isConstructorDeclaration(node)) name = "constructor";
      else if (
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        named &&
        ts.isVariableDeclaration(node.parent) &&
        ts.isIdentifier(node.parent.name)
      )
        name = node.parent.name.text;
      rows.push({
        ccn: complexity(node),
        lines: end.line - start.line + 1,
        name: `${name}@${start.line + 1}-${end.line + 1}`,
        file,
      });
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
}

rows
  .toSorted((a, b) => b.ccn - a.ccn)
  .slice(0, topN)
  .forEach((r) =>
    console.log(`${String(r.ccn).padStart(4)}  ${r.name}  ${r.file}`),
  );
