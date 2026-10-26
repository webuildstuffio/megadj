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
        stdout: JSON.stringify({ error: "rekordbox is running — refusing write" }),
        stderr: "",
      })),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("rekordbox is running — refusing write");
  });

  test("without a stdout error record the stderr tail still reports", async () => {
    const result = await rbTitleRepair(
      { mount: "/Volumes/TEST", apply: true, yes: true, log: () => {} },
      fakeDeps(() => ({ status: 2, stdout: "", stderr: "uv: package resolution failed" })),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("uv: package resolution failed");
  });

  test("a clean run parses with no errors key in the kit payload (#514)", async () => {
    // #514: the kit's write-only "errors": [] key is gone — exit 0 with
    // valid JSON is a clean run, and the caller must not require the key.
    const result = await rbTitleRepair(
      { mount: "/Volumes/TEST", apply: true, yes: true, log: () => {} },
      fakeDeps(() => ({
        status: 0,
        stdout: JSON.stringify({
          scanned: 3,
          truncated_fixed: 1,
          contamination_fixed: 0,
          paren_fixed: 0,
          skipped_missing: 0,
          skipped_no_tag: 0,
          already_good: 2,
          applied: true,
          samples: [["truncated", "Old Title", "Full Title"]],
        }),
        stderr: "",
      })),
    );
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.truncatedFixed).toBe(1);
    expect(result.samples).toEqual([["truncated", "Old Title", "Full Title"]]);
  });
});
