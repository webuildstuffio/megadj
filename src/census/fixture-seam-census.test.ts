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
  "src/shelf/archive.test.ts",
  "src/shelf/sync.test.ts",
  "src/shelf/dupescan.test.ts",
  "src/shelf/dupescan-engine.test.ts",
  "src/shelf/hygiene.test.ts",
  "src/shelf/restore.test.ts",
  "src/shelf/md5-cli.test.ts",
  "src/shelf/intake-status.test.ts",
  "src/shelf/dedupe.test.ts",
  "src/shelf/ext-drift.test.ts",
  // rekordbox: grid/ANLZ suites build multi-volume drive trees
  "src/rekordbox/grid-triage.test.ts",
  "src/rekordbox/rb-playlist.test.ts",
  "src/rekordbox/rb-playlist-twin.test.ts",
  "src/rekordbox/rb-adopt.test.ts",
  "src/rekordbox/rb-unmatched.test.ts",
  "src/rekordbox/anlz-spike.test.ts",
  "src/rekordbox/rb-dedup.test.ts",
  "src/rekordbox/guard.test.ts",
  "src/rekordbox/rb-fix-paths.test.ts",
  "src/rekordbox/rb-comment-sync.test.ts",
  // shared: hash/flags/volume/atomic/walk-tree unit seams
  "src/shared/maintenance-flags.test.ts",
  "src/shared/hash.test.ts",
  "src/shared/drop.test.ts",
  "src/shared/walk-tree.test.ts",
  "src/shared/atomic-file.test.ts",
  "src/shared/volume.test.ts",
  // archive hygiene walk/apply exercise the walker over synthetic trees
  "src/archive/hygiene/walk.test.ts",
  "src/archive/hygiene/apply.test.ts",
  "src/archive/state-genreflag.test.ts",
  // fulltags: e2e/write shapes with ffmpeg artifacts
  "src/fulltags/write/convert.test.ts",
  "src/fulltags/booth/booth-fix.e2e.test.ts",
  "src/fulltags/similar.test.ts",
  "src/fulltags/genre/genre-why.test.ts",
  "src/fulltags/megaset-cli.test.ts",
  "src/fulltags/fetch.test.ts",
  "src/fulltags/gold-report.test.ts",
  "src/fulltags/test/gold-set.test.ts",
  "src/fulltags/test/verify-key.test.ts",
  "src/fulltags/test/fetch-stages.test.ts",
  "src/fulltags/test/writer-sync.test.ts",
  // getdat: FULLY MIGRATED to tempDir (#248 first pass, Sep 18) — the
  // nine files below were the original stragglers; entries are kept out
  // of this set on purpose so a regression re-adding mkdtempSync fails
  // the first test above.
  // host-kit census set at src root
  "src/json-summary.test.ts",
  "src/numeric-options.test.ts",
  // cratedeck: pool/guard/security suites build volume trees
  "cratedeck/test/archive-megaset-pool.test.ts",
  "cratedeck/test/guard.test.ts",
  "cratedeck/test/drive-job-routes-security.test.ts",
  "cratedeck/test/archive.test.ts",
  "cratedeck/test/archive_tagcensus.test.ts",
  "cratedeck/test/usb-link.test.ts",
  "cratedeck/test/intake-run.test.ts",
  "cratedeck/test/hygiene_audio.test.ts",
  "cratedeck/test/hygiene-api.test.ts",
  "cratedeck/test/walk-async.test.ts",
  "cratedeck/test/server-port.test.ts",
  "cratedeck/test/issue-33-crash-recovery.test.ts",
  "cratedeck/test/config.test.ts",
  "cratedeck/test/archive_sweep.test.ts",
  "cratedeck/test/issue-44-high-fan-in.test.ts",
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
});
