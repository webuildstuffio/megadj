import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function tableKeys(source: string): string[] {
  // the MAINTENANCE_COMMANDS table's quoted keys ("verb": handler)
  const table = source.match(/MAINTENANCE_COMMANDS[\s\S]*?=\s*\{[\s\S]*?\n\};/);
  if (!table) return [];
  return [...table[0].matchAll(/"([a-z-]+)":\s*\w+Cmd/g)].map(
    (m) => m[1] ?? "",
  );
}

describe("issue #32: maintenance command census", () => {
  test("exports exactly the verbs dispatched by both maintenance and cli", async () => {
    const module = await import("./maintenance-cmds");
    const exported: string[] = [...module.MAINTENANCE_VERBS].toSorted();
    const table = tableKeys(read("src/shared/maintenance-cmds.ts")).toSorted();
    const cliSource = read("src/cli.ts");
    const cliMaintenance = exported.filter(
      (v) =>
        (module.MAINTENANCE_VERBS as readonly string[]).includes(v) &&
        !table.includes(v),
    );

    // producer + table never drift: every verb has exactly one arm
    expect(table).toEqual(exported);
    expect(cliMaintenance).toEqual([]);
    expect(cliSource).toContain("MAINTENANCE_VERBS");
    expect(cliSource).toMatch(
      /MAINTENANCE_VERBS[\s\S]{0,100}\.includes\(command\)/,
    );
  });

  test("the dispatch table is the producer — table lookup, not a switch (#88)", () => {
    const source = read("src/shared/maintenance-cmds.ts");
    // the CCN-67 switch is gone: no `case "<verb>"` labels remain, and
    // the runner is a table lookup
    expect(source).not.toMatch(/^\s*case "[a-z-]+":/m);
    expect(source).toContain("MAINTENANCE_COMMANDS[command");
  });
});
