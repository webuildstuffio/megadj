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
  "cratedeck/src/bench.ts::biggestFiles::Number(st.size)":
    "Bun stat size is trusted filesystem metadata and practical drive sizes are safe integers.",
  "cratedeck/web/products/fulltags/SimilarTab.tsx::SetBuildPanel::Number(minutesInput)":
    "clampMinutes finite-checks the converted form value and supplies the default.",
  "cratedeck/web/ui/JobsDock.tsx::phaseLabel::Number(m[1])":
    "m[1] is a digits-only phase regex capture and array lookup has an explicit fallback.",
  "fulltags/src/writer.ts::applyTags::Number(meta.date.match(/\\d{4}/)?.[0])":
    "the optional value is a four-digit regex capture; absence becomes undefined.",
  "fulltags/src/writer.ts::mp4Statement::Number(v)":
    "the bpm branch receives a typed internal TagPatch number before serialization.",
  "fulltags/src/pipeline.ts::parseMoodStamp::Number(m[2])":
    "m[2] is a digits-and-decimal-only regex capture and need() finite-checks every consumed value.",
  "src/archive/sqlite-id.ts::sqliteRowId::Number(raw)":
    "sqliteRowId rejects non-positive and non-safe integers before returning a JavaScript row id.",
  "src/fulltags/years.ts::parseScPageDates::Number(year)":
    "year is a four-digit regex capture.",
  "src/fulltags/years.ts::ytdlpYearsBatch::Number(uploadDate.slice(0, 4))":
    "the enclosing branch first validates uploadDate as exactly eight digits.",
  "src/getdat/commands/intake-folder.ts::dumpDateFromNameParts::Number(m[1])":
    "m[1] is a digits-only date regex capture.",
  "tools/fetch-all.ts::<module>::Number(argv[jobsArg + 1])":
    "the command rejects a non-finite or sub-one jobs value with process.exit(2) before constructing options.",
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
    audited: 42,
    guarded: 31,
    sanctioned: 11,
    digest: "2fa2525e36cc87e1632e90fecc368614d8a068d8d8c3b97f65b81f6fc60da5ee",
  });
});

test("Number() sanctions carry an audit reason", () => {
  expect(
    Object.values(NUMBER_SANCTIONS).every((reason) => reason.length > 20),
  ).toBe(true);
});

test("Number() census reports a new boundary with file and line", () => {
  const [violation] = scanNumberSource(
    "fixture.ts",
    "const retries = Number(process.env.RETRIES);",
  );
  expect(violation).toMatchObject({ file: "fixture.ts", line: 1 });
  expect(
    formatCensusFailure("Number()", {
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
  ).toContain("fixture.ts:1 Number(process.env.RETRIES)");
});

test("Number() scanner ignores prose and finds multiline calls", () => {
  const calls = scanNumberSource(
    "fixture.ts",
    `// Number(comment)
const prose = "Number(string)";
const retries = Number(
  process.env.RETRIES,
);`,
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ line: 3 });
});

test("a later finite check does not bless an earlier unsafe use", () => {
  const result = numberBoundaryCensusForSources(
    {
      "fixture.ts": `const n = Number(process.env.N);
consume(n);
if (Number.isFinite(n)) return;`,
    },
    {},
  );
  expect(result.violations).toHaveLength(1);
});

test("a nested finite check does not guard an outer conversion", () => {
  const result = numberBoundaryCensusForSources(
    {
      "fixture.ts": `const n = Number(process.env.N);
const checkLater = () => Number.isFinite(n);
consume(n);`,
    },
    {},
  );
  expect(result.violations).toHaveLength(1);
});

test("a positive early-return check does not guard the invalid path", () => {
  const result = numberBoundaryCensusForSources(
    {
      "fixture.ts": `const n = Number(process.env.N);
if (Number.isFinite(n)) return;
consume(n);`,
    },
    {},
  );
  expect(result.violations).toHaveLength(1);
});

test("an assigned conversion is guarded when its first use is a finite check", () => {
  const result = numberBoundaryCensusForSources(
    {
      "fixture.ts": `const n = Number(process.env.N);
if (!Number.isFinite(n)) throw new Error("bad N");
consume(n);`,
    },
    {},
  );
  expect(result.violations).toHaveLength(0);
  expect(result.guarded).toBe(1);
});

test("test and fixture paths are excluded from the production census", () => {
  expect(isProductionSourcePath("src/live.ts")).toBe(true);
  for (const path of [
    "src/live.spec.ts",
    "src/live.test.tsx",
    "src/__tests__/live.ts",
    "src/fixtures/live.ts",
    "src/test-support/live.ts",
    "src/testutil.ts",
  ]) {
    expect(isProductionSourcePath(path), path).toBe(false);
  }
});
