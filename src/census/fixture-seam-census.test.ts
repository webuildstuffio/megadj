/**
 * fixture-seam-census (#248 item 4) — the ratchet: `mkdtempSync` may
 * appear in only the tracked set of test files. Every migration drops
 * the count; a NEW raw site fails the suite. The #198 ratchet pattern
 * applied to fixture lifecycle — the #236 leak class (12.5 GB of
 * cratedeck-hashcancel-* staging) cannot quietly regrow.
 *
 * Allowed:
 *   - src/test-support/testutil.ts — the seam itself (the only
 *     production-side mkdtemp in the repo).
 *   - src/test-support/testutil.test.ts + this census — they pin the
 *     seam's behavior, they do not create suite fixtures.
 *   - the tracked test files below — each entry is a straggler with a
 *     reason; migrations DELETE entries, never add.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

/** test files still allowed to call mkdtempSync directly (the count only
 *  goes DOWN — deleting an entry is the point of the ratchet). */
const ALLOWED = new Set<string>([
  // census/test-support pins (they test the seam, not fixtures — the
  // testutil test never calls mkdtempSync, it goes through the seam).
  "src/census/fixture-seam-census.test.ts",
  // shelf: the makeDrive/makeShelf builders are the #223 named-fixture
  // families — their migration rides #223, not this pass.
  // rekordbox: FULLY MIGRATED to tempDir (#248 second pass, Sep 18) —
  // all 10 grid/ANLZ/playlist suites; entries kept out on purpose so a
  // regression re-adding mkdtempSync fails the first test above.
  // shared + host-kit: FULLY MIGRATED to tempDir (#248 third pass,
  // Sep 18) — hash, drop, walk-tree, atomic-file, volume,
  // maintenance-flags, json-summary, numeric-options all ride the seam;
  // entries kept out on purpose so a regression fails the first test.
  // fulltags + archive + shelf: FULLY MIGRATED to tempDir/tempState
  // (#248 passes 3+4, Sep 18) — 11 fulltags + 3 archive + 10 shelf suites;
  // entries kept out on purpose so a regression fails the first test.
  // getdat + host-kit census set at src root: FULLY MIGRATED (the nine
  // getdat files in pass 1, json-summary/numeric-options in pass 3) —
  // kept out of this set so a regression re-adding mkdtempSync fails.
  // cratedeck: FULLY MIGRATED to tempDir (#248 pass 5, Sep 18) — all 15
  // suites including the two leakTrackedTmp registries (issue-33,
  // config), whose hand-rolled createdDirs+afterEach the seam replaces;
  // entries kept out on purpose so a regression fails the first test.
]);

/** The seam module itself is always allowed (not counted against N). */
const SEAM = "src/test-support/testutil.ts";

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("fixture-seam census (#248 ratchet)", () => {
  test("mkdtempSync appears ONLY in the seam + tracked stragglers", () => {
    const offenders: string[] = [];
    for (const root of ["src", "cratedeck"]) {
      for (const file of walk(join(ROOT, root))) {
        const rel = relative(ROOT, file);
        const text = readFileSync(file, "utf8");
        if (!text.includes("mkdtempSync")) continue;
        if (rel === SEAM) continue;
        if (ALLOWED.has(rel)) continue;
        offenders.push(
          `  ${rel} — migrate to tempDir()/tempState() (src/test-support/testutil) or allowlist with a reason`,
        );
      }
    }
    expect(
      offenders,
      `raw mkdtempSync sites outside the seam + straggler list:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  test("every allowlist entry still exists and still uses mkdtempSync", () => {
    const unused: string[] = [];
    for (const rel of ALLOWED) {
      const full = join(ROOT, rel);
      let exists = true;
      let text = "";
      try {
        text = readFileSync(full, "utf8");
      } catch {
        exists = false;
      }
      if (!exists || !text.includes("mkdtempSync"))
        unused.push(`  ${rel} — migrate done; DELETE this entry`);
    }
    expect(
      unused,
      `allowlist entries whose migration completed:\n${unused.join("\n")}`,
    ).toEqual([]);
  });

  test("the seam module itself is the only non-test mkdtemp in src/", () => {
    const offenders: string[] = [];
    const scan = (dir: string): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) scan(p);
        else if (
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".test.ts")
        ) {
          const rel = relative(ROOT, p);
          if (rel === SEAM) continue;
          if (
            statSync(p).isFile() &&
            readFileSync(p, "utf8").includes("mkdtempSync")
          )
            offenders.push(`  ${rel}`);
        }
      }
    };
    scan(join(ROOT, "src"));
    scan(join(ROOT, "cratedeck/src"));
    scan(join(ROOT, "cratedeck/shared"));
    expect(
      offenders,
      `production code must not mkdtemp (fixture dirs are a test concern):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  test("raw new ArchiveState() in test files stays pinned (tempState seam ratchet)", () => {
    const ALLOWED_STATE = new Set<string>([
      // named per-file builders (makeState/makeRows) — the state creation
      // is already centralized inside the file; migrating the builder body
      // to tempState is follow-on polish, tracked in #248.
      "src/fulltags/write/convert.test.ts",
      "src/fulltags/booth/booth-fix.e2e.test.ts",
      "src/fulltags/megaset-cli.test.ts",
      "src/fulltags/gold-report.test.ts",
      "src/archive/state-genreflag.test.ts",
      "src/rekordbox/grid-triage.test.ts",
      "src/rekordbox/rb-adopt.test.ts",
      "src/shelf/intake-status.test.ts",
    ]);
    const offenders: string[] = [];
    for (const root of ["src", "cratedeck"]) {
      for (const file of walk(join(ROOT, root))) {
        const rel = relative(ROOT, file);
        // the census's own doc text mentions the call shape — skip self
        if (rel === "src/census/fixture-seam-census.test.ts") continue;
        if (ALLOWED_STATE.has(rel)) continue;
        const text = readFileSync(file, "utf8");
        if (text.includes("new ArchiveState("))
          offenders.push(
            `  ${rel} — build state through tempState() (src/test-support/testutil) or join the pinned builder set with a reason`,
          );
      }
    }
    expect(
      offenders,
      `raw ArchiveState sites outside the pinned builder set:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
