# Codebase Quality Report — megadj

Date: 2026-09-10 · HEAD: `f69f8c0` (polish: typed globalFilter read, vite emptyOutDir, knip format)
Scope: `src/`, `cratedeck/`, `fulltags/`, `tools/` (first-party TS/TSX; `node_modules` excluded)
Tools: lizard 1.24.0 · jscpd 4.3.0 · knip 6.34.0 · oxlint 1.81.0 · type-coverage 2.30.1 · bun audit 1.3.14

> **Update (Sep 10, 16:30).** The gate failures below were resolved the same
> hour: the concurrent agent's WIP landed (fixing `exports.ts` drift,
> `ingest-probe.ts`, and most test churn), and the remaining defects were fixed
> directly — 4 implicit-any spots typed (IntakeTab, BoothSettings, two test
> console.log shims) + the `deck_booth` double-cast removed → type-coverage
> back at **100%**; the surface-parity census assertion made
> whitespace-tolerant (formatter table-padding no longer reads as drift; the
> count stays exact/derived); `preflight.ts` `BUILDER_ID` made
> index-total (`as const satisfies Record<string, CheckId>`) for the new
> strict tsconfig; prettier applied to all stragglers. **Final: `bun run
> check:full` green — 685 pass / 0 fail, 100.00% type coverage.** §1 below is
> preserved as the point-in-time snapshot.

> **Caveat — concurrent-agent WIP.** Several agents are working this repo right now
> (`fulltags/src/exports.ts`, `src/cli.ts`, `src/usage.ts`, `cratedeck/web/products/getdat/IntakeTab.tsx`,
> and new files `src/commands/ingest-probe.ts` / `src/commands/ingest-selfmatch.test.ts` are mid-edit).
> The typecheck, format, and test failures below trace to those in-flight files, not to landed code.
> Re-run the gate once the WIP settles before treating any gate result as final.

## 1. Static analysis suite

| Gate | Result | Detail |
|---|---|---|
| `tsc --noEmit` | ❌ fail | 2 errors: `fulltags/src/exports.ts` exports drift (`validatePatch`), `src/commands/ingest-probe.ts` missing import (`qualityScore`) — both in concurrent-agent WIP |
| `oxlint --deny-warnings` | ✅ pass | zero findings across all workspaces |
| `prettier --check` | ❌ fail | 1 file misformatted: `src/commands/ingest-selfmatch.test.ts` (untracked WIP) |
| `type-coverage --threshold 100` | ⚠️ 99.98% | 80719/80729 typed; all 10 untyped spots in `IntakeTab.tsx` (WIP). Repo floor is 100% |
| `bun test --parallel=16` | ❌ 33 fail / 591 pass | 627 tests, 85 files. Failures cluster in CLI-contract suites (`json-summary`, `numeric-options`, help contract), e2e server boot (`:7823`), drop pipeline — consistent with in-flight `src/cli.ts`/`src/usage.ts` churn |
| `bunx knip` | ✅ ran clean | 8 unused files, 22 unused exports, 4 unused types (§4) |
| `bun audit` | ✅ pass | **No vulnerabilities found** |

## 2. Complexity (lizard)

First-party code: **2,447 functions, 35,627 NLOC, avg CCN 2.2** — healthy (target ≤ 3.0).
38 functions at CCN ≥ 15, 26 at ≥ 20, **2 at ≥ 50 (P0)**.

| CCN | Function | Location |
|---|---|---|
| 75 | `canon` | `cratedeck/src/db.ts:110-481` |
| 66 | `processTask` | `tools/fetch_all.ts:115-275` |
| 48 | `indexShelf` | `src/commands/shelf-archive.ts:266-429` |
| 44 | `spaceCheck` | `cratedeck/src/preflight.ts:53-230` |
| 38 | `boothFix` | `src/commands/booth-fix.ts:213-349` |
| 33 | `main` | `src/cli.ts:121-269` |
| 32 | `playerCompat` | `fulltags/src/player-compat.ts:97-178` |
| 31 | `shelfDedupe` | `src/commands/shelf-dedupe.ts:182-391` |
| 31 | `mbLookupCached` | `fulltags/src/pipeline.ts:370-440` |
| 29 | `shelfDupescan` | `src/commands/shelf-dupescan.ts:143-316` |
| 29 | `driveBadges` | `cratedeck/shared/badges.ts:51-144` |
| 29 | `dedupeArchive` | `src/commands/dedupe-archive.ts:97-252` |
| 29 | `copyIntoArchive` | `src/commands/ingest.ts:386-538` |
| 27 | `rbFixPaths` | `src/commands/rb_fix_paths.ts:248-351` |

P0 refactors: `canon` (db.ts) and `processTask` (tools/fetch_all.ts). Note `canon` is a hot
wire-shape normalizer — split carefully against the leaf-import rules in AGENTS.md.

## 3. Duplicate code (jscpd, min-tokens 50)

**48 clones · 662 duplicated lines · 1.11%** — healthy (≤ 2% = healthy for TS).

Top clones by lines:

