// githooks-census.test.ts — pins the repo hook chain (the tripwire class:
// a silently deleted hook is invisible until the exact gate it owned is
// skipped). core.hooksPath points at .githooks/, which OVERRIDES the
// global ~/.githooks set — any hook not chained here never runs in this
// repo. The pre-commit chain existed; the pre-push chain was missing until
// Sep 17 2026 (the AGENTS-documented "full suite at pre-push" leg never
// fired — found by the /super-sure pass over #216/#228).
import { describe, expect, test } from "bun:test";
import { existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** The hooks the repo must chain, and what each must do. */
const REQUIRED_HOOKS: Readonly<Record<string, readonly string[]>> = {
  "pre-commit": [
    // Chains the shared shell-config hook (staged-scoped tests + gates).
    "$HOME/.githooks/pre-commit",
    // Runs the repo LOC-budget gate.
    "tools/loc-budget.ts",
  ],
  "pre-push": [
    // Chains the shared shell-config pre-push (refspec-targeted checks).
    "$HOME/.githooks/pre-push",
    // AGENTS.md: "the full suite runs at PRE-PUSH against the SHARED
    // worktree — another agent's red WIP blocks your push".
    "bun run test",
  ],
};

describe("githooks census: core.hooksPath chains every required hook", () => {
  test("core.hooksPath points at .githooks (the override that makes this file matter)", () => {
    // git config (not .git/config reads): linked worktrees keep .git as a
    // pointer FILE — config must resolve through the common dir to stay
    // worktree-safe.
    const proc = Bun.spawnSync(["git", "config", "core.hooksPath"], {
      cwd: ROOT,
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString().trim()).toBe(".githooks");
  });

  for (const [hook, mustContain] of Object.entries(REQUIRED_HOOKS)) {
    test(`${hook} exists, is executable, and chains its gates`, () => {
      const p = join(ROOT, ".githooks", hook);
      expect(existsSync(p)).toBe(true);
      // Executable bit: a non-exec hook silently no-ops.
      expect(statSync(p).mode & 0o111).not.toBe(0);
      const text = readFileSync(p, "utf8");
      for (const needle of mustContain) {
        expect(text).toContain(needle);
      }
    });
  }
});
