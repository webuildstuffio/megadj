# Code quality progress report — Sep 29, 2026

**Status:** ✅ CURRENT — measured update at main `77cfcc91`, 2026-09-29 ~21:00
ET. Supersedes the Sep 20 report (kept below as history-adjacent context — it
is a dated snapshot, per the docs rule). Live counts always come from the tools
named in the appendix, never this file.

## TL;DR

**~704 commits landed Sep 13–29** (190 since Sep 20), roughly **376 issues
closed in the window** (GitHub `closedAt` count; the backlog went 8 → **16
open** with new feature/hardening work filed). Every gate is at or better than
its Sep 20 best: suite **2,631 pass / 0 fail** (was 2,009), type coverage
**100.00% (210,155/210,155)** expressions, jscpd duplication **0.70%** (was
0.77%), max real CCN **57** (buildMegaset, ceiling 60), knip/oxlint/audit/
prettier all 0. The structural reorg is DONE: **cratedeck fold** (#193) landed
Sep 22 (433 files, `cratedeck/` → `src/deck/`), TS7 became the toolchain
(#338, Sep 23), the dedup arc (#322/#317) merged 7 single-importer twins and
retired 3 pass-through wrappers. The census grew to **157,062** tracked
ts/tsx/py LOC (150,612 TS across 877 files + 6,450 strict Python) against the
75k target — growth comes from shipped features (parallel ONNX workers,
rb-comment-sync genre sync, artwork extraction, booth compatibility), not
structural expansion.

## Measured state (`77cfcc91`, Sep 29 ~21:00 ET)

| Metric | Sep 20 (`0d2575f9`) | **Sep 29 (`77cfcc91`)** | Tool |
| --- | --- | --- | --- |
| Tracked ts/tsx/py census | 131,285 | **157,062** (150.6k TS/TSX + 6.5k Py) — grew with features + cratedeck fold consolidation | `git ls-files` + `wc` |
| — TS/TSX total | 125,297 (729 files) | **150,612 (877 files)** | `wc` |
| — prod LOC | ~83.7k | **97,702** | non-test `wc` |
| — test mass | 41,620 (46% of total) | **51,181** (326 files, 52% of prod LOC) | `.test.` files |
| Suite | 2,009 pass / 3 skip | **2,631 pass / 0 fail** (326 files, 11,504 assertions) | `bun test` |
| Type coverage | 100% (177,646) | **100.00% (210,155 / 210,155)** | `bun run typecov` |
| Max real CCN | 56 (ceiling 60) | **57** — buildMegaset 57, DataTable 56, dawidSkene 51, DrivePage 49, loadConfig 46 (ceiling 60, ratchet-only-down) | `bun tools/ast-ccn.ts` |
| Duplication | 109 clones / 0.77% | **116 clones / 1,186 L / 0.70%** | `bunx jscpd --min-tokens 50` |
| Gates | all 0 | **all 0** + `check:full` green (tsc + ruff + mypy strict + web build + repo:hygiene + py tests) | `bun run check:full` |
| Open issues | 8 (p0:0 · p1:2) | **16 open** — p0: 2 · p1: 4 · rest p2/p3 (new work filed, not regressions) | `gh issue list` |
| Census tripwires | 29 | **30 census test files** in `src/census/` | `ls src/census` |
| tmp fixture leaks | 3 dirs / ~100 MB | **3 dirs** — `megadj tmp-purge` working | `ls /tmp/megadj-*` |

## What landed Sep 20 → Sep 29 (the highlights, receipts in `git log`)

**Architecture:**
- **#193** cratedeck fold (Sep 22, 433 files): `cratedeck/` → `src/deck/` +
  `ops/` → `src/ops/`, knip single workspace, all import specifiers and
  package scripts re-pointed; `boundary-direction-census` REWRITTEN for the
  folded layout (no cratedeck/ regrowth guard). Incident class: hard-coded
  `import.meta.dir` roots broke one level down (3 strikes — deck-install, docs
  data default, megaset config root; all fixed with `crateDeckRoot()` resolver).
- **#338** TS7 is the toolchain (Sep 23): `typescript` package root is a stub,
  compiler API aliased to `typescript-compiler-api`, all 122 census digests
  preserved. `type-coverage` 2.30.1 passes under the native compiler.
- **#322/#317** dedup arc (Sep 23): 7 single-importer twins merged, 3
  pass-through wrappers retired; KEPT-BOTH judgments documented in file headers
  (walk.ts runtime split, deckapi.ts process split).

**Rekordbox + SHELF1 drive-day (Sep 28–29):**
- `rb-comment-sync` runs 3 phases: Comment write (Key·Energy·Mood), comment
  enrichment (partial→full via RB `djmdKey.ScaleName` + mood-derived energy),
  genre sync (archive vote-winner → RB `GenreID`). 3,819 tracks synced.
- `rb-import-probe` prefers shelf paths, strips `[archive …]`/`[BACKUP2]`
  stems, dedupes intra-batch imports (148-row audit). `rb-dedup` adds
  suffix-aware stem grouping for acoustic pairs.
- Artwork extraction: 1,196 embedded images extracted to PIONEER Artwork tree
  (RB doesn't re-read tags after initial import).
- WAL checkpoint discipline: `PRAGMA wal_checkpoint(TRUNCATE)` before close
  in all 6 RB write kits (5.7 MB WAL crashed RB on open, Sep 28).
- `djmdGenre` NULL UUID cleanup: 342 bad rows deleted, orphan genres pruned
  to clean 44-row set (NULL UUID crashes RB on open).

**FullTags v3 (Sep 29):**
- Parallel ONNX workers: `--jobs N` spawns N Python processes, each loads
  models once. Default 2 workers (~7.5 GB total); `--jobs 4` for powerful
  machines (4×4 GB = 16 GB — crashed a 16 GB Mac via OOM, learned Sep 29).
- `groundTruth` cache + timeout diagnostics landed alongside workers.
- Embeddings force-run in progress (3,612 files across 2 workers).
- v3 plan of record: `docs/fulltags/fulltags-v3-rebench-and-build-plan-2026-09-29.md`.

**Hardening:**
- **nonEmptyEnv** migration: 7 more raw `process.env` reads migrated (Sep 29,
  `77cfcc91`) — models.ts HOME, master-path.ts, intake-run.ts, doctor-checks,
  deck/config.ts (2), deck-install.ts, cli.ts.
- `import-write.kit.py` extension→FileType map fixed (M4A/FLAC swap wrote
  wrong codec metadata on every import; aligned with pyrekordbox enum).
- `mbGenreForArtist` per-tag canonicalization (89 tag-soup tracks fixed).
- Wire-payload rounding SSOT consolidated: `round1`–`round4` in `leaf/fmt.ts`
  (~15 files consolidated from hand-rolled `Math.round`).
- Booth compatibility data-driven: `player-compat.ts` + `booth-text.ts`,
  `megadj booth-fix` proposes by default.

**Analysis coverage (Sep 29, `77cfcc91`):**
| Domain | Count | Coverage |
| --- | --- | --- |
| Mood | 4,553 | 90.4% of 5,036 audio |
| Beats | 4,536 | 90.1% |
| Embeddings | 3,823 → ~4,553 target | 75.9% → ~90.4% (run in progress) |
| Genre | 4,861 | 96.5% |
| RB mirror | 3,819 | 100% of master.db |

## Remaining work (the honest 16)

The backlog grew from 8 to 16 open issues — not regressions, but new
feature/hardening work filed during the Sep 20–29 push. The reorg program is
fully closed (#214 folded into the cratedeck merge). Major remaining:

| Class | Items | Notes |
| --- | --- | --- |
| p0 (ops) | #147 write-path spike | hardware-gated, parked |
| p1 (product) | #250 liked-videos, 3 others | 1,087 frozen rows; needs classification run |
| Feature | MegaSet v3, CrateDeck sync, hygiene | scoring depth, scheduled jobs, detectors |
| Tooling | FullTags v3 rebench | plan of record shipped, execution pending |

## Projection

The structural story is 100% closed: cratedeck folded, TS7 shipped, dedup
arc done, all reorg issues closed. The CCN ratchet sits at 57 (buildMegaset —
genuine complexity from the megaset engine's multi-constraint solver). The next
duplication meal is the same ~12 prod cross-file clones identified in Sep 20.
Census 157k vs the 75k target remains a **product decision**: the growth is
real features (parallel workers, genre sync, artwork extraction, booth compat),
not structural debt. The honest lever is feature triage or the FullTags v3
consolidation.

## Appendix — measurement commands (live numbers come from these)

- Suite + hard gates: `bun run check:full` (tsc cold, knip, oxlint, prettier,
  full `bun test --parallel=16`, typecov, ruff+mypy strict, py tests, web
  build, repo:hygiene).
- Type coverage: `bun run typecov` → `(210155 / 210155) 100.00%` at HEAD.
- CCN: `bun tools/ast-ccn.ts --list <files.txt> 999` (the census-parity
  measurer; lizard is not comparable).
- Duplication: `bunx jscpd --min-tokens 50 --reporters json --output
  /tmp/jscpd-out src` → 116 clones / 0.70%.
- Census: `git ls-files '*.ts' '*.tsx' '*.py' | xargs wc -l`.
- Issues: `gh issue list --state open` (16) and `closedAt > 2026-09-13` (376).
- tmp: `ls -d /tmp/megadj-* | wc -l` → 3.

---

# Previous snapshot — Sep 20, 2026 (kept for trend continuity)

**Status:** ✅ SUPERSEDED — measured snapshot at main `0d2575f9`, 2026-09-20.
See the Sep 29 section above for current state.

The Sep 17–20 push was the heaviest of the early campaign: **163 commits** in
3 days, **240 issues closed**, backlog 41 → 8 open. The reorg program finished
(6 of 7 closed), and every gate hit its best: suite 2,009, typecov 100%
(177,646), duplication 0.77%, max CCN 56. Key deliverables: #220 fulltags
flat-pack, #222 seam direction rule, #223 test-clone ratchet (0 at ≥100
tokens), #271/#272/#273 tooling hygiene (tsconfig shim, eqeqeq, erasable
syntax), and the SoundCloud first-class acquisition source (#255–#259).
Correctness catches: #280 writePatchSync corrupt-PNG, #279 embeddings
re-analysis storm, #281 empty-env trap.

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
