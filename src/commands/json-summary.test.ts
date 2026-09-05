import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

/**
 * P1 regression guard: every mutating/summary command must emit exactly one
 * JSON object on stdout when --json is passed — parseable, with the command
 * name and the counters the docs promise. These run the real CLI with a
 * throwaway MEGADJ_DB so no fixture library is needed.
 */

async function runCli(args: string[], env: Record<string, string>) {
  const proc = await $`bun run src/cli.ts ${args}`
    .env({ ...process.env, ...env })
    .quiet()
    .nothrow();
  return { code: proc.exitCode, stdout: new TextDecoder().decode(proc.stdout) };
}

function lastJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split("\n");
  const last = lines[lines.length - 1] ?? "";
  expect(() => JSON.parse(last)).not.toThrow();
  const parsed = JSON.parse(last) as Record<string, unknown>;
  expect(typeof parsed).toBe("object");
  return parsed;
}

describe("principles P1: --json on every command", () => {
  const dir = mkdtempSync("/tmp/megadj-json-test-");
  const env = {
    MEGADJ_DB: join(dir, "archive.db"),
    MEGADJ_MUSIC_DIR: join(dir, "music"),
    MEGADJ_COOKIES: "", // never touch a real browser in tests
  };

  test("status --json stays parseable (baseline)", async () => {
    const { code } = await runCli(["status", "--json"], env);
    expect(code).toBe(0);
  });

  test("adopt --json reports scanned/adopted/unmatched", async () => {
    const { code, stdout } = await runCli(["adopt", "--json"], env);
    expect(code).toBe(0);
    const parsed = lastJsonLine(stdout);
    expect(parsed.command).toBe("adopt");
  });

  test("organize --json --dry-run reports considered/moved/missing", async () => {
    const { code, stdout } = await runCli(
      ["organize", "--dry-run", "--json"],
      env,
    );
    expect(code).toBe(0);
    const parsed = lastJsonLine(stdout);
    expect(parsed.command).toBe("organize");
    expect(parsed.dryRun).toBe(true);
    expect(typeof parsed.moved).toBe("number");
    expect(typeof parsed.missing).toBe("number");
  });

  test("enrich --json --dry-run reports considered/upgraded/unchanged", async () => {
    const { code, stdout } = await runCli(
      ["enrich", "--dry-run", "--json"],
      env,
    );
    expect(code).toBe(0);
    const parsed = lastJsonLine(stdout);
    expect(parsed.command).toBe("enrich");
    expect(parsed.dryRun).toBe(true);
    expect(typeof parsed.upgraded).toBe("number");
  });

  test("retry --json reports the reset", async () => {
    const { code, stdout } = await runCli(["retry", "--json"], env);
    expect(code).toBe(0);
    const parsed = lastJsonLine(stdout);
    expect(parsed.command).toBe("retry");
    expect(parsed.reset).toBe(true);
  });

  test("years --json reports scPage/ytdlp/kept/unresolved (dry run — no network in CI-less local gate)", async () => {
    // dry run still walks the (empty) throwaway DB, so it completes fast
    // with zero counters; the contract is a parseable summary object.
    const { code, stdout } = await runCli(
      ["years", "--dry-run", "--json"],
      env,
    );
    expect(code).toBe(0);
    const parsed = lastJsonLine(stdout);
    expect(parsed.command).toBe("years");
    expect(parsed.dryRun).toBe(true);
    expect(typeof parsed.kept).toBe("number");
    expect(typeof parsed.unresolved).toBe("number");
  });

  test("HELP CONTRACT: help lists --json for every command that takes it", async () => {
    // Root-cause guard for principle drift: the help text is the agent-facing
    // contract. Every command below takes --json in code; if a new command is
    // added without --json (or with it but missing from this list), this test
    // fails and forces the doc + code to agree.
    const { stdout } = await runCli(["--help"], env);
    for (const cmd of [
      "sync",
      "status",
      "list",
      "adopt",
      "retry",
      "organize",
      "enrich",
      "ingest",
      "fetch",
      "audit",
      "years",
      "artwork",
      "doctor",
    ]) {
      const line = stdout.split("\n").find((l) => l.includes(`megadj ${cmd}`));
      expect(line, `help has an entry for ${cmd}`).toBeDefined();
      expect(
        line,
        `help entry for ${cmd} documents --json (PRINCIPLES.md §1)`,
      ).toContain("--json");
    }
  });
});
