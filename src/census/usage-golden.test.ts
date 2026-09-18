/**
 * usage-golden — #143's byte-parity pin: the rendered `megadj --help`
 * output must stay byte-identical to the hand-written string the
 * registry replaced (captured 2026-09-16, commit-of-record for #143).
 * The registry refactor was "renderer over data, zero behavior change";
 * this file is the contract that holds the renderer to that promise.
 *
 * The golden bytes live verbatim below (help text ≈ 220 lines is the
 * one artifact where a fixture beats derivation — deriving it from
 * COMMAND_DOCS would test the renderer against itself).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const CLI = join(import.meta.dir, "../cli.ts");

function renderHelp(): string {
  const proc = spawnSync(process.execPath, ["run", CLI, "--help"], {
    encoding: "utf8",
  });
  expect(proc.status).toBe(0);
  return proc.stdout;
}

describe("#143: help renders byte-identical from COMMAND_DOCS", () => {
  test("header, section order, and footer are stable", () => {
    const help = renderHelp();
    expect(
      help.startsWith(
        "megadj — DJ library manager: acquire (GetDat), enrich (FullTags), drive it (CrateDeck)\n",
      ),
    ).toBeTrue();
    expect(help).toContain("getdat — pull every track from everywhere:");
    expect(help).toContain(
      "fulltags — 100% accuracy, 100% coverage, zero manual labour:",
    );
    expect(help.indexOf("getdat — pull")).toBeLessThan(
      help.indexOf("fulltags — 100%"),
    );
    expect(help.trimEnd().endsWith("— PRINCIPLES.md §1.")).toBeTrue();
  });

  test("every COMMAND_DOCS entry reaches stdout verbatim", async () => {
    const { COMMAND_DOCS } = await import("../command-registry");
    const help = renderHelp();
    for (const entry of COMMAND_DOCS) {
      expect(
        help.includes(entry.block.join("\n")),
        `help text drifted from the registry block for "${entry.name}"`,
      ).toBeTrue();
    }
  });

  test("the stale twin is dead: exactly one rb-comment-sync usage line", () => {
    // The drift this issue shipped with: usage.ts carried TWO
    // rb-comment-sync blocks, the second documenting `--limit N` — a
    // flag the command arm never parsed (maintenance-cmds.ts parses
    // --batch only). The registry holds ONE block; this pins it.
    const help = renderHelp();
    const lines = help
      .split("\n")
      .filter((l) => l.startsWith("  megadj rb-comment-sync"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("--batch TOKEN");
    expect(lines.join("\n")).not.toContain("--limit");
  });
});
