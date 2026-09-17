// rb-scripts corpus census (#194): every python program under
// src/rekordbox/rb-scripts/ must (a) exist as a real file — no new
// template-literal python in the rb-* command files — and (b) RENDER to
// valid python through renderKitMarkers, i.e. every #@kit marker in a
// .kit.py file resolves and the composed program parses as python.
// This is the tripwire for both regression directions: a marker the
// renderer doesn't know, and a hand-rolled spawn reverting to `-c`.
import { describe, expect, test } from "bun:test";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { renderKitMarkers } from "./rb-command-kit";

const SCRIPTS_DIR = join(import.meta.dir, "rb-scripts");

describe("rb-scripts corpus (#194)", () => {
  test("corpus exists and every file renders through the kit seam", () => {
    const files: string[] = readdirSync(SCRIPTS_DIR).filter((f) =>
      f.endsWith(".py"),
    );
    expect(files.length).toBeGreaterThan(10);
    const tmpDir = join(tmpdir(), `rbscripts-census-${process.pid}`);
    mkdirSync(tmpDir, { recursive: true });
    const tmp: string = tmpDir;
    try {
      for (const f of files) {
        const file: string = f;
        const src = readFileSync(join(SCRIPTS_DIR, file), "utf8");
        // renderKitMarkers throws on any marker it doesn't know
        const rendered = renderKitMarkers(src);
        expect(rendered).not.toContain("#@kit(");
        expect(rendered).not.toContain("# @kit(");
        writeFileSync(join(tmp, file.replace(/\.kit\.py$/, ".py")), rendered);
      }
      // AST-parse every rendered program with the real interpreter
      const probe = spawnSync("uv", ["run", "python", "-c", SCRIPT], {
        encoding: "utf8",
        timeout: 120_000,
        cwd: tmp,
      });
      expect(probe.status).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("no python template literals in rb-* command files (corpus only)", () => {
    const offenders: string[] = [];
    const dirFiles: string[] = readdirSync(import.meta.dir);
    for (const f of dirFiles) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      if (f === "rb-script-kit.ts" || f === "rb-command-kit.ts") continue;
      const src = readFileSync(join(import.meta.dir, f), "utf8");
      // A python `print(json.dumps(` inside a TS file = an embedded program
      if (src.includes("print(json.dumps(")) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

const SCRIPT = `
import ast, pathlib, sys
bad = []
for p in sorted(pathlib.Path(".").glob("*.py")):
    try:
        ast.parse(p.read_text())
    except SyntaxError as e:
        bad.append((p.name, str(e)))
if bad:
    print(bad)
    sys.exit(1)
print("ok")
`;
