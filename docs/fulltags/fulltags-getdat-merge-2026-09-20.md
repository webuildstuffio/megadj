# FullTags + GetDat merge proposal

**Status:** 📋 PROPOSAL — audit measured 2026-09-20 ~20:00 ET at HEAD `7698ccb2` (clean tree). Not yet owner-approved; no moves have been made.

**Ask:** audit the entire FullTags system, then propose how to merge FullTags and GetDat into one codebase — fewer LOC, more standardized — because they always kinda go together anyway.

**Verdict up front:** yes, merge — but the honest LOC win is a few hundred lines from killing twins, not thousands. The real wins are structural: the 31↔3 two-way import edge between the trees dies by construction, the fake "standalone package" fiction ends, one CLI dispatch replaces two, and the artwork-queue path (currently FOUR constants with TWO different env names) gets one SSOT. GetDat dissolves into FullTags (the larger, depended-on tree), not the other way around.

---

## 1. Measured current state (2026-09-20, HEAD `7698ccb2`)

| Tree | Files | Non-test LOC | Test LOC | Total LOC |
| --- | --- | --- | --- | --- |
| `src/fulltags/` | 157 (96 src / 62 test) | 16,769 | 8,143 | 24,912 |
| `src/getdat/` | 37 (20 src / 17 test) | 4,813 | 2,508 | 7,321 |
| **Combined** | **194** | **21,582** | **10,651** | **32,233** |

Repo-wide tracked `.ts` census: **108,168 LOC** (loc-budget gate targets 75k). The two trees are **30% of the repo** — the largest unmerged pair in `src/`.

Largest files (non-test): `getdat/commands/sync.ts` 826 · `src/fulltags/cli-commands.ts` 556 · `src/fulltags/fetch/fetch-stages.ts` 506 · `src/fulltags/sources/beatport.ts` 498 · `src/fulltags/fetch/fetch-pipeline.ts` 475 · `src/fulltags/write/writer.ts` 474 · `getdat/commands/ingest.ts` 401 · `getdat/downloader.ts` 373.

### 1.1 What each tree actually is

- **GetDat** (`src/getdat/`) — *acquisition*: `sync` (YT liked / SC sources via yt-dlp), `downloader.ts` (the yt-dlp spawn + format ladder), `ratelimit.ts` (the serial-by-design limiter), `soundcloud.ts` (SC acquisition rules: format policy, failure classes, link-first), and the intake commands (`ingest*`, `adopt`, `organize`, `upgrade`, `intake-folder`). Plus two riders that have no domain: `doctor`/`init` (registry group "cratedeck", lazily imported).
- **FullTags** (`src/fulltags/`) — *enrichment + analysis*: the write seam (`write/` — one writer, format gotchas, schema/guards, mutagen bridge, convert), the fetch ladder (`fetch/` — SC→BP→BC→MB→AI vote election), genre machinery (`genre/` — 24 files: votes, refold, disputes, why, vocab), analysis (`analysis/` — beats/key/mood/fingerprint via PyAV+ONNX), booth compat (`booth/`), sources (`sources/` — SC search, Beatport, Bandcamp, name-match SSOT), and the analysis-backed verbs (`similar`, `megaset`, `cues`, `regate`, `years`, `booth-fix`).

The lifecycle is one pipeline: **download → ingest (tag/art/dedupe) → fetch (enrich) → analyze (beats/mood/key) → organize**. `megadj drop` already chains all of it (`src/shared/drop.ts`, 732 LOC) — it imports from BOTH trees and is registered as a **fulltags-group verb**. The docs README already describes GetDat's headline verb (`drop`) as running FullTags stages. The boundary between the products is a lifecycle phase boundary, not a module boundary — which is exactly why the trees leak into each other.

### 1.2 The coupling map (the audit's core finding)

**getdat → fulltags: 31 non-test import lines across 12 files.** Every acquisition command already lives inside FullTags' module graph:

