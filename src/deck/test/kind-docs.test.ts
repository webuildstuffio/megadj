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

const ROOT = join(import.meta.dir, "..", "..", "..");

/** The JobKind union as written in shared/types/jobs.ts (the SSOT
 *  constant; #196 split the types barrel into domain files — the barrel
 *  re-exports this module, but the SOURCE lives here). */
function jobKindsFromSource(): string[] {
  const src = readFileSync(join(ROOT, "src/deck/shared/types/jobs.ts"), "utf8");
  const block = src.match(
    /export const JOB_KINDS = \[([\s\S]*?)\] as const/,
  )?.[1];
  if (!block) throw new Error("JOB_KINDS not found in shared/types/jobs.ts");
  return [...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!);
}

describe("KIND_DOCS covers every job kind (the explain census)", () => {
  // Import AFTER reading source so a malformed SSOT constant fails its own
  // clear error above rather than an import-time type surprise.
  const { KIND_DOCS } = require("../deckctl/docs") as {
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

  test("the deck_explain schema enum derives from KIND_DOCS (not a literal)", async () => {
    // #89 split: the explain handler lives in mcp/read-tools.ts.
    // Behavior, not source-grep: the advertised enum AND the no-kind
    // response must equal the KIND_DOCS SSOT (+ verify) exactly — the
    // schema can neither advertise a doc-less kind nor miss a documented
    // one, and the old hand-filtered literal can't silently return.
    const { DECK_READ_HANDLERS } = require("../mcp/read-tools") as {
      DECK_READ_HANDLERS: Record<
        string,
        {
          inputSchema: { properties: { kind: { enum: readonly string[] } } };
          run: (args: Record<string, unknown>) => Promise<unknown>;
        }
      >;
    };
    const expected = ["verify", ...Object.keys(KIND_DOCS)];
    expect(
      DECK_READ_HANDLERS.explain?.inputSchema.properties.kind.enum,
    ).toEqual(expected);
    const all = (await DECK_READ_HANDLERS.explain?.run({})) as Record<
      string,
      unknown
    >;
    expect(Object.keys(all)).toEqual(expected);
  });

  test("the deckctl explain error message lists kinds from KIND_DOCS, not a stale literal", () => {
    // `explain <bad>` must point the user at kinds that actually resolve —
    // derive both legs from the SSOTs rather than restating them.
    const deckctl = readFileSync(join(ROOT, "src/deck/deckctl.ts"), "utf8");
    expect(deckctl).toContain('Object.keys(KIND_DOCS).join(", ")');
  });
});

/**
 * The SECOND pin (issue #216): HELP_JOBS (src/deck/shared/help.ts — the
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
    HELP_JOBS: { kind: string; icon: string }[];
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

  // Super-sure pass (Sep 17, post-#216): every HELP_JOBS icon must exist
  // in the web icon table — an unknown name silently renders a dot
  // (icons.tsx falls back to Circle).
  test("every HELP_JOBS icon resolves in the web Icon table", () => {
    const icons = readFileSync(join(ROOT, "src/deck/web/ui/icons.tsx"), "utf8");
    const unnamed = HELP_JOBS.filter(
      (j) => !new RegExp(`\\b${j.icon}\\s*:`, "m").test(icons),
    ).map((j) => `${j.kind}: "${j.icon}"`);
    expect(unnamed).toEqual([]);
  });

  // Super-sure pass: `deckctl help <kind>` must read `needs` from KIND_DOCS
  // (the explain SSOT), never a hand-rolled ternary — the old twin printed
  // "requires: drive mounted, rekordbox closed" for ingest/speedtest/
  // checksum, none of which is true.
  test("deckctl help reads job `needs` from KIND_DOCS, not a hand twin", async () => {
    // Behavior pin for the Sep-17 fix: the old hand-rolled ternary printed
    // "requires: drive mounted, rekordbox closed" for ingest/speedtest/
    // checksum — none true. The rendered help must carry the KIND_DOCS
    // needs line verbatim, and the stale twin wording must never return.
    const { cmdHelp } = require("../deckctl/help") as {
      cmdHelp: (
        h: {
          jsonMode: boolean;
          log: (s: string) => void;
          errOut: (s: string) => void;
          exit: (code: number) => never;
        },
        topic?: string,
      ) => Promise<void>;
    };
    const { KIND_DOCS: docs } = require("../deckctl/docs") as {
      KIND_DOCS: Record<string, { needs: string }>;
    };
    const lines: string[] = [];
    await cmdHelp(
      {
        jsonMode: false,
        log: (s) => lines.push(s),
        errOut: () => {},
        exit: () => {
          throw new Error("help exited unexpectedly");
        },
      },
      "scan",
    );
    const out = lines.join("\n");
    expect(out).toContain(docs["scan"]?.needs ?? "«missing KIND_DOCS row»");
    expect(out).not.toContain("drive mounted, rekordbox closed");
  });

  // Super-sure pass: the jobs-section headers were hard-coded "five jobs"
  // and rotted the moment the 11th kind landed — copy must stay count-free.
  test("no hard-coded job count in help copy (the 'five jobs' rot)", () => {
    for (const rel of [
      "src/deck/deckctl/help.ts",
      "src/deck/web/ui/Onboard.tsx",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect({ file: rel, stale: /five jobs/.test(src) }).toEqual({
        file: rel,
        stale: false,
      });
    }
  });
});
