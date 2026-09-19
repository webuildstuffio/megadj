/**
 * test-placement-census.test.ts — #246: the test-placement rule, executable.
 *
 * THE RULE (AGENTS.md, Test/support trees): a subject's test co-locates
 * beside it (`foo.ts` ↔ `foo.test.ts`, any depth). A product's `test/` dir
 * holds ONLY shared support — fixtures, workers, builders, case tables —
 * never a subject's own test. Support dirs never stutter.
 *
 * This census derives the violation set mechanically: a `*.test.ts(x)` file
 * is legal when (a) its same-stem subject exists beside it, (b) it lives in
 * a sanctioned support/census location, or (c) it sits in the ALLOWLIST
 * below with a reason + the issue that migrates it. The known co-location
 * debt (~103 tests riding #220/#214) is allowlisted, NOT silent — every row
 * must name its migration issue, so the count can only go DOWN.
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

/** Locations where a test without a same-stem subject is LEGAL:
 *  - product `test/` support dirs (#246: support only)
 *  - src/census/ — the census tripwires are their own subject class
 *  - src root — the host-kit contract tests pin the front door (AGENTS)
 *  - tool/skill/plugin trees (not product src) */
const SANCTIONED = /\/test\/|^\.claude\/|^plugin\/|^tools\/|^ops\//u;
/** The census tripwires are their own subject class: `src/census/` IS
 *  where they live (AGENTS root rule, #244). */
const CENSUS_DIR = /^src\/census\//u;

/** Tests that share a name with no subject and live outside sanctioned
 *  support dirs. Every row: reason + the issue that migrates or blesses it.
 *  RATCHET: rows may be removed when the move lands; new rows need the
 *  same. The census fails on rows that no longer match a real file. */
const ALLOWLIST: Readonly<Record<string, string>> = {
  // ---- src/census/: the census dir itself is sanctioned by rule, but the
  // walker needs no special case — these prove the sanctioned regex works.
  // ---- fulltags co-location debt (rides #220's folder pass):
  "src/fulltags/analysis/mood-queue.test.ts":
    "#220: subject mood.ts lives in analysis/",
  "src/fulltags/booth/booth-fix.e2e.test.ts":
    "#220: subject booth-fix.ts lives in booth/",
  "src/fulltags/enrich.test.ts": "#220: subject is fetch/enrich.ts",
  "src/fulltags/fetch.test.ts": "#220: subject is fetch/fetch.ts",
  "src/fulltags/genre/genre-vocab-crossmap.test.ts":
    "#220: subject genre-vocab.ts",
  "src/fulltags/megaset-cli.test.ts":
    "#220: exercises the megadj CLI arms; no single subject",
  "src/fulltags/sources/clean-search-parts.test.ts":
    "#220: subject art-sources.ts",
  "src/fulltags/sources/mb-lookup.test.ts": "#220: subject mb_lookup.py seam",
  "src/fulltags/sources/models.test.ts":
    "#220: integration of models+pipeline+writer",
  "src/fulltags/sources/pipeline-beatport.test.ts":
    "#220: subject pipeline/pipeline.ts + beatport",
  "src/fulltags/sources/sc-artist-gate.test.ts": "#220: subject sc-search.ts",
  // ---- archive/rekordbox/shelf/shared/getdat co-location debt (#214-adjacent
  // slices; migrate when the subject moves or name the subject test):
  "src/archive/genre.test.ts": "#214: subject similar.ts genre arms",
  "src/archive/mood-ledger.test.ts":
    "#214: subject record-ledger/state mood rows",
  "src/archive/state-genreflag.test.ts": "#214: subject state.ts genreflag",
  "src/rekordbox/comment-sync-unreadable.test.ts":
    "#214: subject rb-comment-sync unreadable-file arm",
  "src/rekordbox/rb-scripts-census.test.ts":
    "#214: census over rb-scripts corpus",
  "src/shared/maintenance-flags.test.ts":
    "#235: subject maintenance-cmds flag parsing",
  "src/shared/maintenance-verbs.test.ts":
    "#235: subject maintenance-cmds verb dispatch",
  "src/shelf/ext-drift.test.ts": "#214: subject dupescan ext-drift arm",
  "src/getdat/commands/ingest-fingerprint.test.ts":
    "#220: subject ingest.ts fingerprint arm",
  "src/getdat/commands/ingest-md5-dedupe.test.ts":
    "#220: subject ingest.ts md5 arm",
  "src/getdat/commands/ingest-selfmatch.test.ts":
    "#220: subject ingest.ts selfmatch arm",
  "src/getdat/commands/ingest-upgrade-row.test.ts":
    "#220: subject ingest.ts upgrade-row arm",
  "src/getdat/commands/intake-folders.e2e.test.ts":
    "#220: subject ingest.ts intake-folders flow",
};

/** Tests whose same-stem subject exists beside them (the rule's happy path). */
function hasStemSubject(testPath: string): boolean {
  const stem = testPath.replace(/\.test\.tsx?$/u, "");
  return (
    existsSync(join(ROOT, `${stem}.ts`)) ||
    existsSync(join(ROOT, `${stem}.tsx`))
  );
}

function trackedTests(): string[] {
  const { execFileSync } = require("node:child_process") as {
    execFileSync: (
      cmd: string,
      args: string[],
      opts?: { cwd?: string },
    ) => Buffer;
  };
  return execFileSync("git", ["ls-files", "*.test.ts", "*.test.tsx"], {
    cwd: ROOT,
  })
    .toString()
    .split("\n")
    .map((l: string) => l.trim())
    .filter((l: string) => l.length > 0);
}

test("#246: tracked test inventory is non-empty (the census scans the repo)", () => {
  expect(trackedTests().length).toBeGreaterThan(100);
});

test("#246: every co-located test has its subject; strays are allowlisted", () => {
  const offenders: string[] = [];
  const stale: string[] = [];
  const seen = new Set<string>();
  for (const t of trackedTests()) {
    seen.add(t);
    if (hasStemSubject(t)) continue;
    const dir = dirname(t);
    if (CENSUS_DIR.test(t) || SANCTIONED.test(`/${dir}/`) || dir === "src")
      continue;
    if (!(t in ALLOWLIST)) offenders.push(t);
  }
  for (const row of Object.keys(ALLOWLIST)) {
    if (!seen.has(row)) stale.push(row);
    const dir = dirname(row);
    if (CENSUS_DIR.test(row) || SANCTIONED.test(`/${dir}/`) || dir === "src")
      stale.push(row);
  }
  expect(
    offenders,
    `tests without a same-stem subject outside support/census/root — ` +
      `co-locate beside the subject, or allowlist with reason + issue ` +
      `(rule: #246):\n  ${offenders.join("\n  ")}`,
  ).toEqual([]);
  expect(
    stale,
    `allowlist rows that no longer describe a real violation — delete them:\n  ${stale.join("\n  ")}`,
  ).toEqual([]);
});

test("#246: the rule is recorded in AGENTS.md", () => {
  const { readFileSync } = require("node:fs") as {
    readFileSync: (p: string, enc?: string) => string;
  };
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  expect(agents).toContain("co-locates beside it");
});
