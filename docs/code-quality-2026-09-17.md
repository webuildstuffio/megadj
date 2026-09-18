# Code quality progress report — Sep 17, 2026

**Status:** ✅ COMPLETE — measured snapshot at main tip `4f8dd24`, 2026-09-17
~22:45 ET. Dated snapshot; live counts always come from the tools named below,
never this file. Companion visualization:
[megadj-quality-trend canvas](../../../../../../.cursor/projects/Users-nick-github-megadj/canvases/megadj-quality-trend.canvas.tsx)
(21 checkpoints, 8/24 → 9/17).

## TL;DR

The Sep 15–17 quality push closed **60 issues in 3 days** (21 + 35 + 4) and
moved every static-quality gate to its best measured value: max real CCN fell
**152 → 56** (pinned by the #198 ratchet at 60), duplication fell to **0.9%
combined (production mass is 182 LOC across 14 clones — effectively dead)**,
type coverage/knip/oxlint/audit all read 0, and the suite grew to **1,766
tests / 0 fail**. The reorg sequence (#224) is **7 of 12 items closed**; both
monolith batches (#232 rekordbox, #233 web tabs) landed tonight. What remains
is one structural batch — 7 open refactor issues — that buys **~−1,300 LOC
and a finished one-product-root layout** but does **not** reach the 75k census
target on its own; that gap needs the deletion lever, not the refactor lever.

## Measured state (4f8dd24, Sep 17 22:45 ET)

| Metric | Value | Tool / provenance |
|---|---|---|
| Census LOC (budgeted code) | ~114,534 vs 75,000 target (+17,526 vs 9/15 baseline 97,008) | `bun tools/loc-budget.ts` |
| TS/TSX total | 112,329 (673 files) | `git ls-files \| wc -l` over `wc` |
| — production | 75,433 | non-test, non-test-support |
| — test mass | 36,896 (235 test files) = **48.9% of prod** | `.test.` + `test-support` |
| Python corpus | 5,982 LOC / 41 files, all ruff+mypy strict | #194 corpus |
| Max real CCN | **56** `DataTable` (ceiling 60, ratchet) | `bun tools/ast-ccn.ts` |
| Duplication | 107 clones / 1,157 L / 0.9% — **93 clones (1,082 L) are test-internal; prod = 14 clones / 182 L** | jscpd min-tokens 50 |
| Gates | type-coverage 100% · oxlint 0 · knip 0 · `bun audit` 0 · prettier clean | `bun run check` |
| Tests | 1,766 pass / 3 skip / 0 fail (one transient parallel flake in 3 runs — the known SQLite `busy_timeout` class) | `bun test` |
| Open issues | 41 — p0: 2 · p1: 9 · p2: 20 · p3: 10 | `gh issue list` |
| Per-area TS LOC | src (incl. fulltags) 58,971 · cratedeck/src 18,267 · cratedeck/shared 3,562 · cratedeck/web 17,092 · cratedeck/test 13,719 | `wc` per tree |

Commit velocity during the push: Sep 15 = 121, Sep 16 = 109, Sep 17 = 64
(294 total), while prod LOC still grew — the push spent LOC on the genre vote
ladder, `genre-why` surfaces, the rb-scripts Python corpus (+6k strict Python),
and 274 new tests, and bought back complexity, twins, and parity bugs.

## What the push bought (Sep 15 → Sep 17)

- **Parity bugs killed before structure:** #200 (three hand-rolled AUDIO_EXT
  sets — the `.alac` drift class), #226–#231 boundary guards (bare
  `req.json()`, `CRATEDECK_PORT` twins, drain truncation, year-parse merge).
- **Twins collapsed:** metaKey ×3, parseVerifyOutput ×4, SC/BP artist gates
  already on one SSOT; `sc_genre_ids` stays dead.
- **Complexity:** #199 brought the whole 16–22 AST band under 15 and the
  #198 census now enforces a repo ceiling of 60 (was an unmanaged 152 peak).
  Current top: DataTable 56, MegasetPanel 54, RailCard 53, makeDriveRoutes 51.
- **Python under the hard gate:** #194 moved every embedded rb script to
  `src/rekordbox/rb-scripts/` — 41 files strict-checked by ruff+mypy, census-
  pinned (`rb-scripts-census`).
- **Genre SSOT finished:** vote ladder (#173) writes, `genre-why` (#215)
  reads — CLI/MCP/HTTP/UI all replay the one election seam.
- **Monolith batches:** #232 split the rekordbox 500L+ files; #233 split the
  five 400L+ web tabs (both closed tonight).

## Remaining refactor/reorg issues (the open 7)

| # | Item | Effort | Expected effect |
|---|---|---|---|
| #220 | fulltags 82 flat → 8 domain subfolders | xl (move) | ±0 LOC; finishes the #193 model where it started |
| #214 | cratedeck/src 111 flat → prefix-domain folders | xl (move) | ±0 LOC; splits land as siblings, not re-moves |
| #225 | fold cratedeck workspace into `src/` | xl (move) | ±0 net; kills the 34-file deep bridge + the fmt/vector-space twins; one knip/tsconfig view |
| #221 | tiny-file diet | m | 20 files / 485 L measured; 4 policy-exempt stay → **≈ −420 L** (checklist in issue is stale — 6/6 merges already landed tonight) |
| #222 | shared leaf + boundary-direction census | m | twin fold (fmt 102 + vector-space 209) → **≈ −250 L** + the one-way rule becomes tripwired |
| #223 | execute + extend #197: test-support routing + clone gate | m | 93 test clones / 1,082 L measured → **≈ −600 L** + a clone-count gate so it sticks |
| #235 | CLI dispatch rehome (2,100 L grab-bag) | m | ±0 LOC; verb→domain placement |

Sequencing rules from #224 still govern: parity first (done), moves before
splits, one logical move per commit, census strings renamed in the same pass.

Also open nearby: **#197** itself (the clone issue #223 executes) and the
**p1 quick win #236** — hash jobs leak `cratedeck-hashcancel-*` staging dirs,
**12.5 GB and growing** in `~/.tmp` — a one-line-class fix with immediate disk
payoff.

## If we do the remaining issues — projected progress

| Metric | Now | After the 7 | Honest delta |
|---|---|---|---|
| Census LOC | ~114.5k | **~113.2k** | −1.3k — real, but **target 75k is NOT reachable by refactors** (prod 75.4k + tests 36.9k = the mass; only a deletion pass or not-building the 24 open feature issues moves it) |
| Max CCN ceiling | 60 (max 56) | ~57 after one more web-component batch (DataTable/MegasetPanel are JSX-nesting, not logic) | ratchet lowers one tier |
| Duplication | 107 clones | **~15 clones (−86%)**; prod → ~4 (kit residue) | test mass routed through `src/test-support` |
| Flat packs | fulltags 82 flat · cratedeck/src 111 flat · 2 product roots | **0** — fulltags 8 folders, cratedeck ~12, one root | the #193 convention finished repo-wide |
| src ↔ cratedeck seam | 34-file deep bridge, 3 twin modules, no rule | **one direction, census-pinned** | drift class dead |
| Tiny files | 20 (<30 L) | 4 policy-exempt | −16 files |
| Open issues | 41 (9 p1) | 34 (6 p1) | refactors fully burned; p0s (#2, #147) are hardware/ops-gated, not code |

**The one-line verdict:** the remaining refactor batch finishes the
*structure* story — one product root, no flat packs, no twins, pinned seam,
clone-gated tests, ~−1.3k LOC — and after it the codebase is out of
refactor-shaped work. The 75k census target then becomes a *product*
decision (which of the 24 open feature issues earn their LOC, and what gets
deleted to pay for them), which is exactly what the LOC-budget gate is
designed to force per-commit.

## Measurement appendix

- Census: `bun tools/loc-budget.ts` (ts/tsx/py under source dirs; root
  configs/md excluded by policy).
- CCN: `bun tools/ast-ccn.ts --list <files> N` — the census-parity measurer;
  lizard numbers are not comparable (phantom spans, blind to closures).
- Duplication: `bunx jscpd --min-tokens 50 --reporters consoleOnly src cratedeck`.
- Issue counts: `gh issue list --state open` at 22:30 ET Sep 17.
- Tests: `bun test` full suite, 3 runs, clean HEAD.
