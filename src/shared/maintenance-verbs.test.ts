import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function caseLabels(source: string): string[] {
  return [...source.matchAll(/^\s*case "([a-z-]+)":/gm)]
    .map((m) => m[1])
    .filter((v): v is string => v !== undefined);
}

describe("issue #32: maintenance command census", () => {
  test("exports exactly the verbs dispatched by both maintenance and cli", async () => {
    const module = await import("./maintenance-cmds");
    const exported: string[] = [...module.MAINTENANCE_VERBS].toSorted();
    const maintenance = caseLabels(read("src/shared/maintenance-cmds.ts"));
    const cliSource = read("src/cli.ts");
    const cli = caseLabels(cliSource);
    const cliMaintenance = cli.filter((v) =>
      exported.includes(v as (typeof exported)[number]),
    );

    expect(exported).toEqual(maintenance.toSorted());
    expect(cliMaintenance).toEqual([]);
    expect(cliSource).toContain("MAINTENANCE_VERBS");
    expect(cliSource).toMatch(
      /MAINTENANCE_VERBS[\s\S]{0,100}\.includes\(command\)/,
    );
  });
});
