import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  formatCensusFailure,
  persistedJsonCensus,
  persistedJsonCensusForSources,
  scanJsonSource,
} from "./test-support/boundary-census";

const repo = join(import.meta.dir, "..");
const reviewed = (
  reason: string,
  keys: readonly string[],
): Readonly<Record<string, string>> =>
  Object.fromEntries(keys.map((key) => [key, reason]));
const HYGIENE_ROW_REASON =
  "hydrateHygieneFinding intentionally throws; both ledger readers catch per row, log the row id, and skip only corruption.";
const CHECKED_SUBPROCESS_REASON =
  "The checked subprocess has already passed its exit/stdout gate; malformed success output throws through the command boundary and cannot become a false success.";
const EXPLICIT_NULL_REASON =
  "The parser returns null as an explicit failure value; its caller converts that value into a logged skip or a failed probe result.";
const PERSISTED_JSON_SANCTIONS: Readonly<Record<string, string>> = {
  ...reviewed(HYGIENE_ROW_REASON, [
    "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.paths)",
    "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.bytes)",
    "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.md5s)",
    "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.fps)",
    "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.evidence)",
    "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse( row.proposed_action, )",
    "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.validation)",
  ]),
  'cratedeck/src/deckctl_queue.ts::enqueueAndFollow::JSON.parse(polled.result_json ?? "{}")':
    "deckctl consumes its own server job contract; invalid JSON terminates the command visibly.",
  ...reviewed(EXPLICIT_NULL_REASON, [
    "cratedeck/src/archive_overview.ts::parseCuePoints::JSON.parse(raw)",
    "fulltags/src/analysis.ts::parseJsonObject::JSON.parse(raw)",
    "fulltags/src/media-probe.ts::parseFfprobeJson::JSON.parse(stdout)",
  ]),
  // rb-adopt mirror payload: the catch converts corrupt JSON into
  // "no RB row" (the mirrors then stand alone; rb-adopt re-adopt
  // rewrites the row) — the DB row itself is never touched.
  "cratedeck/src/archive_tagcensus.ts::trackTagCompare::JSON.parse(rbMeta.metadata_json)":
    "Corrupt mirror JSON is treated as no rekordbox row: the census shows the archive side alone, rb-adopt re-adopt rewrites the row; never a throw into the route.",
  ...reviewed(CHECKED_SUBPROCESS_REASON, [
    'src/rekordbox/grid-triage.ts::readMasterRows::JSON.parse(lastJsonLine(r.stdout, "[]"))',
    "src/rekordbox/guard.ts::verifyReRead::JSON.parse(line)",
    'src/shared/doctor-state.ts::runStateProbe::JSON.parse(r.stdout.trim().split("\\n").pop() ?? "{}")',
    'src/shared/doctor-state.ts::runStateProbe::JSON.parse(rx.stdout.trim().split("\\n").pop() ?? "{}")',
  ]),
};

test("all JSON.parse calls are visibly guarded or explicitly sanctioned", () => {
  const result = persistedJsonCensus(repo, PERSISTED_JSON_SANCTIONS);
  expect(
    [
      ...result.violations,
      ...result.unusedAllowlist,
      ...result.redundantAllowlist,
      ...result.duplicateKeys,
    ],
    formatCensusFailure("JSON.parse", result),
  ).toHaveLength(0);
  expect({
    audited: result.audited,
    guarded: result.guarded,
    sanctioned: result.sanctioned,
    digest: result.digest,
  }).toEqual({
    // Sep 15 (#80): the ffprobe consolidation routed dedupe-probe and
    // rb-import bitrate probing through fulltags media-probe (no new
    // JSON.parse sites); the audited delta 58→59 is the concurrent
    // bandcamp.ts ld+json guarded parse landing in the same worktree.
    audited: 59,
    guarded: 43,
    sanctioned: 16,
    digest: "6d00ec06d52f23adc4ab9de87ec6a0c806f0075061dea30c0cca037473bb74b9",
  });
});

test("persisted JSON sanctions carry an audit reason", () => {
  expect(
    Object.values(PERSISTED_JSON_SANCTIONS).every(
      (reason) => reason.length > 20,
    ),
  ).toBe(true);
});

test("JSON scanner reports locations, follows aliases, and ignores prose", () => {
  const calls = scanJsonSource(
    "fixture.ts",
    `// JSON.parse(comment)
const prose = "JSON.parse(string)";
const raw = row.result_json;
const result = JSON.parse(
  raw,
);`,
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ file: "fixture.ts", line: 4 });
  expect(
    formatCensusFailure("JSON.parse", {
      calls,
      violations: calls,
      unusedAllowlist: [],
      redundantAllowlist: [],
      duplicateKeys: [],
      audited: 1,
      guarded: 0,
      sanctioned: 0,
      digest: "fixture",
    }),
  ).toContain("fixture.ts:4 JSON.parse( raw, )");
});

test("identical parses remain distinct review sites", () => {
  const result = persistedJsonCensusForSources(
    { "fixture.ts": "function read(){ JSON.parse(raw); JSON.parse(raw); }" },
    {},
  );
  expect(result.violations).toHaveLength(2);
  expect(new Set(result.violations.map((call) => call.key)).size).toBe(2);
});

function catchViolations(body: string): number {
  const source = `let failures=0;
declare const report:(message:string)=>void;
function parse(){try{JSON.parse(row.result_json);}catch{${body}}}`;
  return persistedJsonCensusForSources({ "fixture.ts": source }, {}).violations
    .length;
}

const CATCH_CASES: readonly [name: string, body: string, violations: number][] =
  [
    ["comment is silent", "/* corrupt data */", 1],
    [
      "uncalled nested logger is silent",
      "const later=()=>console.error('bad'); void later;",
      1,
    ],
    [
      "dead error-shaped local is silent",
      "const ignored={error:'bad'}; void ignored;",
      1,
    ],
    ["local counter is silent", "let bad=0; bad++;", 1],
    ["local logger is silent", "const log=()=>{}; log('bad');", 1],
    ["unrelated call is silent", "noop();", 1],
    ["unrelated outer state is silent", "status='idle';", 1],
    ["null fallback is silent", "return null;", 1],
    ["array fallback is silent", "return [];", 1],
    ["object fallback is silent", "return {};", 1],
    ["false fallback is silent", "return false;", 1],
    ["reporter substring in catalog is silent", "catalog();", 1],
    ["reporter substring in invalidator is silent", "invalidateCache();", 1],
    ["later warn-like catalog method is silent", "catalogWarns();", 1],
    ["failure object is visible", "return {ok:false,error:'bad'};", 0],
    ["outer reporter is visible", "report('corrupt payload');", 0],
    ["outer failure counter is visible", "failures++;", 0],
    ["console error is visible", "console.error('corrupt payload');", 0],
  ];

for (const [name, body, violations] of CATCH_CASES)
  test(name, () => expect(catchViolations(body), body).toBe(violations));

test("a sanction becomes stale once its catch is visibly guarded", () => {
  const source = "try{JSON.parse(raw)}catch(error){console.error(error)}";
  const [call] = scanJsonSource("fixture.ts", source);
  const result = persistedJsonCensusForSources(
    { "fixture.ts": source },
    { [call!.key]: "intentionally redundant fixture sanction" },
  );
  expect(result.redundantAllowlist).toEqual([call!.key]);
});
