import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  formatCensusFailure,
  isProductionSourcePath,
  numberBoundaryCensus,
  numberBoundaryCensusForSources,
  scanNumberSource,
} from "../test-support/boundary-census";

const repo = join(import.meta.dir, "..", "..");
const NUMBER_SANCTIONS: Readonly<Record<string, string>> = {
  "cratedeck/src/bench.ts::biggestFiles::Number(st.size)":
    "Bun stat size is trusted filesystem metadata and practical drive sizes are safe integers.",
  "cratedeck/web/products/fulltags/megaset-builder.ts::minutesFrom::Number(input)":
    "clampMinutes finite-checks the converted form value and supplies the default.",
  "cratedeck/web/ui/JobsDock.tsx::phaseLabel::Number(m[1])":
    "m[1] is a digits-only phase regex capture and array lookup has an explicit fallback.",
  // #230 (Sep 17): writer.ts applyTags's year parse was UPGRADED from a
  // sanctioned raw Number() to an isFinite-gated site — the sanction is
  // gone (sanctioned 16→15, guarded 25→26), see the counts trail below.
  "src/fulltags/write/writer-mutagen.ts::mp4Statement::Number(v)":
    "the bpm branch receives a typed internal TagPatch number before serialization.",
  "src/fulltags/write/writer-mutagen.ts::mp4VerifyStatement::Number(v)":
    "the verifier receives the same typed internal TagPatch BPM number before serialization.",
  // #90 scope 1: parseMoodStamp re-homed pipeline.ts → pipeline-stamps.ts
  // (owner+path moved; the sanction follows the site).
  "src/fulltags/pipeline/pipeline-stamps.ts::parseMoodStamp::Number(m[2])":
    "m[2] is a digits-and-decimal-only regex capture and need() finite-checks every consumed value.",
  "src/fulltags/years.ts::parseScPageDates::Number(year)":
    "year is a four-digit regex capture.",
  "src/fulltags/years.ts::ytdlpYearsBatch::Number(uploadDate.slice(0, 4))":
    "the enclosing branch first validates uploadDate as exactly eight digits.",
  "src/getdat/commands/intake-folder.ts::dumpDateFromNameParts::Number(m[1])":
    "m[1] is a digits-only date regex capture.",
  "src/fulltags/genre/genre-refold.ts::refoldDetail::Number(i)":
    "i is a digits-only capture from the SENTINEL(\\d+)SENTINEL restore regex, and stash lookups use the same captured index.",
  // #184: the second front door (tools/fetch-all.ts import.meta.main argv
  // parse, with its Number(argv[jobsArg+1]) site) was deleted — `megadj
  // fetch` is the only entry and its --jobs rides nonNegOpt.
  "src/fulltags/sources/bandcamp.ts::parseIsoDuration::Number(d)":
    "d is a digits-only ISO-8601 duration capture (P…D group), truthiness-gated before use.",
  "src/fulltags/sources/bandcamp.ts::parseIsoDuration::Number(h)":
    "h is a digits-only ISO-8601 duration capture (T…H group), truthiness-gated before use.",
  "src/fulltags/sources/bandcamp.ts::parseIsoDuration::Number(min)":
    "min is a digits-only ISO-8601 duration capture (T…M group), truthiness-gated before use.",
  "src/fulltags/sources/bandcamp.ts::parseIsoDuration::Number(s)":
    "s is a digits-or-decimal ISO-8601 duration capture (T…S group), truthiness-gated before use.",
  "src/fulltags/fetch/fetch-stages.ts::stageBandcamp::Number(page.datePublished.slice(0, 4))":
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
    // Sep 17 (CLI numeric hardening, second pass): ingest's LAST
    // hand-rolled numeric seam (`--min-duration`) rides nonNegOpt now —
    // the stale Number(minDurationRaw) sanction is gone (sanctioned
    // 17→16) and tools/ast-ccn.ts's argv tail parses digits-only under
    // a census-visible Number.isFinite gate (its 2 raw Number() sites
    // became 1 guarded site: audited unchanged at 41, guarded 24→25).
    // Sep 17 (#230): writer.ts applyTags's year parse upgraded from a
    // sanctioned raw Number() to an explicit isFinite+range gate, now
    // extracted as writer.ts::yearFromDate — the site reclassifies
    // sanctioned→guarded (audited 41 unchanged, guarded 25→26,
    // sanctioned 16→15) and the owner move shifts the digest.
    // Sep 17 (#215 live-run pass): audited 41→42 / guarded 26→27 —
    // /fetch/feed's since cursor parses under an explicit
    // Number.isFinite(since) gate (the census guard shape; bad input
    // degrades to a full drain at 0, never a crash) — digest shifted.
    // Sep 15 (#79/#80/#84 pass): rb-import payload probing moved to the
    // fulltags media seam (removed its 2 Number() sites); audited 42→44
    // and sanctioned 13→18 from the concurrent bandcamp ISO-duration +
    // fetch-stages stageBandcamp year work landing in the same worktree.
    // Sep 16 (#181): beatport parseTrack decomposed — the publish-date
    // Number() site moved owner parseTrack→parseYear (still guarded by
    // Number.isInteger; counts unchanged, digest shifted).
    // Sep 17 (#193): digest changed — the fulltags package folded into
    // src/fulltags (digest input re-rooted; same calls, same guards,
    // counts unchanged).
    // Sep 16 (#184): fetch pipeline re-homed into fulltags; the second
    // front door's argv Number() site died with the shim (audited 44→43,
    // sanctioned 18→17) and fetch-stages moved owner+path (digest shift).
    // Sep 16 (#90 scope 1): parseMoodStamp/mp4Statement/mp4VerifyStatement
    // re-homed (pipeline.ts→pipeline-stamps.ts, writer.ts→writer-
    // mutagen.ts) — sanctions re-keyed to the new owner paths, counts
    // unchanged, digest shifted.
    // Sep 16 (CCN diet): verify-key's ts→year Number() moved owner
    // (verify-key.ts→scYear in art-sources.ts) and loadExternalRefs
    // re-homed the refs-parse helpers — same guarded sites, new
    // enclosing-function paths, counts unchanged, digest shifted.
    // Sep 16 (#42): detect.ts's USB-tree family moved to detect-usb.ts
    // (its guarded Number() sites re-homed) — counts unchanged, digest
    // shifted.
    // Sep 16 (#184): fetch pipeline re-homed into fulltags; the second
    // front door's argv Number() site died with the shim (audited 44→43,
    // sanctioned 18→17) and fetch-stages moved owner+path (digest shift).
    // Sep 17 (CLI numeric hardening): numOpt retirement removed the two
    // cli-flags/maintenance guarded sites (digest shift + counts above).
    // Sep 17 (second pass): ast-ccn argv tail hardening + minDurationRaw
    // sanction removal (digest shift; counts in the block above).
    // Sep 17 (#220 fetch/ slice): fetch cluster re-homed from fulltags
    // root to src/fulltags/fetch/ — the stageBandcamp sanction re-keyed,
    // same call, same guard; counts unchanged, digest shifted.
    // Sep 17 (#220 genre/ slice): genre-refold sanction re-keyed to
    // src/fulltags/genre/genre-refold.ts (same call, same guard, counts
    // unchanged) — digest shifted.
    // Sep 17 (#220 sources/ slice): bandcamp ISO-duration sanctions
    // re-keyed to src/fulltags/sources/bandcamp.ts (same calls, same
    // guards, counts unchanged) — digest shifted.
    // Sep 17 (#215 live-run pass): /fetch/feed's since cursor parses under an explicit
    // Number.isFinite(since) gate (the census guard shape; bad input
    // degrades to a full drain at 0, never a crash) — digest shifted.
    // Digest pinned to the shared-worktree scan including the concurrent
    // fetch-feed work (the #79/#80 precedent): b8a3d783.
    // Sep 18 (#220 analysis|write|pipeline slices): file re-homes moved owners
    // (digest input re-rooted; same calls, same guards, counts unchanged).
    // Sep 18 (#247): doctor's new deckServiceStatus parses the launchctl
    // `pid = (\d+)` capture under an explicit Number.isFinite gate (the
    // census guard shape; a non-numeric pid degrades to null, never a
    // crash) — audited 42→43, guarded 27→27+1=28, sanctioned unchanged —
    // digest shifted: c2d930f2.
    // Sep 18 (#243): the four root cli-commands-*.ts folded into their
    // domains ({getdat,shelf,fulltags}/cli-commands.ts) — owners
    // re-rooted, same calls, same guards, counts unchanged, digest
    // shifted: 65df7222.
    // Sep 19 (#240 kebab rename): cratedeck/src + shared module files
    // re-spelled kebab-case — owners re-rooted again, same calls, same
    // guards, counts unchanged, digest shifted: 5ab35a72.
    // Sep 19 (#239 MegaSet split): the custom-minutes conversion moved
    // from MegasetPanel to minutesFrom in megaset-builder; clampMinutes
    // remains the finite gate, so counts are unchanged and only the
    // reason-carrying sanction owner/digest moved: bee18045.
    audited: 43,
    guarded: 28,
    sanctioned: 15,
    digest: "fa1e6ad6ffcd581dc1f7c3eff9aaa4d4de893bd9179f0d795efbc9a094a47fb2",
    // Sep 19 (super-sure pass, #214 rename tail): the archive/deckctl
    // module regroup re-rooted owners after the MegaSet pin — same calls,
    // same guards, counts unchanged, digest shifted: fa1e6ad6.
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
