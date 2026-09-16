import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { runCli, cliEnv } from "./test-support/cli-run";

/**
 * Regression guard for the numeric-option contract: a non-numeric or
 * negative `--limit`/`--target-total` must ABORT the command case — never
 * flow through as NaN, which is falsy and would skip every slice/stop
 * guard downstream (sync: an unbounded download run; cues: the whole
 * ledger derived; beats/mood: silent zero work with exit 2). The CLI
 * prints the validation error and exits 2 WITHOUT doing the work.
 */

describe("numeric option validation: invalid input aborts, never runs", () => {
  const dir = mkdtempSync("/tmp/megadj-numopt-test-");
  const env = cliEnv(dir);

  for (const bad of ["abc", "-5", "10o", ""]) {
    test(`sync --limit ${JSON.stringify(bad)} refuses to start`, async () => {
      const { code, stderr, stdout } = await runCli(
        ["sync", "--limit", bad, "--json"],
        env,
      );
      // --json run: the error object goes to STDOUT (the one parseable
      // channel), nothing on the human channel (#160 ring 3).
      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout.trim().split("\n").pop() ?? "") as {
        command?: string;
        error?: string;
      };
      expect(parsed.error).toContain("--limit must be a non-negative number");
      expect(code).toBe(2);
    });

    test(`cues --limit ${JSON.stringify(bad)} refuses to derive`, async () => {
      const { code, stderr } = await runCli(["cues", "--limit", bad], env);
      expect(stderr).toContain("--limit must be a non-negative number");
      expect(code).toBe(2);
    });
  }

  test("sync --target-total 10o refuses to start", async () => {
    const { code, stdout } = await runCli(
      ["sync", "--target-total", "10o", "--json"],
      env,
    );
    // json mode: error object on stdout, stderr clean (#160 ring 3)
    const parsed = JSON.parse(stdout.trim().split("\n").pop() ?? "") as {
      error?: string;
    };
    expect(parsed.error).toContain(
      "--target-total must be a non-negative number",
    );
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
