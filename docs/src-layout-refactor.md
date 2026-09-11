# src/ Layout Refactor — full proposal (v2)

**Status: ✅ COMPLETE — shipped 2026-09-11.** Issue #23 is implemented: the
former flat `src/commands/` tree is now split by domain under `src/getdat/`,
`src/fulltags/`, `src/rekordbox/`, `src/shelf/`, `src/archive/`, and
`src/shared/`. The remainder of this document records the design and audit
evidence for the shipped layout.

_2026-09-10. Tracking issue: [#23](https://github.com/webuildstuffio/megadj/issues/23).
Research basis: two full-tree scans, import census, madge cycle check (clean),
coupling-direction audit. Written while the snake→kebab rename was landing;
all paths below use the post-rename (kebab) names._
_v1 → v2: domain assignments corrected from file-header evidence (dedupe trio →
`shelf/`, `doctor.ts` → `shared/`, ingest self-match tests → `getdat/`),
verified counts (45 non-test files in `commands/`), execution detail (knip-first
gate order, ~60 dynamic-import sites in cli.ts, cross-workspace coupling audit,
docs-sweep scope), one more why-not (renaming `megadj`), and a
hooks-vs-concurrent-agents risk row._

## 0. The question that shaped this: is "shelf" a product?

Short answer: it started as the drive's nickname and got promoted to a
**role name** — so it's legitimate vocabulary, not hardware hardcoding:

- `config.toml` key is `[library] shelf_drive` — **shelf is the role**,
  `SHELF1` is just the current value (the same way `master_drive = "DJMASTER"`).
- `cratedeck/shared/check_matrix.ts` encodes `DriveRole` value `"shelf"` and
  maps it to `DriveTier = "archive" | "gig"` — the product's own tier model.
- Docs say "the shelf tier" (usb-sync.md), and AGENTS.md's rule is that
  tools take volume names **from config** — none of the `shelf-*` commands
  hardcode SHELF1.

So `shelf-*` CLI verbs name the _archive-tier role_, and they stay (renaming
user-facing verbs breaks skills, docs, and muscle memory for zero gain).
The directory for these operations is named `shelf/` to match the verbs —
with this note as its charter. If we ever want role-neutral naming, the
candidate is `archive-tier/`, but that renames nothing users touch while
making docs-to-code mapping worse. Decision: keep `shelf/`.

## 1. What's wrong with the current tree

`src/` is four concerns pretending to be one namespace:

1. **Flat `commands/` (72 files)** mixes GetDat, FullTags shims, shelf ops,
   and rekordbox repair alphabetically. `hygiene/` proved the grouping
   pattern works; nothing else uses it.
2. **`state-` prefix stutter**: `state-ledgers.ts`, `state-similar.ts` exist
   only to echo the file they're composed by (`state.ts`).
3. **Name collision**: `cratedeck/src/fleet.ts` (track coverage math) vs
   `fulltags/src/fleet.ts` (hardware profiles — the AGENTS.md-canonical
   one). Two different concepts, one name.
4. **MB logic in three places** in fulltags: `mb.ts`, `mb_lookup.ts`, and
   MB helpers inside `probes.ts` (whose name is a grab-bag lie).
5. **`tools/` holds internal libs**: `fetch-lib.ts` + `fetch-stages.ts` are
   imported only by `fetch-all.ts`/`fix-years.ts` — not standalone scripts.

And what's _right_ (verified, must not regress):

- Import graph is a DAG (`bunx madge --circular` clean, 201 files).
- Coupling is one-way: `cratedeck/*` and `fulltags/*` never import `src/`;
  `src/commands/fetch.ts` imports `fulltags/src/exports` (the documented
  shim rule). Grouping `src/` internally cannot break the workspaces.
- `package.json` `bin`/`module` anchor on `src/cli.ts` — keep it there and
  every script, cratedeck's `cli_job_leg` spawn, and the plugin keep working.

## 2. Current tree (annotated, the parts that move)

```
megadj/
├── src/                        # 4 concerns in 1 namespace
│   ├── cli.ts  cli-flags.ts  cli-env.ts  usage.ts  progress.ts  doctor.ts
│   ├── cli-shelf-cmds.ts       # shelf dispatch cap-relief (imports commands/shelf-*)
│   ├── testutil.ts  state.test.ts  downloader.test.ts  ratelimit.test.ts
│   ├── mood-ledger.test.ts  progress.test.ts
│   ├── state.ts                # ArchiveState — the archive DB spine
│   ├── state-ledgers.ts        # beat/mood/cue ledgers   (stutter name)
│   ├── state-similar.ts        # embeddings ledger       (stutter name)
│   ├── shelf-sweeps.ts         # drive→shelf verdict ledger
│   ├── downloader.ts  ratelimit.ts        # GetDat engine
│   ├── hygiene/                # ✅ the one grouped domain (the template)
│   └── commands/               # 72 flat files (45 non-test), all domains
│                               #   mixed — incl. the two CLI-contract tests
├── cratedeck/                  # product 3 (workspace) — 63 src files
├── fulltags/                   # product 2 (workspace) — 24 src files
├── plugin/                     # Claude Code plugin (hooks/skills) — fine as-is
├── tools/                      # 3 standalones + 2 internal libs (wrong)
├── scripts/export-cookies.sh   # fine
└── reports/codebase-quality-report.md   # one-time snapshot → docs/archive/
```

## 3. Proposed tree

```
megadj/
├── src/
│   ├── cli.ts                              # entry — bin/module anchor, STAYS
│   ├── cli-flags.ts  cli-env.ts  usage.ts  # host kit — STAYS
│   ├── progress.ts  testutil.ts            # host kit — STAYS
│   ├── numeric-options.test.ts             # ← commands/: tests cli-flags —
│   │                                       #   to src/ root (tests the host)
│   ├── json-summary.test.ts                # ← commands/: CLI --json contract
│   │                                       #   — same reasoning
│   │
│   ├── shared/                             # cross-product glue
│   │   ├── drop.ts                         # GetDat→FullTags one-shot pipeline
│   │   ├── status.ts                       # archive summary (human + --json)
│   │   ├── maintenance-cmds.ts             # cli.ts cap-relief dispatch
│   │   └── doctor.ts                       # ← from host kit: dependency/env
│   │                                       #   diagnostics, used across products
│   │
│   ├── archive/                            # THE SPINE: archive DB + ledgers
│   │   ├── state.ts                        # ArchiveState (bun:sqlite)
│   │   ├── ledgers.ts                      # ← state-ledgers.ts
│   │   ├── similar.ts                      # ← state-similar.ts
│   │   ├── sweeps.ts                       # ← shelf-sweeps.ts
│   │   └── hygiene/                        # engine, unchanged
│   │
│   ├── getdat/                             # product 1: acquire
│   │   ├── downloader.ts  ratelimit.ts
│   │   ├── sync  ingest  ingest-register  ingest-probe  ingest-art
│   │   │   ingest-zips  organize  adopt  upgrade  intake-folder
│   │   └── ingest-fingerprint.test  ingest-md5-dedupe.test
│   │       ingest-selfmatch.test           # ← test ingest.ts paths → getdat
│   │
│   ├── fulltags/                           # thin shims over fulltags/ ONLY
│   │   └── fetch  beats  mood  cues  similar  enrich  artwork  embed
│   │       convert  wav-to-aiff  queue  audit-row  booth-fix*
│   │       (+ their tests; the shim rule is already AGENTS.md law)
│   │
│   ├── shelf/                              # archive-tier drive operations
│   │   └── shelf-archive*  shelf-sync  shelf-dedupe*  shelf-dupescan*
│   │       shelf-hygiene  shelf-index  shelf-match  dedupe-archive*
│   │       dedupe-archive-apply  dupescan-shared  cli-shelf-cmds (+ tests)
│   │
│   └── rekordbox/                          # device-DB repair (megadj side)
│       └── rb-fix-paths.ts (+ test)
│
├── cratedeck/
│   └── src/coverage.ts                     # ← fleet.ts (renamed; see §4)
├── fulltags/
│   └── src/mb.ts  mb_lookup.ts  media-probe.ts   # ← probes.ts split (§4)
├── tools/
│   ├── fetch-all.ts  fetch-lib.ts  fetch-stages.ts  fix-years.ts  # lib+consumers together
│   ├── prof-sweep.ts  rb_art.py            # true standalones
├── plugin/  scripts/                       # unchanged
└── docs/archive/codebase-quality-report.md # ← reports/ (one-time snapshot)
```

Domain-assignment corrections (v2 — verified by reading file headers; they
supersede v1's groupings):

- `dedupe-archive.ts`, `dedupe-archive-apply.ts`, `dupescan-shared.ts` →
  `shelf/`. Nuance: `dedupe-archive` operates on the **music archive**
  (`MEGADJ_MUSIC_DIR`), not the shelf volume — it lives in shelf/ because it
  shares `dupescan-shared.ts` (FpCache) with `shelf-dupescan`, and both
  implement the same dedupe policy on different volumes. `dupescan-shared.ts`
  is the shared plumbing for both — the jscpd-flagged byte-identical twins,
  now parameterized by table name.
- `convert.ts` + `wav-to-aiff.ts` stay in the fulltags-shims group, but they
  are not pure shims — they're archive-wide WAV→AIFF passes (the rekordbox
  art rule) built on fulltags primitives.
- `ingest-fingerprint.test.ts`, `ingest-md5-dedupe.test.ts`,
  `ingest-selfmatch.test.ts` → getdat — they test `ingest.ts` paths.
- `doctor.ts` → `shared/`, not host kit — it's dependency/env diagnostics
  used across products.
- `cli-shelf-cmds.ts` → shelf/ (or dissolves into it) — it's the shelf
  dispatch cap-relief and imports `./commands/shelf-sync` etc.
- The two CLI-contract tests (`json-summary.test.ts`, `numeric-options.test.ts`)
  live in `commands/` today — they move to src/ root (out of commands/)
  because they test the CLI host, not any command.

File-count sanity (verified): the 45 non-test files in `commands/` dissolve
as ~11 getdat + 14 fulltags + 15 shelf + 4 shared (drop, status,
maintenance-cmds, doctor) + 1 rekordbox; every `*.test.ts` moves with its
subject — the two CLI-contract tests above are the exception (src/ root).

## 4. Renames riding along (each fixes a real defect)

| Change                                                                                                                        | Why                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cratedeck/src/fleet.ts` → `coverage.ts`                                                                                      | Name-collides with `fulltags/src/fleet.ts` (hardware profiles, the canonical one). It's coverage/redundancy math; `coverage.ts` says that.                         |
| `fulltags/src/probes.ts` → split: MB helpers into `mb.ts`/`mb_lookup.ts`; remainder → `media-probe.ts`                        | MB logic lived in 3 files; "probes" didn't say what it probes.                                                                                                     |
| `state-ledgers.ts` → `archive/ledgers.ts`, `state-similar.ts` → `archive/similar.ts`, `shelf-sweeps.ts` → `archive/sweeps.ts` | Kills the stutter; the directory provides the context the prefix was faking.                                                                                       |
| `tools/fetch-lib.ts` + `fetch-stages.ts` stay in `tools/` beside `fetch-all.ts`                                               | They're `fetch-all`'s private libs, not repo-wide tools. (Cheapest correct move: co-locate, don't relocate into fulltags — they orchestrate CLI stages, not tags.) |
| `reports/codebase-quality-report.md` → `docs/archive/`                                                                        | Dated one-time snapshot; docs rules say that's archive material.                                                                                                   |

## 5. Why NOT the bigger moves

- **Make GetDat a workspace like fulltags/cratedeck?** Not yet. Workspaces
  earn their keep when something imports the package as a library.
  Nothing imports GetDat — it's the product the CLI hosts. A directory
  costs nothing; a second `package.json` + export surface + knip entry
  point costs review every time. Revisit when an external consumer exists.
- **Rename `shelf-*` verbs to `archive-*`?** No. The verbs are shipped
  language (skills, docs, runbooks, muscle memory). The role name "shelf"
  is load-bearing product vocabulary (see §0). Directory named to match.
- **Rename `megadj` itself to match the three-product suite?** No — `megadj`
  is the product name (PRINCIPLES §10) and the archive spine is the shared
  substrate; the three product names describe capabilities, not three repos.
- **Move `cli.ts` into a `host/` dir?** No. It anchors `bin`/`module` and
  every relative spawn path; moving it buys symmetry and costs churn.
- **Touch `cratedeck/web/`?** No — it's already organized by product
  (`products/cratedeck|getdat|fulltags`) with shared chrome. It's the
  model the rest of the repo is catching up to.

## 6. Execution plan (one sitting, mechanical)

0. **Snapshot the pre-move gate baseline** — test count, madge output, knip
   output — so post-move claims are diffs, not vibes. Note for judgment:
   `bun run knip` currently flags `fulltags/src/gold.ts` as unused — that's
   another agent's untracked WIP, not ours; exclude it from the baseline.
1. **Wait for a quiet worktree** — this proposal was written while another
   agent's rename pass was landing across exactly these paths. A structural
   move under an active editor buffer guarantees conflict (see §7 hooks row).
2. `git mv` per domain (archive → getdat → fulltags-shims → shelf →
   rekordbox → shared), tests with subjects. Two exceptions: the CLI-contract
   tests move OUT of commands/ to src/ root; `cli-shelf-cmds.ts` moves with
   shelf/ (or dissolves into it).
3. Rewrite import specifiers mechanically (`../state` → `../archive/state`,
   `./commands/x` → `./getdat/x` from cli.ts, etc.). cli.ts dispatch is
   dynamic `await import("./commands/…")` per case — ~60 import sites, one
   mechanical grep: `await import("./commands/`. Known bridges after the
   move: `maintenance-cmds.ts` imports `./shelf-hygiene` and
   `./rb-fix-paths` → it becomes shared/ → shelf/ and shared/ → rekordbox/;
   fine — shared/ may import domain dirs. The one ugly relative path:
   `hygiene/store.ts` imports `../../cratedeck/shared/hygiene` (wire types
   canonically live in cratedeck/shared, re-exported) — after hygiene/
   moves under archive/ it becomes `../../../cratedeck/…`. Acceptable; do
   NOT add a path alias for one import.
4. The two cross-workspace renames (`fleet.ts`, `probes.ts`) as separate
   commits — they touch cratedeck/fulltags internals. Cross-workspace
   coupling, verified: `cratedeck/src/shelf_sweep_reader.ts` +
   `archive_ledger_reader.ts` read the `shelf_sweeps` TABLE via SQLite
   ATTACH — they don't import src/ TS modules, so renaming
   `src/shelf-sweeps.ts` → `archive/sweeps.ts` cannot break them.
5. Gates, in order: **`bun run knip` FIRST** — it's the check that catches
   orphaned/missed files after moves — then `bunx madge --circular
--extensions ts,tsx src cratedeck/src cratedeck/shared cratedeck/web
fulltags/src` (type-only back-edges count) → `bun run check:full` (100%
   typecov, knip, lint, format) → `bun test` (compare against the step-0
   baseline; 718 tests when v1 was written).
6. Doc/skill path sweep: grep for `src/commands/`, `state-ledgers`,
   `shelf-sweeps` across AGENTS.md, docs/, `.claude/skills/`,
   `cratedeck/deckctl.md`; update; the surface-parity census catches drift.
   Verified scope: 39 `src/commands/` references — AGENTS.md (2),
   docs/agent-playbook.md (2), docs/usb-sync.md (1),
   docs/grid-audit-plan.md, docs/rekordbox-wav-artwork.md,
   docs/fulltags-roadmap.md, and `.claude/skills/{booth-check,
rekordbox-library-repair,new-music-intake}/SKILL.md`. Also verified:
   cratedeck's `intake_run.ts` spawns `src/cli.ts` by path (its test asserts
   that path) — unchanged, because cli.ts stays.
7. Commit per domain so any single failure bisects clean.

## 7. Risk register

| Risk                                                              | Mitigation                                                                                                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concurrent agents editing moved files                             | Hard sequencing gate (§6.1); the issue is labeled and this doc is the SSOT.                                                                                            |
| Hooks' whole-worktree validation + concurrent agents mid-refactor | Execute only on quiet tree; commit per domain so a blocked commit's retry is small.                                                                                    |
| Import rewrite typos                                              | tsc + oxlint catch 100%; madge catches cycles the rewrite could introduce.                                                                                             |
| knip entry-point drift after moves                                | `bun run knip` is in the gate — and runs FIRST (§6.5), since it's the check that catches orphaned/missed files; entries are `src/cli.ts` + workspace bins — unchanged. |
| Docs pointing at old paths                                        | §6.6 grep sweep is part of the gate, not an afterthought.                                                                                                              |
| Breaking the plugin's skill paths                                 | Plugin skills reference CLI verbs, not file paths — verified `plugin/skills/*` contains no `src/commands` references.                                                  |
