/**
 * shelf-volume-census.test.ts — the executable #55 regression gate: the
 * shelf volume resolves through ONE seam (`resolveShelfVolume`) and the
 * hardcoded `/Volumes/SHELF1` literal class stays extinct in production
 * code. The bug class: any user with a shelf volume not named SHELF1 got
 * nonexistent-mount resolutions, and `MEGADJ_SHELF` vs
 * `MEGADJ_SHELF_VOLUME` silently disagreed between call paths.
 *
 * Pins, derived from the producer sources:
 *   1. Zero `/Volumes/SHELF1` string literals in production TS
 *      (AST-scanned — doc comments stay honest prose).
 *   2. Zero bare `MEGADJ_SHELF` env reads (the deprecated sibling of the
 *      one supported `MEGADJ_SHELF_VOLUME`).
 *   3. `resolveShelfVolume` precedence: explicit arg → env → config,
 *      hermetically via a child process.
 *   4. The Python residue (`rb_art.py` usage docstring + `rb_art_test.py`
 *      test defaults) is pinned so a second executable site cannot appear.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

const ROOT = join(import.meta.dir, "..");

const TS_ROOTS = [
  "src",
  "cratedeck/src",
  "cratedeck/shared",
  "cratedeck/web",
  "fulltags",
  "tools",
];

function isProductionTs(path: string): boolean {
  return (
    /\.(?:ts|tsx)$/u.test(path) &&
    !/\.test\.tsx?$/u.test(path) &&
    !/(^|\/)(test|tests|__tests__|fixtures|test-support)\//u.test(path)
  );
}

function productionTsFiles(): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const p = join(dir, entry.name);
      if (statSync(p).isDirectory()) visit(p);
      else if (isProductionTs(p)) out.push(p);
    }
  };
  for (const root of TS_ROOTS) visit(join(ROOT, root));
  return out;
}

/** String/template literals matching /Volumes/SHELF1 per file, via the TS
 *  AST — doc comments and // prose can never trip the census (no
 *  comment-stripping heuristics needed). */
function shelfLiterals(path: string): { line: number; text: string }[] {
  const sf = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: { line: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    const text = ts.isStringLiteral(node)
      ? node.text
      : ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : null;
    if (text !== null && /\/Volumes\/SHELF1/u.test(text)) {
      out.push({
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text: node.getText(sf).slice(0, 90),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("shelf volume census (issue #55 regression gate)", () => {
  test("zero /Volumes/SHELF1 string literals in production TS", () => {
    const hits: { file: string; line: number; text: string }[] = [];
    for (const p of productionTsFiles()) {
      for (const hit of shelfLiterals(p))
        hits.push({ file: p.slice(ROOT.length + 1), ...hit });
    }
    expect(
      hits,
      `hardcoded SHELF1 literals must route through resolveShelfVolume():\n${hits
        .map((h) => `  ${h.file}:${h.line} ${h.text}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  test("zero bare MEGADJ_SHELF env reads in production TS", () => {
    const hits: string[] = [];
    for (const p of productionTsFiles()) {
      const lines = readFileSync(p, "utf8").split("\n");
      for (const [i, line] of lines.entries()) {
        if (/MEGADJ_SHELF(?!_VOLUME)/u.test(line))
          hits.push(`${p.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
      }
    }
    expect(
      hits,
      `the deprecated MEGADJ_SHELF var must stay extinct (use MEGADJ_SHELF_VOLUME):\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  test("the Python residue stays pinned (docstring + test defaults only)", () => {
    // rb_art.py's only hit lives in its usage docstring; rb_art_test.py's
    // two are hermetic test defaults. A new EXECUTABLE default (argparse
    // `default=` / assignment) in prod Python is the bug class — strip
    // docstrings/comments and pin the executable count at zero.
    const py = readFileSync(join(ROOT, "tools/rb_art.py"), "utf8");
    const noDocstrings = py
      .replace(/"""[\s\S]*?"""/gu, '""')
      .replace(/'''[\s\S]*?'''/gu, "''");
    const executable = noDocstrings
      .split("\n")
      .filter((l) => !/^\s*#/u.test(l));
    const hits = executable.filter((l) => /\/Volumes\/SHELF1/u.test(l));
    expect(
      hits,
      "tools/rb_art.py must not gain an executable SHELF1 default",
    ).toEqual([]);
    // And the known test-file defaults cannot silently multiply.
    const pyTest = readFileSync(join(ROOT, "tools/rb_art_test.py"), "utf8");
    const testDoc = pyTest.replace(/"""[\s\S]*?"""/gu, '""');
    const testExecutable = testDoc.split("\n").filter((l) => !/^\s*#/u.test(l));
    const testHits = testExecutable.filter((l) => /\/Volumes\/SHELF1/u.test(l));
    expect(testHits.length).toBe(2);
  });

  test("resolveShelfVolume precedence: explicit arg → env → config", async () => {
    const script = `
        process.env.CRATEDECK_ROOT = process.env.FAKE_ROOT;
        delete process.env.MEGADJ_SHELF_VOLUME;
        const { resolveShelfVolume } = await import(${JSON.stringify(join(ROOT, "src/shared/volume.ts"))});
        console.log(JSON.stringify([
          resolveShelfVolume("BIGBOX"),                 // explicit wins
          resolveShelfVolume("/abs/path"),              // absolute passthrough
          resolveShelfVolume(),                          // → config default
        ]));
      `;
    const proc = Bun.spawnSync({
      cmd: ["bun", "-e", script],
      env: {
        ...process.env,
        MEGADJ_SHELF_VOLUME: "ENVDRIVE",
        FAKE_ROOT: join(ROOT, "cratedeck"), // repo default config → SHELF1
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    const rows = JSON.parse(proc.stdout.toString().trim()) as string[];
    expect(rows[0]).toBe("/Volumes/BIGBOX");
    expect(rows[1]).toBe("/abs/path");
    expect(rows[2]).toBe("/Volumes/SHELF1"); // cratedeck config.toml absent → default

    // env beats config when no explicit arg is passed
    const proc2 = Bun.spawnSync({
      cmd: [
        "bun",
        "-e",
        script.replace("delete process.env.MEGADJ_SHELF_VOLUME;", ""),
      ],
      env: {
        ...process.env,
        MEGADJ_SHELF_VOLUME: "ENVDRIVE",
        FAKE_ROOT: join(ROOT, "cratedeck"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc2.exitCode).toBe(0);
    const rows2 = JSON.parse(proc2.stdout.toString().trim()) as string[];
    expect(rows2[2]).toBe("/Volumes/ENVDRIVE");
  });
});
