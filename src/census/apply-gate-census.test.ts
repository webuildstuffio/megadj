/**
 * Apply-confirmation census (issue #79) — every exported mutating command
 * that exposes a --apply/--quarantine + --yes two-step gate must route it
 * through the ONE predicate: `applyConfirmationRefusal` in
 * src/rekordbox/rb-command-kit.ts. A new destructive command that
 * hand-rolls `if (apply && !yes)` breaks this census, exactly like the
 * boundary censuses catch unguarded JSON.parse / numeric boundaries.
 *
 * The census greps SOURCE (non-test) for the raw predicate and asserts
 * each hit site also references the SSOT function on the same statement —
 * i.e. the predicate text only ever appears inside a call that consults
 * the shared gate.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";

const ROOT = join(import.meta.dir, "..", "..");

/** The gate families the SSOT covers. The wording is one shared refusal. */
const AUDITED_COMMANDS: readonly string[] = [
  "src/rekordbox/rb-adopt.ts",
  "src/rekordbox/rb-comment-sync.ts",
  "src/rekordbox/rb-cues.ts",
  "src/rekordbox/rb-dedup.ts",
  "src/rekordbox/rb-fix-paths.ts",
  "src/rekordbox/rb-import.ts",
  "src/rekordbox/rb-playlist-reconcile.ts",
  "src/rekordbox/rb-playlist.ts",
  "src/rekordbox/rb-unmatched.ts",
  "src/shelf/dedupe-archive.ts",
  "src/shelf/dedupe.ts",
  "src/shelf/dupescan.ts",
  "src/shelf/hygiene.ts",
];

const SSOT = "applyConfirmationRefusal";

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listSourceFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
      out.push(full);
  }
  return out;
}

describe("apply-confirmation census (#79)", () => {
  test("the SSOT exists in the command kit", () => {
    const kit = readFileSync(
      join(ROOT, "src/rekordbox/rb-command-kit.ts"),
      "utf8",
    );
    expect(kit).toContain("export function applyConfirmationRefusal");
  });

  test("every audited command references the SSOT", () => {
    for (const rel of AUDITED_COMMANDS) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect({ file: rel, referencesSSOT: src.includes(SSOT) }).toEqual({
        file: rel,
        referencesSSOT: true,
      });
    }
  });

  test("no hand-rolled refusal wording survives outside the kit", () => {
    // Every previous per-command wording — a re-appearance means a new
    // hand-rolled gate slipped in instead of calling the SSOT.
    const deadWordings = [
      "requires --yes (report first, ALWAYS)",
      'requires --yes (dry-run first, ALWAYS)"',
      "requires --yes; no database work was performed",
      "requires --yes (two-step safety — nothing moved)",
      "requires --yes (two-step safety — nothing executed)",
      'requires --yes (dry-run first)"',
      "requires --yes (two-step apply, dry-run first ALWAYS)",
      "apply requested but --yes missing",
    ];
    const files = [
      ...listSourceFiles(join(ROOT, "src/rekordbox")),
      ...listSourceFiles(join(ROOT, "src/shelf")),
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const wording of deadWordings) {
        expect({
          file: relative(ROOT, file),
          wording,
          found: src.includes(wording),
        }).toEqual({ file: relative(ROOT, file), wording, found: false });
      }
    }
  });

  test("every raw `apply && !yes`-family predicate consults the SSOT on site", () => {
    // The raw predicate may only appear on lines that also call the SSOT
    // (the call sites) — anywhere else is a bypass of the two-step rule.
    const predicate = /(apply|quarantine)\s*&&\s*!/.source;
    const files = [
      ...listSourceFiles(join(ROOT, "src/rekordbox")),
      ...listSourceFiles(join(ROOT, "src/shelf")),
      ...listSourceFiles(join(ROOT, "src/archive")),
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const [index, line] of lines.entries()) {
        const stripped = line.replace(/\/\/.*$/u, "").trim();
        if (!new RegExp(predicate, "u").test(stripped)) continue;
        // Allowed: the gated call sites (same line mentions the SSOT) and
        // the SSOT implementation itself.
        if (stripped.includes(SSOT)) continue;
        if (file.endsWith("rb-command-kit.ts")) continue;
        offenders.push(`${relative(ROOT, file)}:${index + 1}: ${stripped}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
