import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  formatCensusFailure,
  isProductionSourcePath,
  numberBoundaryCensus,
  numberBoundaryCensusForSources,
  scanNumberSource,
} from "./test-support/boundary-census";

const repo = join(import.meta.dir, "..");
const NUMBER_SANCTIONS: Readonly<Record<string, string>> = {
  "src/cli-commands-core.ts::ingest::Number(minDurationRaw)":
    "The option gate rejects non-finite values, while the undefined branch passes undefined rather than the NaN sentinel to ingest.",
  "cratedeck/src/bench.ts::biggestFiles::Number(st.size)":
    "Bun stat size is trusted filesystem metadata and practical drive sizes are safe integers.",
  "cratedeck/web/products/fulltags/MegasetPanel.tsx::MegasetPanel::Number(minutesInput)":
    "clampMinutes finite-checks the converted form value and supplies the default.",
  "cratedeck/web/ui/JobsDock.tsx::phaseLabel::Number(m[1])":
    "m[1] is a digits-only phase regex capture and array lookup has an explicit fallback.",
  "fulltags/src/writer.ts::applyTags::Number(meta.date.match(/\\d{4}/)?.[0])":
    "the optional value is a four-digit regex capture; absence becomes undefined.",
  "fulltags/src/writer.ts::mp4Statement::Number(v)":
    "the bpm branch receives a typed internal TagPatch number before serialization.",
  "fulltags/src/writer.ts::mp4VerifyStatement::Number(v)":
    "the verifier receives the same typed internal TagPatch BPM number before serialization.",
  "fulltags/src/pipeline.ts::parseMoodStamp::Number(m[2])":
    "m[2] is a digits-and-decimal-only regex capture and need() finite-checks every consumed value.",
  "src/fulltags/years.ts::parseScPageDates::Number(year)":
    "year is a four-digit regex capture.",
  "src/fulltags/years.ts::ytdlpYearsBatch::Number(uploadDate.slice(0, 4))":
    "the enclosing branch first validates uploadDate as exactly eight digits.",
  "src/getdat/commands/intake-folder.ts::dumpDateFromNameParts::Number(m[1])":
    "m[1] is a digits-only date regex capture.",
  "src/fulltags/genre-refold.ts::refoldDetail::Number(i)":
    "i is a digits-only capture from the SENTINEL(\\d+)SENTINEL restore regex, and stash lookups use the same captured index.",
  // #184: the second front door (tools/fetch-all.ts import.meta.main argv
  // parse, with its Number(argv[jobsArg+1]) site) was deleted — `megadj
  // fetch` is the only entry and its --jobs rides nonNegOpt.
  "fulltags/src/bandcamp.ts::parseIsoDuration::Number(d)":
    "d is a digits-only ISO-8601 duration capture (P…D group), truthiness-gated before use.",
  "fulltags/src/bandcamp.ts::parseIsoDuration::Number(h)":
    "h is a digits-only ISO-8601 duration capture (T…H group), truthiness-gated before use.",
  "fulltags/src/bandcamp.ts::parseIsoDuration::Number(min)":
    "min is a digits-only ISO-8601 duration capture (T…M group), truthiness-gated before use.",
  "fulltags/src/bandcamp.ts::parseIsoDuration::Number(s)":
    "s is a digits-or-decimal ISO-8601 duration capture (T…S group), truthiness-gated before use.",
  "fulltags/src/fetch-stages.ts::stageBandcamp::Number(page.datePublished.slice(0, 4))":
    "datePublished is DB JSON produced by the fetch pipeline's four-digit year regex; the slice is exactly four chars.",
};

test("boundary Number() calls are finite-gated or explicitly sanctioned", () => {
  const result = numberBoundaryCensus(repo, NUMBER_SANCTIONS);
  expect(
    [
      ...result.violations,
      ...result.unusedAllowlist,
      ...result.redundantAllowlist,
      ...result.duplicateKeys,
    ],
    formatCensusFailure("Number()", result),
  ).toHaveLength(0);
  expect({
    audited: result.audited,
    guarded: result.guarded,
    sanctioned: result.sanctioned,
    digest: result.digest,
  }).toEqual({
    // Sep 15 (#79/#80/#84 pass): rb-import payload probing moved to the
    // fulltags media seam (removed its 2 Number() sites); audited 42→44
    // and sanctioned 13→18 from the concurrent bandcamp ISO-duration +
    // fetch-stages stageBandcamp year work landing in the same worktree.
    audited: 43,
    guarded: 26,
    sanctioned: 17,
    // Sep 16 (#181): beatport parseTrack decomposed — the publish-date
    // Number() site moved owner parseTrack→parseYear (still guarded by
    // Number.isInteger; counts unchanged, digest shifted).
    // Sep 16 (#184): fetch pipeline re-homed into fulltags; the second
    // front door's argv Number() site died with the shim (audited 44→43,
    // sanctioned 18→17) and fetch-stages moved owner+path (digest shift).
    digest: "0623ceafdbcd58db0bb28e61fea177fd1792e88e16f315cf33910f5c998f9fca",
  });
});