| getdat file | fulltags imports (count) | what it uses |
| --- | --- | --- |
| `commands/ingest-one-stages.ts` | 5 | `wavToAiff`, `detectRemix`, `playerCompat`/`isHiresOnly`, `guessFromFreeText`, `mbRecording` |
| `commands/upgrade.ts` | 4 | `applyTags`, `fingerprintFile`, `EnrichedMetadata`, `probeMediaSync` |
| `commands/sync.ts` | 4 | `applyTags`, `probeFile`, metadata-build, `guessFromFreeText` |
| `commands/ingest.ts` | 3 | `applyTags`, `detectRemix`, media-probe |
| `commands/ingest-dedupe.ts` | 3 | writer + hash surfaces |
| `commands/adopt.ts` | 3 | `walkAudioFiles`, `groundTruth`, `normalize` |
| `downloader.ts` | 2 | `sanitizeGenreFolder`, `YtdlpInfo` |
| `commands/ingest-probe-files.ts` | 2 | media-probe |
| `commands/ingest-art.ts` | 2 | `embedArtwork`, art-sources ladder |
| `soundcloud.ts` | 1 | `parseJsonObject` |
| `commands/ingest-register.ts` | 1 | — |
| `commands/ingest-probe.ts` | 1 | `ParsedName`, `Probe` |

**fulltags → getdat: 3 import lines in 2 files** — and this is the damning direction, because it makes the graph **cyclic at the tree level**:

- `src/fulltags/write/convert.ts` imports `fetchAndEmbedArtwork`, `flushArtworkQueue`, `QueueEntry` from `getdat/commands/ingest-art`
- `src/fulltags/write/artwork.ts` imports + re-exports `QueueEntry` from the same file

So `getdat` cannot be understood, moved, or tested without `fulltags`, and `fulltags/write` reaches back into `getdat/commands` for artwork-queue types. Two "products", one tangle.

**Third parties pin the tangle in place:**

- `src/shared/drop.ts` (732 LOC) — imports both trees heavily, but is dispatched as a **fulltags verb** and re-imported only by `src/fulltags/cli-commands.ts` + `src/test-support/cli-run.ts`. It lives in `shared/` but is not shared — it is the merged pipeline's orchestrator parked in the wrong directory.
- `src/shared/status.ts` imports `isLowq` from `getdat/commands/upgrade` (the HIGHQ-bar SSOT) — so even `shared/` reaches into getdat.
- `src/deck/` imports four fulltags modules directly (`write/readers`, `grid-audit`, `genre/genre-vote`, `booth/fleet`) — allowlisted crossings in `src/census/boundary-direction-census.test.ts` tagged "#225A shared-only fold". CrateDeck depends on fulltags-as-a-library; it depends on getdat not at all (only `getdat_*` MCP tool *names*, which are contract, not code).
- No cratedeck file imports getdat code. Direction of the merge is settled by this alone: **getdat moves into fulltags.**

### 1.3 Duplication / twin inventory (the honest LOC win)

These are the measured twins. Each is small; together they are the standardization payoff, and each is a latent drift bug of a class this repo has been bitten by repeatedly.

1. **Artwork-queue path: FOUR constants, TWO different env names.**
   - `src/fulltags/write/artwork.ts`: `MEGADJ_ART_QUEUE ?? ~/.local/state/megadj/artwork-queue.jsonl`
   - `src/fulltags/pipeline/pipeline-art.ts`: `FULLTAGS_ARTWORK_QUEUE ?? <same default>` — a **different env var** for the same queue, so `MEGADJ_ART_QUEUE` is silently ignored by the fetch pipeline's art stage
   - `src/fulltags/archive-ledger.ts`: `QUEUE` — hardcoded, honors **neither** env
   - `getdat/commands/ingest-art.ts`: `appendQueueEntries(dbDir, …)` — joins a caller-supplied dir, its own fourth derivation
   - `src/usage.ts` documents only `MEGADJ_ART_QUEUE`. This is a live bug class, not a style nit: set the documented env, run `fetch --art`, and the queue lands in the default path anyway.
