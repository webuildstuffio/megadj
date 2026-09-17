import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIX = `/tmp/fulltags-cli-options-${Date.now()}`;
mkdirSync(FIX, { recursive: true });

afterAll(() => rmSync(FIX, { recursive: true, force: true }));

function run(...args: string[]): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync([
    process.execPath,
    "run",
    join(import.meta.dir, "..", "cli.ts"),
    FIX,
    "--tags",
    "--dry-run",
    ...args,
  ]);
}

describe("fulltags numeric option safety", () => {
  it("rejects malformed --jobs with exit 2 before doing work", () => {
    const result = run("--jobs", "nope");
    expect(result.exitCode).toBe(2);
    expect(result.stdout?.toString() ?? "").not.toContain("DONE");
  });

  it("rejects missing and zero --jobs values", () => {
    expect(run("--jobs").exitCode).toBe(2);
    expect(run("--jobs", "0").exitCode).toBe(2);
  });

  it("accepts a positive integer worker count", () => {
    expect(run("--jobs", "1").exitCode).toBe(0);
  });
});
