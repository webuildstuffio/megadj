/**
 * rb-title-repair — caller failure-diagnostics pins (#504 review
 * follow-up). The guarded commit (PY_RB_COMMIT_GUARD) refuses on
 * stdout as `{"error": ...}` and exits 1; the caller's nonzero-exit
 * branch historically built its message from stderr alone, so a
 * refusal surfaced as an empty `title-repair failed (exit 1):`.
 * These pins hold the reason end to end. Deps are the rbCommandRuntime
 * seam — no filesystem, no subprocess, no live pgrep.
 */
import { describe, expect, test } from "bun:test";
import { rbTitleRepair } from "./rb-title-repair";
import type { RbCommandRuntime } from "./rb-command-kit.js";

const fakeDeps = (spawn: RbCommandRuntime["spawn"]): RbCommandRuntime => ({
  fileExists: () => true,
  assertClosed: () => {},
  backup: () => "/tmp/master.db.bak",
  restore: () => {},
  sleep: () => {},
  spawn,
});

describe("rb-title-repair failure diagnostics", () => {
  test("a guarded-commit refusal surfaces the kit's stdout error JSON", async () => {
    const result = await rbTitleRepair(
      { mount: "/Volumes/TEST", apply: true, yes: true, log: () => {} },
      fakeDeps(() => ({
        status: 1,
        stdout: JSON.stringify({
          error: "rekordbox is running — refusing write",
        }),
        stderr: "",
      })),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("rekordbox is running — refusing write");
  });

  test("without a stdout error record the stderr tail still reports", async () => {
    const result = await rbTitleRepair(
      { mount: "/Volumes/TEST", apply: true, yes: true, log: () => {} },
      fakeDeps(() => ({
        status: 2,
        stdout: "",
        stderr: "uv: package resolution failed",
      })),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("uv: package resolution failed");
  });
});
