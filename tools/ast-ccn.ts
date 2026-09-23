// ast-ccn.ts — AST-truth CCN per function (census-parity rules), CLI probe.
// Usage: bun tools/ast-ccn.ts <file>... [topN]
// Prints the top-N functions by AST cyclomatic complexity across the given
// files, using the SAME branch-counting rules as
// src/test-support/source-metrics.ts (the measurer the pinned census tests
// use — lizard phantom-folds regex tables and anonymous closures). The
// branch rules themselves now live THERE (isBranchNode, shared via the
// #274 compiler-API seam rewrite) — this probe consumes allFunctions()
// directly instead of carrying a hand-copied walker twin.
import { readFileSync } from "node:fs";
import { allFunctions } from "../src/test-support/source-metrics";

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
for (const file of files) {
  for (const fn of allFunctions(file)) {
    rows.push({
      ccn: fn.cyclomaticComplexity,
      lines: fn.lines,
      name: `${fn.name}@${fn.startLine}-${fn.endLine}`,
      file,
    });
  }
}

rows
  .toSorted((a, b) => b.ccn - a.ccn)
  .slice(0, topN)
  .forEach((r) =>
    console.log(`${String(r.ccn).padStart(4)}  ${r.name}  ${r.file}`),
  );
