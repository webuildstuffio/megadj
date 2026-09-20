import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  formatCensusFailure,
  persistedJsonCensus,
  persistedJsonCensusForSources,
  scanJsonSource,
} from "../test-support/boundary-census";

const repo = join(import.meta.dir, "..", "..");
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
  // #215 fetch live-run protocol: the stderr @event line parser — a
  // malformed event line returns null and the feed simply skips it (the
  // run's stdout summary is the authoritative payload; the feed is
  // advisory). Never a throw into the job leg.
  "cratedeck/src/jobs/job-legs-fetch-protocol.ts::safeJsonParse::JSON.parse(line)":
    EXPLICIT_NULL_REASON,
  ...reviewed(HYGIENE_ROW_REASON, [
    "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.paths)",
    "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.bytes)",
    "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.md5s)",
    "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.fps)",
    "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.evidence)",
    "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse( row.proposed_action, )",
    "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.validation)",
  ]),
  'cratedeck/src/deckctl/queue.ts::enqueueAndFollow::JSON.parse(polled.result_json ?? "{}")':
    "deckctl consumes its own server job contract; invalid JSON terminates the command visibly.",
  ...reviewed(EXPLICIT_NULL_REASON, [
    "cratedeck/src/archive/overview.ts::parseCuePoints::JSON.parse(raw)",
    "src/fulltags/parse-json.ts::parseJsonObject::JSON.parse(raw)",
    "src/fulltags/media-probe.ts::parseFfprobeJson::JSON.parse(stdout)",
    // #173 genre-vote breakdown: the vote ledger's explainability column;
    // corrupt JSON reads as an empty breakdown, never a throw into a query.
    "src/fulltags/genre/genre-vote.ts::parseVotes::JSON.parse(raw)",
  ]),
  // rb-adopt mirror payload: the catch converts corrupt JSON into
  // "no RB row" (the mirrors then stand alone; rb-adopt re-adopt
  // rewrites the row) — the DB row itself is never touched.
  // Sep 16 (#89/#90 diet): re-keyed to archive/tag-compare.ts — the
  // one-track compare family (readRekordboxMirror included) moved out
  // of archive/tag-census.ts; same call, same sanction, new file path.
  "cratedeck/src/archive/tag-compare.ts::readRekordboxMirror::JSON.parse(rbMeta.metadata_json)":
    "Corrupt mirror JSON is treated as no rekordbox row: the census shows the archive side alone, rb-adopt re-adopt rewrites the row; never a throw into the route.",
  ...reviewed(CHECKED_SUBPROCESS_REASON, [
    'src/rekordbox/grid-triage.ts::readMasterRows::JSON.parse(lastJsonLine(r.stdout, "[]"))',
    "src/rekordbox/guard.ts::verifyReRead::JSON.parse(line)",
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
    // Sep 15 (#144): audited 60→59 / guarded 44→43 — the private
    // parseJsonBoundary twin in rb-dedup.ts is gone; the parse module
    // calls the rb-command-kit guarded seam, so one JSON.parse left
    // the audited surface. sanctioned 16 unchanged.
    // Sep 16 (#185): digest changed — fulltags/src/verify-key.ts adds
    // one GUARDED parse (the --refs map read: try/JSON.parse/catch
    // rethrow with cause; the old standalone harness never appeared in
    // this census because it was not under a production root).
    // Sep 16 (#42): digest changed again — parseJsonObject moved from
    // the analysis.ts shim to its own module (parse-json.ts); same
    // call, same sanction, new path in the digest input.
    // Sep 16 (CCN diet): digest changed — the rb-adopt mirror parse
    // moved from trackTagCompare into the extracted readRekordboxMirror
    // helper; same call, same sanction, new enclosing-function path.
    // Sep 16 (#106): audited/guarded 59→60 / 43→44 — the cues-ledger
    // pool join (archive/similar.ts parsePoolCues) adds one GUARDED
    // parse under the same EXPLICIT_NULL contract as parseCuePoints.
    // Sep 16 (CCN diet): digest changed — verify-key's --refs parse
    // moved owner (runVerifyKey→loadExternalRefs); same call, same
    // contract, new enclosing-function path.
    // Sep 16 (#173): audited 60→62 — fetch-genre-year's vote-collect
    // path re-homes one parse and genre-vote.ts parseVotes adds one;
    // sanctioned 16→17 (parseVotes joins EXPLICIT_NULL: corrupt vote
    // breakdown reads as empty, never a throw into a query).
    // Sep 17 (#193): digest changed — the fulltags package folded into
    // src/fulltags (digest input re-rooted; same calls, same guards,
    // counts unchanged).
    // Sep 16 (#42): digest changed — detect.ts's USB-tree family moved
    // to detect-usb.ts (parseUsbTreeJson) and photo primitives to
    // photo-files.ts; same calls, same guard shapes, new file paths.
    // Sep 17 (#88): digest changed — the usb_verify.py VERIFY_JSON read
    // in verify_parse.ts moved to verify-parse-metrics.ts
    // (extractVerifyMetrics); same guarded shape, new file path.
    // Sep 17 (#207): digest changed — parseAuditSummary's JSON.parse
    // moved from cratedeck job_legs.ts to job-legs-parse.ts (the #207
    // parse-seam split); same guarded shape, new file path.
    // Sep 17 (#232): digest changed — the parse/verify payloads of
    // rb-comment-sync moved to rb-comment-sync-parse.ts (the #232
    // parse-seam split); same guarded shape, new file path.
    // Sep 17 (#215 live-run pass): audited 62→64 / guarded 45→46 — the
    // fetch @event protocol adds a GUARDED parse in api_routes.ts
    // (/fetch/start body, 400-with-error catch) and job_legs.ts's
    // safeJsonParse; sanctioned 17→18 (safeJsonParse joins
    // EXPLICIT_NULL: a malformed feed line is skipped, never thrown).
    // Sep 18 (#147 Q4 armament): audited 64→65 / guarded 46→47 —
    // rb-anlz-spike set-grid's --beats parse joins the census as a
    // GUARDED parse (console.error catch + exit-2 usage error; a
    // malformed beats JSON can never crash the arm).
    // Sep 19 (fallback-slop audit R2): audited unchanged 65; guarded
    // 47→49 / sanctioned 18→16 — doctor-state's runStateProbe parses
    // (main probe + XML twin) gained real catch guards: a malformed
    // probe payload now reads as a probe ERROR, never a zero-shaped
    // "healthy" pass. The two CHECKED_SUBPROCESS sanctions retired.
    // Sep 19 (#235): audited 65→66 / guarded 49→50 — the rb-anlz-spike
    // arm moved from shared/maintenance-cmds.ts to
    // rekordbox/cli-commands.ts (same guarded --beats parse, new file
    // path in the digest input).
    // Sep 19 (#20 SC sources): audited 66→68 / guarded 50→51 /
    // sanctioned 16→17 — sync.ts's SC source fan-out adds one guarded
    // parse (parsePlaylistOutput) and one sanctioned
    // CHECKED_SUBPROCESS parse (scSourceQueue: exit-code gate +
    // classifyScFailure above, isRecord/isUnknownArray guards below).
    // Sep 19 (#240-review follow-through): scSourceQueue's raw parse is
    // now GUARDED (try/catch with cause, same contract as
    // parsePlaylistOutput) — the sanction retires; sanctioned 17→16.
    // Sep 19 (#256 purchase_url): soundcloud.ts's enrichment probe reads
    // the raw api-v2 track object through parseJsonObject (the shared
    // guarded parser, explicit-null) — audited 68 (parseJsonObject was
    // already the counted call), digest shifted only.
    // Sep 17 (#220 genre/ slice): genre-vote.ts parseVotes sanction re-keyed
    // to src/fulltags/genre/genre-vote.ts (same call, same guard, counts
    // unchanged) — digest shifted.
    // Sep 17 (#220 sources/ slice): file re-homes moved owners (digest
    // input re-rooted; same calls, same guards, counts unchanged).
    // Sep 17 (#215 live-run pass): digest changed — api_routes.ts
    // /fetch/start body parse (guarded) + job_legs.ts safeJsonParse
    // (sanctioned) join the census.
    // Sep 18 (#220 analysis/ slice): file re-homes moved owners (digest
    // input re-rooted; same calls, same guards, counts unchanged).
    // Sep 18 (#220 write/ slice): file re-homes moved owners again (same
    // calls, same guards, counts unchanged) — digest shifted: acd7abc3.
    // Sep 19 (#214 job-leg slice): safeJsonParse moved into the fetch
    // protocol leaf; the explicit-null contract and counts are unchanged.
    // Sep 19 (#214 database slice): guarded event/snapshot/report readers
    // moved under db/; their failure contracts and counts are unchanged.
    // Sep 19 (#214 archive slice): the overview and tag-compare readers
    // moved under archive/; their failure contracts and counts are unchanged.
    // Sep 19 (#256 surfaced checklist): ingestStatus's surfaced-cohort
    // read adds one GUARDED parse (source_links JSON, console.error
    // catch — corrupt link data is visible, never a silent empty list);
    // audited 68→69 / guarded 52→53, sanctioned 16 unchanged.
    audited: 69,
    guarded: 53,
    sanctioned: 16,
    digest: "669f9ab383bff9006caf00c692d4728b0513f32dc80cc45426c7e404b71ae1c5",
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
