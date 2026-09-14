import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  formatCensusFailure,
  persistedJsonCensus,
  persistedJsonCensusForSources,
  scanJsonSource,
} from "./test-support/boundary-census";

const repo = join(import.meta.dir, "..");

function reviewed(
  reason: string,
  keys: readonly string[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(keys.map((key) => [key, reason]));
}

const HYGIENE_ROW_REASON =
  "hydrateHygieneFinding intentionally throws; both ledger readers catch per row, log the row id, and skip only corruption.";
const CHECKED_SUBPROCESS_REASON =
  "The checked subprocess has already passed its exit/stdout gate; malformed success output throws through the command boundary and cannot become a false success.";
const PERSISTED_JSON_SANCTIONS: Readonly<Record<string, string>> = {
  "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.paths)":
    HYGIENE_ROW_REASON,
  "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.bytes)":
    HYGIENE_ROW_REASON,
  "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.md5s)":
    HYGIENE_ROW_REASON,
  "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.fps)":
    HYGIENE_ROW_REASON,
  "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.evidence)":
    HYGIENE_ROW_REASON,
  "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse( row.proposed_action, )":
    HYGIENE_ROW_REASON,
  "cratedeck/shared/hygiene.ts::hydrateHygieneFinding::JSON.parse(row.validation)":
    HYGIENE_ROW_REASON,
  'cratedeck/src/deckctl_queue.ts::enqueueAndFollow::JSON.parse(polled.result_json ?? "{}")':
    "deckctl consumes its own server job contract; invalid JSON terminates the command visibly.",
  "fulltags/src/analysis.ts::parseJsonObject::JSON.parse(raw)":
    "The parser returns null on malformed analyzer output; every caller treats null as an explicit missing or invalid response.",
  "fulltags/src/media-probe.ts::parseFfprobeJson::JSON.parse(stdout)":
    "The parser returns null on malformed ffprobe output and probeFile converts that result into an explicit ok:false probe failure.",
  ...reviewed(CHECKED_SUBPROCESS_REASON, [
    'src/rekordbox/grid-triage.ts::readMasterRows::JSON.parse(r.stdout.trim().split("\\n").pop() ?? "[]")',
    "src/rekordbox/guard.ts::verifyReRead::JSON.parse(line)",
    'src/rekordbox/rb-comment-sync.ts::rbCommentSync::JSON.parse(r.stdout.trim().split("\\n").pop() ?? "{}")',
    'src/rekordbox/rb-cues.ts::rbCues::JSON.parse(r.stdout.trim().split("\\n").pop() ?? "{}")#1',
    'src/rekordbox/rb-cues.ts::rbCues::JSON.parse(r.stdout.trim().split("\\n").pop() ?? "{}")#2',
    'src/rekordbox/rb-cues.ts::rbCues::JSON.parse( (zeroCheck.stdout ?? \'{"remaining":-1}\').trim().split("\\n").pop() ?? \'{"remaining":-1}\', )',
    'src/rekordbox/rb-dedup.ts::rbDedup::JSON.parse(r.stdout.trim().split("\\n").pop() ?? "{}")',
    'src/rekordbox/rb-dedup.ts::rbDedup::JSON.parse(rd.stdout.trim().split("\\n").pop() ?? "{}")',
    "src/rekordbox/rb-import.ts::rbImport::JSON.parse(line)",
    'src/rekordbox/rb-import.ts::rbImport::JSON.parse(rv.stdout.trim().split("\\n").pop() ?? "{}")',
    'src/rekordbox/rb-playlist-reconcile.ts::rbPlaylistReconcile::JSON.parse(r.stdout.trim().split("\\n").pop() ?? "{}")',
    'src/rekordbox/rb-playlist.ts::rbPlaylist::JSON.parse(r.stdout.trim().split("\\n").pop() ?? "{}")',
    'src/rekordbox/rb-playlist.ts::rbPlaylist::JSON.parse(rv.stdout.trim().split("\\n").pop() ?? "{}")',
    'src/rekordbox/rb-playlist.ts::predictMatches::JSON.parse(r.stdout.trim().split("\\n").pop() ?? "{}")',
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
    audited: 68,
    guarded: 42,
    sanctioned: 26,
    digest: "7debd472229e02f8f155d5e6409cb0b6aaeff33a8dde7d4e288ccd233cd75e94",
  });
});

test("persisted JSON sanctions carry an audit reason", () => {
  expect(
    Object.values(PERSISTED_JSON_SANCTIONS).every(
      (reason) => reason.length > 20,
    ),
  ).toBe(true);
});

test("persisted JSON census reports a new raw parse with file and line", () => {
  const [violation] = scanJsonSource(
    "fixture.ts",
    "const result = JSON.parse(row.result_json);",
  );
  expect(violation).toMatchObject({ file: "fixture.ts", line: 1 });
  expect(
    formatCensusFailure("JSON.parse", {
      calls: [violation!],
      violations: [violation!],
      unusedAllowlist: [],
      redundantAllowlist: [],
      duplicateKeys: [],
      audited: 1,
      guarded: 0,
      sanctioned: 0,
      digest: "fixture",
    }),
  ).toContain("fixture.ts:1 JSON.parse(row.result_json)");
});

test("persisted JSON census follows a local alias to the stored blob", () => {
  const [violation] = scanJsonSource(
    "fixture.ts",
    "const raw = row.result_json;\nconst result = JSON.parse(raw);",
  );
  expect(violation).toMatchObject({ file: "fixture.ts", line: 2 });
});

test("transient subprocess JSON still requires a guard or sanction", () => {
  const result = persistedJsonCensusForSources(
    { "fixture.ts": "const result = JSON.parse(stdout);" },
    {},
  );
  expect(result.violations).toHaveLength(1);
});

test("identical persisted parses remain distinct review sites", () => {
  const result = persistedJsonCensusForSources(
    {
      "fixture.ts": `function read(row: { result_json: string }) {
  JSON.parse(row.result_json);
  JSON.parse(row.result_json);
}`,
    },
    {},
  );
  expect(result.violations).toHaveLength(2);
  expect(new Set(result.violations.map((call) => call.key)).size).toBe(2);
  expect(result.violations.map((call) => call.line)).toEqual([2, 3]);
});

test("JSON scanner ignores prose and finds multiline calls", () => {
  const calls = scanJsonSource(
    "fixture.ts",
    `// JSON.parse(comment)
const prose = "JSON.parse(string)";
const parsed = JSON.parse(
  raw,
);`,
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ line: 3 });
});

test("a sanction becomes stale once its catch is visibly guarded", () => {
  const source = `try {
  JSON.parse(row.result_json);
} catch (error) {
  console.error("corrupt result", error);
}`;
  const [call] = scanJsonSource("fixture.ts", source);
  const result = persistedJsonCensusForSources(
    { "fixture.ts": source },
    { [call!.key]: "fixture is intentionally redundant for this test" },
  );
  expect(result.redundantAllowlist).toEqual([call!.key]);
});

test("a silent catch comment does not count as visible failure", () => {
  const result = persistedJsonCensusForSources(
    {
      "fixture.ts": `try {
  JSON.parse(row.result_json);
} catch {
  // corrupt persisted data is ignored
}`,
    },
    {},
  );
  expect(
    result.violations,
    formatCensusFailure("persisted JSON.parse", result),
  ).toHaveLength(1);
  expect(result.violations[0]).toMatchObject({ file: "fixture.ts", line: 2 });
});
