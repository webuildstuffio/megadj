import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * kind-docs.test.ts — "explain" census guard (the F1 regression class).
 *
 * Sep 11 2026: `deckctl explain speedtest` printed `unknown kind` and
 * deck_explain's schema advertised a kind whose call returned
 * `{error: "unknown kind"}` — while docs/surface-parity.md §0 item 2
 * claimed the exact opposite ("Resolved"). Root cause: KIND_DOCS is a
 * hand-populated Record with NO tie to JOB_KINDS, so a new job kind
 * (`speedtest`, `ingest`) silently had no doc on two surfaces. The claim
 * in the doc was never testable — this test makes it testable.
 *
 * Contract (one SSOT per shared surface artifact — AGENTS.md):
 *   KIND_DOCS keys + verify  ===  JOB_KINDS  (exact, both directions)
 * Any new JobKind must land a KIND_DOCS row in the same commit or the
 * build fails here. `verify` is the sanctioned KIND_DOCS-external entry
 * (it rides VERIFY_HELP's richer doc via verify_help.ts).
 */

const ROOT = join(import.meta.dir, "..", "..");

/** The JobKind union as written in shared/types.ts (the SSOT constant). */
function jobKindsFromSource(): string[] {
  const src = readFileSync(join(ROOT, "cratedeck/shared/types.ts"), "utf8");
  const block = src.match(
    /export const JOB_KINDS = \[([\s\S]*?)\] as const satisfies/,
  )?.[1];
  if (!block) throw new Error("JOB_KINDS not found in shared/types.ts");
  return [...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!);
}

describe("KIND_DOCS covers every job kind (the explain census)", () => {
  // Import AFTER reading source so a malformed SSOT constant fails its own
  // clear error above rather than an import-time type surprise.
  const { KIND_DOCS } = require("../src/deckctl_docs") as {
    KIND_DOCS: Record<string, unknown>;
  };
  const kinds = jobKindsFromSource();
  const documented = new Set(["verify", ...Object.keys(KIND_DOCS)]);

  test("every JobKind has an explain doc (verify via VERIFY_HELP)", () => {
    const missing = kinds.filter((k) => !documented.has(k));
    expect(missing).toEqual([]);
  });

  test("KIND_DOCS carries no orphan entries (no hand-copied twin drift)", () => {
    const kindSet = new Set(kinds);
    const orphans = Object.keys(KIND_DOCS).filter((k) => !kindSet.has(k));
    expect(orphans).toEqual([]);
  });

  test("the deck_explain schema enum derives from KIND_DOCS (not a literal)", () => {
    const mcp = readFileSync(join(ROOT, "cratedeck/src/mcp.ts"), "utf8");
    expect(mcp).toContain('["verify", ...Object.keys(KIND_DOCS)]');
    // the old hand-filtered literal is gone
    expect(mcp).not.toContain('JOB_KINDS.filter((k) => k !== "verify"');
  });

  test("the deckctl explain error message lists kinds from KIND_DOCS, not a stale literal", () => {
    // `explain <bad>` must point the user at kinds that actually resolve —
    // derive both legs from the SSOTs rather than restating them.
    const deckctl = readFileSync(
      join(ROOT, "cratedeck/src/deckctl.ts"),
      "utf8",
    );
    expect(deckctl).toContain('Object.keys(KIND_DOCS).join(", ")');
  });
});
