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
  const proc = await $`bun run ${join(import.meta.dir, "./cli.ts")} ${args}`
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

  test("#159: every summary crosses the awaited writeJson seam", async () => {
    // The emit path is census-guaranteed in-process
    // (json-summary-census.test.ts bans raw console.log(JSON.stringify)).
    // This end-to-end leg pins the runtime half: output must arrive as ONE
    // COMPACT line — the awaited Bun.write path's exact shape. A
    // fire-and-forget console.log(..., null, 2) re-landing would emit
    // pretty-printed multi-line output and fail the single-line parse
    // below (and reintroduce the #53 pipe-EOF class this seam exists for).
    const { code, stdout } = await runCli(["status", "--json"], env);
    expect(code).toBe(0);
    const lines = stdout.trim().split("\n");
    expect(lines.length, "exactly one stdout line (compact JSON)").toBe(1);
    expect(() => JSON.parse(lines[0] ?? "")).not.toThrow();
  });

  test("#159: ingest emit keys match cratedeck's IntakeCounterKey SSOT", async () => {
    // Both packages derive from INTAKE_COUNTER_KEYS; this pins the real
    // CLI output to that list (empty-folder dry run = zero side effects).
    const { INTAKE_COUNTER_KEYS } = await import("../cratedeck/shared/types");
    await runCli(["ingest", dir, "--dry-run", "--json"], env);
    const { stdout } = await runCli(
      ["ingest", join(dir, "music"), "--dry-run", "--json"],
      env,
    );
    const parsed = lastJsonLine(stdout);
    expect(parsed.command).toBe("ingest");
    for (const key of INTAKE_COUNTER_KEYS)
      expect(typeof parsed[key], `ingest --json emits counter "${key}"`).toBe(
        "number",
      );
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
      "drop",
      "fetch",
      "audit",
      "years",
      "artwork",
      "mood",
      "similar",
      "upgrade",
      "doctor",
      "shelf-sync",
      "shelf-archive",
      "shelf-sweeps",
      "shelf-dedupe",
      "shelf-dupescan",
      "shelf-hygiene",
      "rb-fix-paths",
      "rb-unmatched",
      "rb-adopt",
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