| Lines | First | Second |
|---|---|---|
| 85 | `cratedeck/web/products/cratedeck/ArchiveTab.tsx:249` | `cratedeck/web/products/fulltags/FullTagsPage.tsx:223` |
| 43 | `cratedeck/web/styles/shell.css:59` | `shell.css:18` (self-file) |
| 33 | `cratedeck/src/jobs.ts:881` | `cratedeck/src/verify_job.ts:8` |
| 30 | `src/commands/booth-fix.ts:142` | `fulltags/src/booth-text.ts:103` |
| 27 | `cratedeck/src/intake_job.ts:133` | `cratedeck/src/jobs.ts:674` |
| 21 | `fulltags/src/fleet.ts:165` | `fleet.ts:122` (self-file) |
| 20 | `cratedeck/web/products/getdat/GetDatPage.tsx:344` | `GetDatPage.tsx:101` (self-file) |
| 20 | `cratedeck/src/jobs.ts:534` | `cratedeck/src/verify_job.ts:105` |
| 18 | `src/cli.ts:306` | `src/commands/shelf_cmds.ts:41` |
| 17 | `src/hygiene/store.ts:233` | `cratedeck/src/hygiene_reader.ts:72` |

Note the overlap with §4: `verify_job.ts`, `intake_job.ts`, and `shelf_cmds.ts` are all knip-flagged
unused files **and** jscpd clone partners — a dead-code purge would remove several clones at once.

## 4. Dead code (knip)

**Unused files (8):** `cratedeck/src/deckctl_hygiene.ts`, `cratedeck/src/drive_list.ts`,
`cratedeck/src/hygiene_jobs.ts`, `cratedeck/src/intake_job.ts`, `cratedeck/src/verify_job.ts`,
`cratedeck/web/products/cratedeck/HygieneTab.tsx`, `fulltags/verify-key.ts`,
`src/commands/shelf_cmds.ts`.

**Unused exports: 22** (mostly fulltags: `AI_MODEL`, `tempoFromBeatGrid`, `UA`, `words`,
`TEXT_FIELDS`, `isDisplayOnly`, `enrichAll`/`enrichTrack`/`listAudio` re-exports,
`mbGenresForArtists`, `decodedTmpName`, `runMutagen`, `listAudio`, `FLEET_SAMPLE_RATES`,
`HIRES_SAMPLE_RATES`, `isLosslessExt`, `LOSSLESS`, `validateTagValues`, `COMPLETENESS_FIELDS`,
`isLossless`, `writePatchWav`, `writePatchMp4`). **Unused exported types: 4** (`HygienePayload`,
`TextField`, `Citation`, `MbGenreResult`).

Cautions before deleting anything:

- The concurrent agent is actively wiring hygiene surfaces (`hygiene_reader.ts` modified,
  `archive_ledger_reader.ts` new) — `deckctl_hygiene.ts` / `hygiene_jobs.ts` / `HygieneTab.tsx`
  may be mid-wire. Verify zero imports at a quiet moment.
- `COMPLETENESS_FIELDS` is named in AGENTS.md as the audit-gate SSOT — "unused export" here
  means "no external importer"; prefer un-exporting over deleting.
- knip's 3 configuration hints (remove `fpcbt`/`python` from `ignoreBinaries`, redundant `cli.ts`
  entry) are documented **load-bearing** — do not "fix" the config (AGENTS.md: knip hints lie).

## 5. Security advisories

`bun audit`: **no vulnerabilities found** (root + workspaces).

## 6. Structural metrics

| Metric | Count | Note |
|---|---|---|
| TODO / FIXME / HACK | 0 | non-test, first-party |
| `as any` casts | 0 | consistent with the 100% type-coverage policy |
| `@ts-ignore` / `@ts-expect-error` | 0 | — |
| bare `catch {}` | 0 | the only regex hit is a comment in `deckctl_players.ts` |
| `lint-disable` comments | 2 | both `no-control-regex` (control-char detection — the rule's legit use case) |
| `console.log` (non-test) | 247 | src 166 · cratedeck/src 54 · tools 22 · fulltags 2 · web 0 — expected for a CLI; `--json` mode suppresses human logs per the agent-first contract |

## 7. Size

| Area | Files | Lines |
|---|---|---|
| `src/` | 89 | 15,063 |
| `cratedeck/` | 134 | 32,043 |
| `fulltags/` | 44 | 6,914 |
| `tools/` | 4 | 912 |
| **Total** | **271** | **54,932** |

## Summary

**⚠️ Needs attention** — the code's static health is genuinely good (1.11% duplication, avg CCN 2.2,
zero `as any`/TODO/bare-catch, no vulns), but the working tree does not currently pass the gate:
typecheck, format, and 33 tests are red on the concurrent agent's in-flight files. After the WIP
lands, the actionable backlog is small: two P0 complexity refactors (`canon` 75, `processTask` 66),
8 knip-flagged files to verify-then-remove (which also kills several top clones), and the
ArchiveTab/FullTagsPage 85-line clone to extract into a shared component.
