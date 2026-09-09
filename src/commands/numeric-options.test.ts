import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

/**
 * Regression guard for the numeric-option contract: a non-numeric or
 * negative `--limit`/`--target-total` must ABORT the command case — never
 * flow through as NaN, which is falsy and would skip every slice/stop
 * guard downstream (sync: an unbounded download run; cues: the whole
 * ledger derived; beats/mood: silent zero work with exit 2). The CLI
 * prints the validation error and exits 2 WITHOUT doing the work.
 */

async function runCli(args: string[], env: Record<string, string>) {
  // process.execPath = the real bun binary — NOT the `bun` name on PATH,
  // which can be a shell shim that itself chokes on empty-string args.
  const proc =
    await $`${process.execPath} run ${join(import.meta.dir, "../cli.ts")} ${args}`
      .env({ ...process.env, ...env })
      .quiet()
      .nothrow();
  return {
    code: proc.exitCode,
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

describe("numeric option validation: invalid input aborts, never runs", () => {
  const dir = mkdtempSync("/tmp/megadj-numopt-test-");
  const env = {
    MEGADJ_DB: join(dir, "archive.db"),
    MEGADJ_MUSIC_DIR: join(dir, "music"),
    MEGADJ_COOKIES: "",
  };

  for (const bad of ["abc", "-5", "10o", ""]) {
    test(`sync --limit ${JSON.stringify(bad)} refuses to start`, async () => {
      const { code, stderr } = await runCli(
        ["sync", "--limit", bad, "--json"],
        env,
      );
      expect(stderr).toContain("--limit must be a non-negative number");
      expect(code).toBe(2);
    });

    test(`cues --limit ${JSON.stringify(bad)} refuses to derive`, async () => {
      const { code, stderr } = await runCli(["cues", "--limit", bad], env);
      expect(stderr).toContain("--limit must be a non-negative number");
      expect(code).toBe(2);
    });
  }

  test("sync --target-total 10o refuses to start", async () => {
    const { code, stderr } = await runCli(
      ["sync", "--target-total", "10o", "--json"],
      env,
    );
    expect(stderr).toContain("--target-total must be a non-negative number");
    expect(code).toBe(2);
  });

  test("beats --limit abc does zero work and exits 2 (no silent success)", async () => {
    const { code, stderr } = await runCli(["beats", "--limit", "abc"], env);
    expect(stderr).toContain("--limit must be a non-negative number");
    expect(code).toBe(2);
  });

  test("upgrade --limit abc does zero work and exits 2", async () => {
    const { code, stderr } = await runCli(["upgrade", "--limit", "abc"], env);
    expect(stderr).toContain("--limit must be a non-negative number");
    expect(code).toBe(2);
  });

  test("mood --limit abc does zero work and exits 2", async () => {
    const { code, stderr } = await runCli(["mood", "--limit", "abc"], env);
    expect(stderr).toContain("--limit must be a non-negative number");
    expect(code).toBe(2);
  });

  test("valid limit still works (cues --limit 0 = derive nothing, exit 0)", async () => {
    const { code, stderr } = await runCli(
      ["cues", "--limit", "0", "--json"],
      env,
    );
    expect(stderr).not.toContain("must be a non-negative number");
    expect(code).toBe(0);
  });
});
