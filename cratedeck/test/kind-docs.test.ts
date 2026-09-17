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

/** The JobKind union as written in shared/types/jobs.ts (the SSOT
 *  constant; #196 split the types barrel into domain files — the barrel
 *  re-exports this module, but the SOURCE lives here). */
function jobKindsFromSource(): string[] {
  const src = readFileSync(
    join(ROOT, "cratedeck/shared/types/jobs.ts"),
    "utf8",
  );
  const block = src.match(
    /export const JOB_KINDS = \[([\s\S]*?)\] as const/,
  )?.[1];
  if (!block) throw new Error("JOB_KINDS not found in shared/types/jobs.ts");
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
    // #89 split: the explain handler lives in mcp_read_tools.ts
    const mcp = readFileSync(
      join(ROOT, "cratedeck/src/mcp_read_tools.ts"),
      "utf8",
    );
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

/**
 * The SECOND pin (issue #216): HELP_JOBS (cratedeck/shared/help.ts — the
 * web Welcome/tour explainers behind GET /api/help) is the other job-kind
 * doc surface, and it had NO census — `ingest` and `grid-health` had
 * KIND_DOCS rows but no HELP_JOBS explainer, invisible in the web glossary.
 * Contract: HELP_JOBS kinds === JOB_KINDS exactly. A new JobKind must
 * land BOTH rows (KIND_DOCS + HELP_JOBS) in the same commit or the build
 * fails here.
 */
describe("HELP_JOBS covers every job kind (the web-help census, #216)", () => {
  const { JOB_KINDS } = require("../shared/types/jobs") as {
    JOB_KINDS: readonly string[];
  };
  const { HELP_JOBS } = require("../shared/help") as {
    HELP_JOBS: { kind: string }[];
  };

  test("HELP_JOBS kinds === JOB_KINDS (exact, both directions)", () => {
    const helpKinds = HELP_JOBS.map((j) => j.kind);
    const kindSet = new Set(JOB_KINDS);
    const missing = JOB_KINDS.filter((k) => !helpKinds.includes(k));
    const orphans = helpKinds.filter((k) => !kindSet.has(k));
    expect({ missing, orphans }).toEqual({ missing: [], orphans: [] });
  });

  test("HELP_JOBS carries no duplicate kinds", () => {
    const kinds = HELP_JOBS.map((j) => j.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
