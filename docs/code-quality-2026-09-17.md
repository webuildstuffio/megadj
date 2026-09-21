# Code quality progress report — Sep 20, 2026

**Status:** ✅ CURRENT — measured update at main `0d2575f9`, 2026-09-20 ~21:00
ET. Supersedes the [Sep 17 report](code-quality-2026-09-17.md) (kept below as
history-adjacent context — it is a dated snapshot, per the docs rule). Live
counts always come from the tools named in the appendix, never this file.

## TL;DR

The three days since the Sep 17 report were the heaviest of the campaign:
**~508 commits landed Sep 13–20 (163 since Sep 17)**, roughly **240 issues
closed in the window** (GitHub `closedAt` count; the backlog went 41 open →
**8 open**), and every gate is at or better than its Sep 17 best: suite
**2,009 pass / 3 skip / 0 fail** (was 1,766), type coverage **100.00%**
(177,646/177,646 expressions), jscpd duplication **0.77%** (was 0.9%),
production clones **22** of which only **12 are cross-file** (was 14/na),
max real CCN **56** unchanged (ceiling still 60, now enforced by two
ratchets), knip/oxlint/audit/prettier all 0. The reorg program is
**functionally complete**: of the 7 "remaining refactor issues" in the Sep 17
table, **6 closed** (#220 #221 #222 #223 #225 #235) and only #214
(cratedeck/src flat pack) remains. The census grew to **131,285** tracked
ts/tsx/py LOC (125,297 TS across 729 files + 5,982 strict Python) against
the 75k target — the honest Sep 17 verdict stands and sharpens: refactors
are done; only the deletion lever or feature triage moves the number now.

## Measured state (`0d2575f9`, Sep 20 ~21:00 ET)

| Metric | Sep 17 (`4f8dd24`) | **Sep 20 (`0d2575f9`)** | Tool |
| --- | --- | --- | --- |
| Tracked ts/tsx/py census | ~114.5k | **131,285** (131k TS/TSX + 6k Py) — grew with shipped features + moved-in tests | `git ls-files` + `wc` |
| — TS/TSX total | 112,329 (673 files) | **125,297 (729 files)** | `wc` |
| — test mass | 36,896 (48.9% of prod) | **41,620** (46% of total) | `.test.` files |
| Suite | 1,766 pass / 0 fail | **2,009 pass / 3 skip / 0 fail** (260 files, 7,823 assertions) | `bun run check:full` |
| Type coverage | 100% | **100.00% (177,646 / 177,646)** | `bun run typecov` |
| Max real CCN | 56 (ceiling 60) | **56** — DataTable 56, RailCard 53, makeDriveRoutes 51, makeFleetRoutes 49, DrivePage 49 (ceiling 60, ratchet-only-down) | `bun tools/ast-ccn.ts` |
| Duplication | 107 clones / 1,157 L / 0.9% | **109 clones / 1,096 L / 0.77%** — prod 22 clones (12 cross-file, ~150 L); test-internal **0 clones at ≥100 tokens**, pinned by a new census | `bunx jscpd --min-tokens 50` |
| Gates | typecov/knip/oxlint/audit 0 | **all 0** + `check:full` green end-to-end (tsc cold + ruff + mypy strict + web build + repo:hygiene + py tests) | `bun run check:full` |
| Open issues | 41 (p0:2 · p1:9) | **8 open** — p0: **0 open** (#147 write-path spike is the only p0-class item left, now parked on hardware access) · p1: 2 (#250 LL pile, #37 hygiene detectors) · rest p2/p3 | `gh issue list` |
| Census tripwires | ~21 | **29 census test files** in `src/census/` — every new invariant landed WITH its enforcement test | `ls src/census` |
| tmp fixture leaks | ~25,892 dirs / 12.5 GB (Sep 18) | **3 dirs, ~100 MB** on this box right now — `megadj tmp-purge` (#236) landed and is doing its job | `ls /tmp/megadj-*` |

## What landed Sep 17 → Sep 20 (the highlights, receipts in `git log`)

**The reorg program finished** (6 of 7 closed):
- **#220** fulltags flat pack → domain subfolders (`write/ fetch/ genre/
  analysis/ booth/ sources/ pipeline/ regate/`); **#243/#244** src/ root diet
  (command bodies moved into domain dirs; 21 census tripwires into
  `src/census/`); **#246** test-placement rule landed + census-pinned with an
  allowlist ratchet; **#248** fixture hygiene census (raw `mkdtempSync` fails
  the suite).
- **#222/#225** the src↔cratedeck seam got its one-direction rule, census-
  pinned by `boundary-direction-census` with an allowlist that must shrink to
  empty (#225A retires rows).
- **#223** the test-clone ratchet: **0 test-internal clones at ≥100 tokens**
  (jscpd census gate, ceiling may only move down) — the Sep 17 projection of
  "test clones → ~0" is now measured DONE.
- **#271/#272/#273** tooling hygiene: cratedeck tsconfig became an extends
  shim (cache-poisoning footgun closed), plain `eqeqeq` enforced (20 fixes),
  `erasableSyntaxOnly` ON (TS7-ready, 0 violations), oxlint 1.83.0 after the
  age floor, nested bunfig copies deleted/documented as tripwires.

**Correctness catches (the gates finding real bugs):**
- **#280** `writePatchSync` failed on MP3s whose attached-pic decodes as a
  corrupt PNG — mutagen fallback now tried (perf-parity bound re-proven,
  best-of-6 vs the 200 ms ceiling).
- **#279** `mood --embeddings` re-analyzed every unstamped file (a measured
  3,113-file storm) — the DB short-circuit is honored in embeddings mode.
- **#278** `mood` CLI wedged silently on library-scale queues — output
  discipline fixed.
- **#281** the empty-env trap: `MEGADJ_MUSIC_DIR="$SHELF"` with `$SHELF`
  unset downloaded into the repo root — `nonEmptyEnv` is now the only legal
  `MEGADJ_*` path read, census-pinned.
- **#263** ANLZ set-grid symlinks bypassed mount containment; **#260** launchd
  plist rendering corrupted XML-metachar paths; **#265/#270** tmp-purge
  fail-closed for unknown lsof state.
- **#255–#259** SoundCloud became a first-class download source (link-first,
  format ladder, gone-classification, LOWQ floor) with the docs leg — and
  **#275/#277/#276/#267** were the follow-up bugs the census tests caught
  inside days (uploader-as-artist, discarded set-rip stderr, write-only miss
  counts, mixed YT+SC probe misrouting).

**Engine/seam hardening:** the guarded-JSON, boundary-number, exit-code,
naming-convention, and git-identity censuses all extended their reach; the
harness-entry census pins every CLI entry; `#215`-class wire contracts stay
pinned (fetch-events census).

## Remaining work (the honest 8)

| # | Item | Class |
| --- | --- | --- |
| #147 | RUN the rekordbox write-path spike (p0; hardware-gated) | ops |
| #250 | settle the 1,087 frozen liked-videos rows | product |
| #214 | cratedeck/src 107-file flat pack → prefix-domain folders | last reorg move |
| #107 | MegaSet scoring depth (B6/B8/landmarks/N-candidates/quality) — see the new [v3 generator proposal](megaset/12-playlist-generator-v3.md), which absorbs it | feature |
| #274 | TS7 readiness evaluation (age floor met) | tooling |
| #118 / #150 / #37 | CrateDeck scheduled sync job / legacy-export runbook / shelf-hygiene detectors round 2 | feature |

The 12 production cross-file clones (jscpd ≥50 tokens) are the next
duplication meal — largest: `rb-playlist-apply`/`rb-playlist` 30 L,
`rb-adopt-apply` internal 16–17 L, `storage`/`tmp-purge` 15 L, two
`GenreWhyTab`/`SimilarTab` pairs (14+21 L). All small; all the same
extract-the-shared-helper shape the #223 program used for tests.

## Projection

With #214 the structure story is 100% closed (flat packs: 0, one product
root per tree, seam pinned, clone-gated). The CCN ratchet drops to ~51 as
soon as one web-component batch lands (DataTable/RailCard/DrivePage are
JSX-nesting, not logic — the phantom-hotspot AGENTS rule applies). Census
75k remains a **product decision**, not a refactor outcome: 8 open issues ≈
feature LOC; the merge proposal
([fulltags-getdat-merge-2026-09-20](fulltags/fulltags-getdat-merge-2026-09-20.md))
is the one pending structural deletion play (≈ −430 LOC + one import cycle
killed).

## Appendix — measurement commands (live numbers come from these)

- Suite + hard gates: `bun run check:full` (tsc cold, knip, oxlint, prettier,
  full `bun test --parallel=16`, typecov, ruff+mypy strict, py tests, web
  build, repo:hygiene).
- Type coverage: `bun run typecov` → `(177646 / 177646) 100.00%` at HEAD.
- CCN: `bun tools/ast-ccn.ts --list <files.txt> 999` (the census-parity
  measurer; lizard is not comparable).
- Duplication: `bunx jscpd --min-tokens 50 --reporters json --output
  /tmp/jscpd-out src cratedeck` → 109 clones / 0.77% / prod-cross-file 12.
- Census: `git ls-files '*.ts' '*.tsx' '*.py' | xargs wc -l`.
- Issues: `gh issue list --state open` (8) and `closedAt > 2026-09-13` (240).
- tmp: `ls -d /tmp/megadj-* | wc -l` → 3.

---

# Previous snapshot — Sep 17, 2026 (kept for trend continuity)

**Status:** ✅ COMPLETE — measured snapshot at main tip `4f8dd24`, 2026-09-17
~22:45 ET. Dated snapshot; live counts always come from the tools named
below, never this file. Companion visualization:
[megadj-quality-trend canvas](../../../../../../.cursor/projects/Users-nick-github-megadj/canvases/megadj-quality-trend.canvas.tsx)
(21 checkpoints, 8/24 → 9/17).

The Sep 15–17 quality push closed **60 issues in 3 days** (21 + 35 + 4) and
moved every static-quality gate to its best measured value: max real CCN fell
**152 → 56** (pinned by the #198 ratchet at 60), duplication fell to **0.9%
combined (production mass was 182 LOC across 14 clones)**, type
coverage/knip/oxlint/audit all read 0, and the suite grew to **1,766 tests /
0 fail**. The reorg sequence (#224) was 7 of 12 items; both monolith batches
(#232 rekordbox, #233 web tabs) landed that night. What remained was one
structural batch — the 7 open refactor issues — of which 6 are now closed
(see the Sep 20 tables above).

Sep 17 measured state (verbatim from the snapshot, for the trend line):
census ~114,534 vs the 75k target; TS/TSX 112,329 across 673 files (prod
75,433 / test 36,896 = 48.9%); Python 5,982 LOC all strict; max CCN 56;
duplication 107 clones / 1,157 L / 0.9% (93 test-internal); tests 1,766/0;
open issues 41 (p0 2, p1 9); commit velocity 121/109/64 across Sep
15/16/17. The "remaining 7" table, the per-issue projections, and the
75k-cannot-be-refactored verdict were all recorded there — the Sep 20
sections above are their scorecard.
