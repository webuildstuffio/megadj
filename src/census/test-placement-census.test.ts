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
  // ---- rev-51 (#295): the megaset-cohorts route contract test — the
  // subject is the "megaset-cohorts" KEY inside routes-archive.ts's
  // handler map (routes are map keys, not files), so there is no
  // same-stem subject file to co-locate beside.
  "src/deck/api/megaset-cohorts-route.test.ts":
    "#295 rev-51: subject = megaset-cohorts route key in routes-archive.ts",
  // ---- src/census/: the census dir itself is sanctioned by rule, but the
  // walker needs no special case — these prove the sanctioned regex works.
  // ---- fulltags co-location debt (rides #220's folder pass):
  "src/fulltags/analysis/mood-queue.test.ts":
    "#220: subject mood.ts lives in analysis/",
  "src/fulltags/booth/booth-fix.e2e.test.ts":
    "#220: subject booth-fix.ts lives in booth/",
  "src/fulltags/genre/genre-vocab-crossmap.test.ts":
    "#220: subject genre-vocab.ts",
  "src/fulltags/sources/clean-search-parts.test.ts":
    "#220: subject art-sources.ts + #322: query-building folded into name-match.ts",
  "src/fulltags/sources/mb-lookup.test.ts": "#220: subject mb_lookup.py seam",
  "src/fulltags/sources/models.test.ts":
    "#220: integration of models+pipeline+writer",
  "src/fulltags/sources/pipeline-beatport.test.ts":
    "#220: subject pipeline/pipeline.ts + beatport",
  "src/fulltags/sources/sc-artist-gate.test.ts": "#220: subject sc-search.ts",
  // ---- archive/rekordbox/shelf/shared/getdat co-location debt (#214-adjacent
  // slices; migrate when the subject moves or name the subject test):
  "src/core/mood-ledger.test.ts": "#214: subject record-ledger/state mood rows",
  "src/core/state-genreflag.test.ts": "#214: subject state.ts genreflag",
  "src/rekordbox/comment-sync-unreadable.test.ts":
    "#214: subject rb-comment-sync unreadable-file arm",
  "src/rekordbox/rb-scripts-census.test.ts":
    "#214: census over rb-scripts corpus",
  "src/shared/maintenance-flags.test.ts":
    "#235: subject (dissolved maintenance arms) flag parsing — CLI-level",
  "src/shared/maintenance-verbs.test.ts":
    "#235: subject (dissolved maintenance arms) dispatch pin — CLI-level",
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
  // ---- cratedeck #214 slices: domain-dir contract tests that span several
  // subjects (no single same-stem owner) — co-located to the DOMAIN, and
  // the domain dir IS the subject class:
  "src/deck/hygiene/api.test.ts":
    "#214: reader+routes wire contract pair (domain-dir test)",
  "src/deck/verify/phases.test.ts":
    "#214: verifyPhase progress contract (subject lives in jobs/job-runtime)",
  "src/deck/fleet/fleet.test.ts":
    "#214: coverage+coverage-fleet+fleet-db engine round-trip (domain test)",
  "src/deck/mcp/mcp.test.ts":
    "#214: mcp stdio protocol over spawned server (domain-dir test)",
  // ---- #315 deck-archive fold: tests moved beside their subjects, but
  // multi-subject/domain tests keep the domain-dir pattern above:
  "src/deck/api/api-parity-census.test.ts":
    "#315: client↔server route parity census (domain-dir test, api is the subject class)",
  "src/deck/api/archive-dispatch-census.test.ts":
    "#315: /api/archive/* dispatch reachability (domain-dir test)",
  "src/deck/megaset/pool-contract.test.ts":
    "#315: pool admission/cues-join contract (multi-subject: pool+reader+types)",
  "src/deck/megaset/surface.test.ts":
    "#315: megaset surface over routes+tools+reader (domain-dir test)",
  "src/fulltags/cli/enrich.test.ts":
    "#319: enrich stage test lives with the CLI that dispatches it (subject fetch/enrich kept at #220 row)",

  // ---- #319 root tidy: multi-subject/domain-dir tests co-located to the
  // owning dir (same pattern as the #214 rows above):
  "src/deck/tools/bench-hash-cancel.test.ts":
    "#319: bench cancel/hash contract (multi-subject: bench+db)",
  "src/deck/tools/fetch-routes.test.ts":
    "#319: fetch feed HTTP surface (multi-subject: fetch-feed+routes)",
  "src/deck/tools/scan-detect.test.ts":
    "#319: scan+usb-tree integration (multi-subject: scan+detect)",
  "src/deck/tools/walk-async.test.ts":
    "#319: async-only invariant over walk/scan/bench (dir IS the subject set)",
  "src/fulltags/analysis/gold-set.test.ts":
    "#319: gold harness contract over gold+gold-score (domain-dir test)",
  "src/fulltags/cli/cli-options.test.ts":
    "#319: fulltags CLI arg safety (spawns cli/cli.ts, domain-dir test)",
  "src/fulltags/cli/fetch.test.ts":
    "#319: fetch end-to-end through the CLI dispatch (domain-dir test)",
  "src/fulltags/megaset/megaset-cli.test.ts":
    "#319: megaset CLI verbs (multi-subject: cli-verbs+megaset)",
  "src/fulltags/pipeline/identity-split.test.ts":
    "#319: identity split contract (multi-subject: identity+metadata-build)",

  // ---- #327 buildPlan extraction: the golden-pin file pins BOTH the
  // engine wire (buildMegaset scenarios) AND the plan seam — two
  // subjects, one contract (multi-subject: engine+plan):
  "src/deck/megaset/engine-plan.test.ts":
    "#327: byte-identical-chain golden pins over engine+plan (multi-subject)",
  "src/deck/megaset/megaset-calibration.test.ts":
    "#306: scoring-calibration digest over the full stack (multi-subject: engine+scoring+search+pool)",
  "src/fulltags/analysis/mood-first-chunk.test.ts":
    "#308: pre-first-chunk visibility contract over the mood pipeline stages (multi-subject: mood+queue+summary)",
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
  try {
    return execFileSync("git", ["ls-files", "*.test.ts", "*.test.tsx"], {
      cwd: ROOT,
    })
      .toString()
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0);
  } catch (err) {
    // Under `bun test --parallel=16` a dozen census tests spawn git at once;
    // a colliding spawn can lose the index.lock race and exit non-zero with
    // empty stdout. An EMPTY inventory must never look like a passing scan —
    // fail loud (with the git error) instead of silently returning [].
    throw new Error(
      `git ls-files failed under parallel load (index.lock contention?) — census cannot scan: ${String(err)}`,
      { cause: err },
    );
  }
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
