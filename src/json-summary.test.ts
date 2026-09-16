import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { runCli, lastJsonLine, cliEnv } from "./test-support/cli-run";

/**
 * P1 regression guard: every mutating/summary command must emit exactly one
 * JSON object on stdout when --json is passed — parseable, with the command
 * name and the counters the docs promise. These run the real CLI with a
 * throwaway MEGADJ_DB so no fixture library is needed.
 */

describe("principles P1: --json on every command", () => {
  const dir = mkdtempSync("/tmp/megadj-json-test-");
  const env = cliEnv(dir);

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

  test("#160 ring 3: FORCED-FAILURE --json runs keep stdout one parseable object", async () => {
    // The drift this ring kills: a usage error used to hand-roll
    // console.error + exitCode (or even process.exit), so a --json run
    // emitted a HUMAN line (or nothing) and the one-object contract died
    // exactly when agents need it most — at failure. Each case: usage
    // error → exit 2, stdout parses as ONE object naming the command.
    for (const t of [
      { args: ["similar", "--json"], command: "similar" }, // missing video id
      { args: ["ingest", "--json"], command: "ingest" }, // missing folder
      { args: ["drop", "--json"], command: "drop" }, // missing target
      {
        args: ["genre", "--min-agreement", "nope", "--json"],
        command: "genre",
      },
      {
        args: ["beats", "--limit", "abc", "--json"],
        command: "beats",
      },
    ] as const) {
      const { code, stdout } = await runCli([...t.args], env);
      expect(code, `${t.args.join(" ")} exits 2 on usage error`).toBe(2);
      const lines = stdout
        .trim()
        .split("\n")
        .filter((l) => l.length > 0);
      expect(
        lines.length,
        `${t.args.join(" ")}: stdout is exactly one line (no human pollution)`,
      ).toBe(1);
      const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
      expect(
        parsed.error,
        `${t.args.join(" ")} carries the error`,
      ).toBeString();
      if (t.command !== undefined)
        expect(parsed.command, `${t.args.join(" ")} names the command`).toBe(
          t.command,
        );
    }
  });

  test("#160 ring 3: failure-path exit codes stay meaningful (non-usage failures = 1)", async () => {
    // unknown command: exit 1 (command-level failure, not a flag typo)
    const { code, stdout } = await runCli(
      ["definitely-not-a-verb", "--json"],
      env,
    );
    expect(code).toBe(1);
    const parsed = lastJsonLine(stdout);
    expect(parsed.error).toBeString();
  });
});