2. **`ext-` short-id twin:** `getdat/commands/ingest-register.ts` exports `extIdFor(file)` = `ext-${sha1(file).slice(0,12)}`; `getdat/commands/ingest-one-stages.ts` re-rolls the identical expression inline instead of calling it. Ledger keys minted by two code paths — the exact "one source of truth per shared surface" violation.
3. **Two CLI grammars for one binary.** megadj verbs go through the host kit (`cli-flags.ts` `parseFlags`/`nonNegOpt`/`firstPositional`); the standalone `fulltags` CLI has its own `cli-args.ts` (159 LOC: `CliArgs`/`parseArgs`/BOOL/VALUE tables) + `cli.ts` (92 LOC) + `cli-verbs.ts` (208 LOC). Both exist, both are census-pinned (`harness-entry-census` pins `src/fulltags/cli.ts` as an entry).
4. **The standalone-package fiction.** `src/fulltags/package.json` declares `bin: fulltags`, version 0.2.0 — but root `workspaces` lists only `cratedeck`, there is no `node_modules/fulltags`, and nothing links the bin. It is an inert costume. `sync`'s error text even tells users to run `bun run fulltags/cli.ts ensure-models` — a path, not a product.
5. **Two yt-dlp spawn conventions:** `getdat/downloader.ts` (download) vs `src/fulltags/sources/sc-search.ts`'s `COL|` spawner (metadata). Legitimately different concerns, but the child-process conventions (hermetic gating, group-kill, line-streaming) should come from one helper surface (`src/fulltags/stdio.ts` already exists for this).
6. **`parse-json.ts` vs shared guards:** a 19-LOC wrapper that already routes through `shared/leaf/guards` — fine as-is, but it is fulltags-namespace packaging of a shared concern; after the merge it can move to the shared leaf family or stay as the one guarded-parse seam for analysis probes.
7. **`archive-ledger.ts` module-level `export const db = new Database(DB_PATH)`** — a side-effectful open-at-import singleton in the fetch path, while the archive state seam lazy-opens. Standardizing this onto the lazy seam removes the "expensive session opened for no work" trap class from AGENTS.md.

### 1.4 What is already good (do not break)

- One md5 execution-style per seam (`shared/hash.ts` in-process, `shelf/md5-cli.ts` subprocess) — getdat already uses `md5FileStream` correctly in three commands.
- One artist-gate SSOT (`src/fulltags/sources/name-match.ts`), one genre-vocab module, one writer, one vote election. The merge must not create a second route to any of these.
- `soundcloud.ts` explicitly documents the division: "Metadata-only SC reads stay in fulltags/sources/sc-search.ts — this file never duplicates them." The merge should make that comment true by *construction* (same tree) instead of by discipline.

---

## 2. The proposal

**Merge GetDat into FullTags. `src/getdat/` dissolves; `src/fulltags/` becomes the one track-lifecycle tree.** "GetDat" stops being a code tree and becomes a *retired product name* (docs status header notes the absorption). No new invented names — `fulltags` is the surviving brand and tree name because it is bigger, has the README, owns the writer, and is the side cratedeck already imports.

### 2.1 Target layout

```
src/fulltags/
  acquire/            ← getdat root modules (git mv, no rewrites inside)
    downloader.ts         the yt-dlp download spawn + format ladder
    ratelimit.ts          the serial-by-design limiter
    soundcloud.ts         SC acquisition rules (format policy, link-first, failure classes)
  intake/             ← getdat/commands/
    ingest*.ts            ingest family (11 files, unchanged internals)
    adopt.ts  organize.ts  upgrade.ts
    intake-folder.ts      dated batch-folder helpers
    sync.ts  sync-summary.ts   the sync verb body
  …everything else unchanged (write/ fetch/ genre/ analysis/ booth/ sources/ …)
```

Plus four structural moves that finish the job:

| # | Move | Why | Net LOC |
| --- | --- | --- | --- |
| M1 | `getdat/*` → `fulltags/{acquire,intake}/` | kills the 31-import edge | ~0 (moves) |
| M2 | `ingest-art.ts` queue types+ladder → `src/fulltags/write/artwork.ts` absorbs `QueueEntry`/`appendQueueEntries`/`flushArtworkQueue` | kills the 3-import **back edge** — the cycle | ~−40 |
| M3 | `shared/drop.ts` → src/fulltags/drop.ts (proposed) | it is a fulltags verb importing both trees; `shared/` stops lying | ~0 (732 moves) |
| M4 | Retire `src/fulltags/cli.ts` + `cli-args.ts` + `package.json`; add `verify-key` + `ensure-models` as megadj verbs | one CLI grammar (host kit), one entry, no fake package | ~−400 |
| M5 | `isLowq` (HIGHQ SSOT) → stays put initially; post-merge it is an intra-tree import from `status.ts` (optionally later to a quality.ts module inside fulltags) | removes a `shared/` → domain import | 0 |
| M6 | `archive-ledger.ts` lazy-DB + queue-path SSOT fold | kills twin #1 and trap #7 | ~−30 |

### 2.2 The twin fixes (land FIRST, before any move)

Each is independently shippable and shrinks the diff the moves have to carry:

1. **Queue-path SSOT:** one exported constant + resolver (canonical env `MEGADJ_ART_QUEUE`; `FULLTAGS_ARTWORK_QUEUE` retired with a one-release console note if it ever mattered). All four call sites (write/artwork, pipeline-art, archive-ledger, ingest-art) read it. Pin with a test: setting the env visibly reroutes all four surfaces.
2. **`extIdFor` single-source:** `ingest-one-stages.ts` calls the existing function.
3. **Doctor/init re-home decision (small, do during M1):** they are registry-"cratedeck" lifecycle commands living in `getdat/cli-commands.ts` for no domain reason. Move their arms to `src/shared/` (or a lifecycle.ts module under src/shared) in the same commit as the getdat move so the getdat dir leaves nothing ambiguous behind.

### 2.3 Naming and surface contracts (the part that must NOT churn)

- **Verb names, help text, group ordering: unchanged.** `command-registry.ts` deliberately interleaves `GETDAT_COMMAND_DOCS.slice(0,5) / FULLTAGS / CRATEDECK.slice(0,1) / GETDAT.slice(5)…`; `help-flag-census` pins the rendering. The merge keeps the `getdat` and `fulltags` *groups* (they are user-facing taxonomy, and `drop` stays a fulltags-group verb) — we are merging code trees, not help menus. `cli-dispatch.ts` imports the merged tables from their new paths; the registry facade is untouched.
- **MCP tool names `getdat_*`: unchanged.** `docs-surface-names-census` derives them from `src/deck/getdat-tools.ts`; renaming them would churn census + live UI for zero value (#215 lesson). Same for `megaset_*`.
- **AGENTS/CLAUDE.md pinned strings:** line 399 pins `src/getdat/soundcloud.ts` by name; the census tests also pin several `src/fulltags/...` and `src/getdat/...` literals. Every rename lands **code + docs + census pins in the SAME commit** (repo rule). Measured pin surface to update, by tree:
  - census tests: **49 literal pins** referencing `src/fulltags`, **10** referencing `src/getdat`, across 12 census files (worst: `test-placement-census` 16, `boundary-number-census` 16, `boundary-json-census` 5, `harness-entry-census` 4, `docs-paths-census` 4, `boundary-direction-census` 4, `tsconfig-bunfig-census` 3)
  - docs: **19 files** reference `src/fulltags`, **4** reference `src/getdat`
  - skills: `.claude/skills/new-music-intake`, `.claude/skills/booth-check`
  - knip entries: `src/fulltags/cli.ts` + 6 test-support entries (M4 deletes the first; the test entries move paths)
- **`docs/getdat/` → folded into `docs/fulltags/`** with status headers (`data-model.md`, `soundcloud-downloads-plan.md`, `usb-sync.md`, `shelf-hygiene-2026-09-09.md` — the hygiene doc may belong beside shelf docs instead; decide during the docs pass). The docs README "four products" section becomes three (GetDat absorbed; MegaSet already effectively lives inside fulltags + cratedeck seam). Docs audit gate before push.

### 2.4 Phase plan (each phase: `bun run check` + touched tests green, commit, push; full `check:full` + `bun test` at each push)

- **Phase 0 — baseline (this doc + issues).** File 4–6 issues (twins batch, M1/M2 move batch, M4 CLI batch, docs batch) with `type:*`/`priority:*`/`effort:*` labels. Record the LOC/census numbers above as the before-picture.
- **Phase 1 — twins, no moves.** Queue-path SSOT (+test pinning all four surfaces), `extIdFor`, doctor/init re-home. Small diffs, negative LOC, zero path churn. Safe under concurrent agents (getdat files were hot Sep 19 via #255–259 — re-check `git status`/`git log -5` before each phase per the contract).
- **Phase 2 — the move (M1+M2+M3, likely 2–3 commits).**
  - 2a: `git mv` getdat root modules → `fulltags/acquire/`; rewrite specifiers repo-wide; update the 10 getdat census pins + AGENTS line 399 + skills paths in the same commit.
  - 2b: `git mv` getdat/commands → `fulltags/intake/`; update `test-placement-census` allowlist rows (they move paths, count unchanged), knip entries, docs paths.
  - 2c: absorb ingest-art into `src/fulltags/write/artwork.ts` (kills the back edge); `git mv shared/drop.ts fulltags/drop.ts` + update its two importers + pins.
  - Every census listed in §2.3 re-run before each commit (concurrent-agent rule: re-run touched censuses after any foreign commit lands mid-flight).
- **Phase 3 — CLI standardization (M4).** Add megadj verify-key and megadj ensure-models verbs (thin arms over the existing `cmdVerifyKey`/`cmdEnsureModels` bodies, host-kit flag parsing) — proposed, not built yet; retire `src/fulltags/cli.ts`, `cli-args.ts`, `cli-verbs.ts`, `package.json`; update `harness-entry-census` (entry list shrinks by one, the "hidden entry points" note rewrites to megadj verbs), `src/fulltags/README.md` quick-start, `sync.ts`'s error string, knip entries. **Note:** `verify-key` becomes a newly first-class verb, so `docs-surface-names-census` must re-derive it from `command-doc-*` — add the doc entry in the same commit.
- **Phase 4 — archive-ledger hygiene (M6).** Lazy DB open via the existing seam conventions; QUEUE constant deleted (Phase 1 already SSOT'd the path).
- **Phase 5 — docs + memory.** Fold `docs/getdat/` → `docs/fulltags/`, rewrite the README products section, status-header the merged docs, update `docs/surface-parity.md` rows (group column only), update AGENTS/CLAUDE.md structural references (keeping all pinned strings' *content* true), docs audit, then a final `check:full` + full suite + live `drop --dry-run` re-proof (super-sure pass: the merged pipeline must re-prove acceptance on a real intake folder, not just green gates).

### 2.5 LOC accounting (honest numbers)

| Change | Δ LOC (tracked code) |
| --- | --- |
| M1 moves (getdat → fulltags) | 0 (git mv, history preserved) |
| M2 back-edge absorption | ≈ −40 |
| M3 drop re-home | 0 (732 moves out of shared) |
| M4 CLI retirement | ≈ −400 (cli.ts 92 + cli-args 159 + cli-verbs reductions + package.json + help dupes), partially offset by two new thin megadj arms ≈ +60 |
| Twins (queue SSOT, extIdFor, archive-ledger lazy) | ≈ −50 |
| **Net** | **≈ −430 (0.4% of census)** — clears the loc-budget gate on its own |

The merge is not a LOC program; it is a **one-directional-module-graph program** with a modest LOC dividend. Claim it as: 2 trees → 1, 1 import cycle → 0, 4 queue constants → 1, 2 CLI grammars → 1, 2 fake packages → 0, 31+3 cross-tree imports → 0.

### 2.6 Risk register

| Risk | Mitigation |
| --- | --- |
| Census red-walls mid-move (49+10 pins) | Pins move in the SAME commit as their paths (repo rule); §2.3 lists every file; re-run the 12 census tests before each commit |
| Help-render ordering regression | Verb groups + registry facade untouched; `help-flag-census` is the tripwire |
| Concurrent agents on hot files (`soundcloud.ts` landed Sep 19) | Phase gates re-check `git status` + `git log -5`; stage-own-files-as-you-edit; no `reset --hard` |
| `verify-key` promotion surprises the ≥80% gauntlet semantics | The arm is a verbatim re-host; gate math untouched; gold-set test moves with it |
| Docs drift (19 files) | Phase 5 is docs-only; docs audit gate; archived docs stay frozen (exempt) |
| Another agent "helpfully" finishing the move differently | One owning issue per phase; the issue text pins the target layout from §2.1 |

### 2.7 Alternatives considered

- **Do nothing:** the cycle (§1.2) grows every time a getdat command needs a tag write — it is the import-direction debt AGENTS already fights on the src↔cratedeck seam. Rejected.
- **Move fulltags under getdat:** inverts 31 imports to chase 3, and cratedeck's four fulltags library imports would re-pin. Rejected.
- **New neutral tree (`src/library/` or similar):** maximum churn (every pin above + the fulltags README + package brand) for zero standardization gain. Rejected.
- **Merge the CLI groups too (one "track" group in help):** user-facing taxonomy churn, breaks the deliberately interleaved ordering, saves nothing. Rejected — groups stay.

---

## 3. Decision points for the owner

1. Approve the direction (getdat → fulltags, §2.1 layout) — or pick an alternative from §2.7.
2. Phase 3 CLI call: retire the standalone `fulltags` entry entirely (recommended, ≈ −400 LOC) vs keep it as a thin alias.
3. `docs/getdat/` fold target: `docs/fulltags/` (recommended) vs docs root.
4. Doctor/init re-home destination (§2.2 item 3): `src/shared/` vs staying with intake.

Measured baseline for the "after" comparison lives in §1. Nothing has been moved, committed, or pushed — this document is the report, and the go-ahead is yours.