test("Number() sanctions carry an audit reason", () => {
  expect(
    Object.values(NUMBER_SANCTIONS).every((reason) => reason.length > 20),
  ).toBe(true);
});

test("Number() scanner reports locations and ignores prose", () => {
  const calls = scanNumberSource(
    "fixture.ts",
    `// Number(comment)
const prose = "Number(string)";
const retries = Number(
  process.env.RETRIES,
);`,
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ file: "fixture.ts", line: 3 });
  expect(
    formatCensusFailure("Number()", {
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
  ).toContain("fixture.ts:3 Number( process.env.RETRIES, )");
});

const CASES: readonly [name: string, source: string, violations: number][] = [
  [
    "later check cannot bless an earlier use",
    "const n=Number(raw); consume(n); if(Number.isFinite(n)) return;",
    1,
  ],
  [
    "nested check cannot guard an outer conversion",
    "const n=Number(raw); const later=()=>Number.isFinite(n); consume(n);",
    1,
  ],
  [
    "positive early return leaves the invalid path",
    "const n=Number(raw); if(Number.isFinite(n)) return; consume(n);",
    1,
  ],
  [
    "negative early exit guards later use",
    "const n=Number(raw); if(!Number.isFinite(n)) throw Error(); consume(n);",
    0,
  ],
  [
    "discarded predicate guards nothing",
    "const n=Number(raw); Number.isFinite(n); consume(n);",
    1,
  ],
  [
    "invalid ternary arm cannot consume n",
    "const n=Number(raw); consume(Number.isFinite(n) ? 0 : n);",
    1,
  ],
  [
    "finite ternary arm may consume n",
    "const n=Number(raw); consume(Number.isFinite(n) && n>0 ? n : 0);",
    0,
  ],
  [
    "OR does not prove its true branch",
    "const n=Number(raw); consume(Number.isFinite(n) || enabled ? n : 0);",
    1,
  ],
  [
    "positive if protects its branch",
    "const n=Number(raw); if(Number.isFinite(n)) consume(n);",
    0,
  ],
  [
    "negative if cannot consume invalid n",
    "const n=Number(raw); if(!Number.isFinite(n)) consume(n);",
    1,
  ],
  [
    "negative if protects its else",
    "const n=Number(raw); if(!Number.isFinite(n)) noop(); else consume(n);",
    0,
  ],
  [
    "invalid use remains invalid before throw",
    "const n=Number(raw); if(!Number.isFinite(n)){consume(n); throw Error();}",
    1,
  ],
  [
    "safe-integer validation proves finiteness",
    "const n=Number(raw); if(!Number.isSafeInteger(n)) throw Error(); consume(n);",
    0,
  ],
  [
    "extra predicate argument is ignored by JavaScript",
    "consume(Number.isFinite(0, Number(raw)));",
    1,
  ],
  [
    "post-guard reassignment invalidates proof",
    "let n=Number(raw); if(!Number.isFinite(n)) throw Error(); n=Number.NaN; consume(n);",
    1,
  ],
  [
    "a discarded predicate does not hide a later guard",
    "const n=Number(raw); Number.isFinite(n); if(!Number.isFinite(n)) throw Error(); consume(n);",
    0,
  ],
];

for (const [name, source, violations] of CASES) {
  test(name, () => {
    const result = numberBoundaryCensusForSources({ "fixture.ts": source }, {});
    expect(result.violations).toHaveLength(violations);
    expect(result.guarded).toBe(violations === 0 ? 1 : 0);
  });
}

test("test and fixture paths are excluded from the production census", () => {
  expect(isProductionSourcePath("src/live.ts")).toBe(true);
  for (const path of [
    "src/live.spec.ts",
    "src/live.test.tsx",
    "src/__tests__/live.ts",
    "src/fixtures/live.ts",
    "src/test-support/live.ts",
    "src/testutil.ts",
  ])
    expect(isProductionSourcePath(path), path).toBe(false);
});
