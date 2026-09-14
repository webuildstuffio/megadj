# MegaSet — Full Atomic Migration Plan (setbuild → megaset)

**Status:** 🧭 PLANNED — NOT STARTED. None of the code, command, route, tool,
type, file, or CSS renames below have shipped. Execute only from a quiet
worktree after the current integration batch is complete (see "Concurrency
pre-flight"). Companion docs: [PRD](01-prd.md) ·
[Audit & plan](08-audit-and-plan.md). The product prose and skill name are
standardized; this document is the future executable migration plan, not a
receipt. Glossary: [10-findings §5](10-findings.md#5-glossary--every-acronym-and-term-used-across-the-doc-set).

**Principle:** one product name everywhere — MegaSet in docs, `megaset` in
every identifier (verb, route, tool, types, files, CSS). No compat shims:
single-user, local-only product; MCP clients re-list tools, the web UI
ships with the route. Old exported draft JSONs and historical rekordbox
playlists keep their old names on purpose (additive history, no migration).

---

## 0. Concurrency pre-flight (do this first, every attempt)

1. `git status --short` — the migration touches files concurrent agents
   frequently hold dirty. **Must be clean before starting** (or explicitly
   coordinated): `cratedeck/src/setbuild.ts`, `cratedeck/shared/setbuild.ts`,
   `cratedeck/test/setbuild.test.ts`, `cratedeck/web/products/fulltags/SimilarTab.tsx`,
   `src/rekordbox/rb-playlist.ts`, `src/cli-commands-analysis.ts`,
   `cratedeck/shared/types.ts`, `cratedeck/src/archive_routes.ts`,
   `cratedeck/src/archive_tools.ts`, `docs/surface-parity.md`.
2. Re-read every file immediately before editing (worktree diff, not HEAD).
3. Stage only files this migration touched — never `git add -A`.
4. Full `bun test` by hand before push (staged-scope pre-commit cannot see
   other packages; pre-push full suite is the backstop, not the plan).

## 1. Complete token map

### 1.1 Product identifiers (rename)

| Today                                                                                                                                                                               | After                                                                                                                                                                    | Files                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI verb `megadj setbuild`                                                                                                                                                          | `megadj megaset`                                                                                                                                                         | `src/cli-commands-analysis.ts` (handler const, registry entry, 3× `nonNegOpt` domain arg), `src/usage.ts` (usage line + help copy ×2)                                                                              |
| HTTP route `GET /api/archive/setbuild` (+ `?format=m3u8`)                                                                                                                           | `GET /api/archive/megaset`                                                                                                                                               | `cratedeck/src/archive_routes.ts` (9×), fetch URLs in `SimilarTab.tsx` (2×), surface test URLs                                                                                                                               |
| MCP tool `archive_set_build`                                                                                                                                                        | `megaset_propose`                                                                                                                                                        | `cratedeck/src/archive_tools.ts` (5×), `cratedeck/src/mcp.ts` (1×), `cratedeck/deckctl.md`, SKILL.md, description text "M66 set-builder copilot" → "MegaSet copilot"                                                         |
| `parseSetbuildQuery`                                                                                                                                                                | `parseMegasetQuery`                                                                                                                                                      | `cratedeck/src/setbuild.ts`, engine test, `src/rekordbox/rb-playlist.ts` (comment + import use), docs                                                                                                                         |
| `buildSet`                                                                                                                                                                          | `buildMegaset`                                                                                                                                                           | engine, rb-playlist.ts, tests, docs flow diagram                                                                                                                                                                             |
| Types `SetCandidate`, `SetBuildInput`, `SetBuildResult`, `SetBuildStep`, `SetBuildPayload`, `SetPresetId`, `SetPresetDef`, `SetPresetShape`                                         | `MegasetCandidate`, `MegasetInput`, `MegasetResult`, `MegasetStep`, `MegasetPayload`, `MegasetPresetId`, `MegasetPresetDef`, `MegasetPresetShape`                        | engine, `cratedeck/shared/setbuild.ts`, `cratedeck/shared/types.ts` re-export leaf, rb-playlist.ts, web components + tests                                                                                                    |
| Constants `SET_PRESETS`, `SET_PRESET_DEFS`, `SET_PRESET_IDS`, `DEFAULT_SET_PRESET`, `SET_MINUTES_MIN/MAX/DEFAULT`, `SET_TRACK_MINUTES_MIN/MAX`, `SET_POOL_MIN/MAX/UNLIMITED`        | `MEGASET_*` prefix (same suffixes)                                                                                                                                       | shared module + all importers                                                                                                                                                                                                |
| `clampSetPool`                                                                                                                                                                      | `clampMegasetPool`                                                                                                                                                       | shared module + importers                                                                                                                                                                                                    |
| Files `cratedeck/src/setbuild.ts`, `cratedeck/shared/setbuild.ts`, `cratedeck/test/setbuild.test.ts`, `cratedeck/test/archive-setbuild-surface.test.ts`, `src/fulltags/setbuild.ts` | `cratedeck/src/megaset.ts`, `cratedeck/shared/megaset.ts`, `cratedeck/test/megaset.test.ts`, `cratedeck/test/archive-megaset-surface.test.ts`, `src/fulltags/megaset.ts` | `git mv` only (keep the flat-file convention; no new folders)                                                                                                                                                                |
| CSS `setbuild`, `setbuild-*` (~124 selectors in `products.css`, 5 in `base.css`) + `data.css:101` comment                                                                           | `megaset`, `megaset-*`                                                                                                                                                   | both CSS files + every `class={` string (~34 in `SimilarTab.tsx`, ~12 in `SetBuilderResult.tsx`, ~3 in `SetBuilderMethod.tsx`)                                                                                               |
| Components `SetBuildPanel`, `SetBuilderMethod`, `SetBuilderResult`; files `SetBuildPanel.tsx`, `SetBuilderMethod.tsx`, `SetBuilderResult.tsx`                                                            | `MegasetPanel`, `MegasetMethod`, `MegasetResult`; `MegasetPanel.tsx`, `MegasetMethod.tsx`, `MegasetResult.tsx`                                                                               | `SimilarTab.tsx` (+ panel stays there; extraction is NOT in scope)                                                                                                                                                           |
| aria/copy "Set builder settings", "Set builder chain" (SimilarTab) + "Set builder evidence" (Method) + "Set draft summary" (Result)                                                 | "MegaSet …" sweep across all aria-labels                                                                                                                                 | `SimilarTab.tsx:555,830`, `SetBuilderMethod.tsx:10`, `SetBuilderResult.tsx:49`; audit the panel heading copy for any residual "Set builder" string (SKILL.md already promises "MegaSet — propose a mix" — make the UI match) |
| Draft JSON `kind: "megadj-set-draft"`, filename `set-${preset}-…json`                                                                                                               | `"megadj-megaset-draft"`, `megaset-${preset}-…json`                                                                                                                      | `SimilarTab.tsx:292,305` (no test pins; old exports keep old kind — fine)                                                                                                                                                    |
| M3U8 filename `fulltags-${preset}-${actual}m.m3u8`                                                                                                                                  | `megaset-${preset}-${actual}m.m3u8`                                                                                                                                      | `archive_routes.ts:203`                                                                                                                                                                                                      |
| Default playlist name `setbuild ${preset} ${minutes}min ${date}`                                                                                                                    | `megaset ${preset} ${minutes}min ${date}`                                                                                                                                | `src/rekordbox/rb-playlist.ts:430` (+ its test)                                                                                                                                                                              |
| Comments (~15 across engine/routes/tools/rb-playlist/types)                                                                                                                         | rewrite while renaming                                                                                                                                                   | all listed files                                                                                                                                                                                                             |

### 1.2 Domain-neutral names (keep — do NOT churn)

`keyScore`, `bpmScore`, `transitionScore`, `envelope`, `upperBound`,
`lowerBound`, `SET_EXCLUDED_PREVIEW_MAX` → `MEGASET_EXCLUDED_PREVIEW_MAX`
(constant gets the prefix, function names above stay — they describe
music, not the product).

### 1.3 Docs & config updates (after code, commit C4)

| File                                                                                                                                                                                                                                                                                                                                                                                                           | What changes                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/surface-parity.md`                                                                                                                                                                                                                                                                                                                                                                                       | capability row CLI cell `megadj setbuild [...]` → `megadj megaset [...]`; rev-24/20 prose route strings; MCP cell `archive_set_build` → `megaset_propose` (×2); §3 tool table row; add a rev line: "MegaSet rename — verb/route/tool renamed, census unchanged" |
| `docs/megaset/01-prd.md`                                                                                                                                                                                                                                                                                                                                                                                       | `megadj setbuild` ×2, `GET /api/archive/setbuild`, `archive_set_build`, `parseSetbuildQuery`                                                                                                                                                                    |
| `docs/megaset/02-architecture.md`                                                                                                                                                                                                                                                                                                                                                                              | flow diagram (4 interface strings + `setbuild.ts` paths ×2, `SetBuildPayload` node)                                                                                                                                                                             |
| `docs/megaset/08-audit-and-plan.md`                                                                                                                                                                                                                                                                                                                                                                            | scope block file paths, `parseSetbuildQuery` ×2, `megadj setbuild` if present; add a header note: identifiers renamed per [09](09-migration-plan.md)                                                                                                            |
| `docs/megaset/04-sequencing-benchmarks.md`                                                                                                                                                                                                                                                                                                                                                                     | `cratedeck/src/setbuild.ts` ×1                                                                                                                                                                                                                                  |
| `docs/megaset/06-embedding-models.md`                                                                                                                                                                                                                                                                                                                                                                          | "MegaSet B10p" already fine; check no path refs                                                                                                                                                                                                                 |
| `docs/FEATURES.md`                                                                                                                                                                                                                                                                                                                                                                                             | `megadj setbuild` ×3                                                                                                                                                                                                                                            |
| `README.md`                                                                                                                                                                                                                                                                                                                                                                                                    | `megadj setbuild` ×2                                                                                                                                                                                                                                            |
| `docs/ideas.md`                                                                                                                                                                                                                                                                                                                                                                                                | I66 block: engine path, route, MCP/CLI names                                                                                                                                                                                                                    |
| `cratedeck/deckctl.md`                                                                                                                                                                                                                                                                                                                                                                                         | `archive_set_build` ×1                                                                                                                                                                                                                                          |
| `.claude/skills/megaset/SKILL.md`                                                                                                                                                                                                                                                                                                                                                                              | `megadj setbuild` ×3, `archive_set_build`, engine/wire paths ×2                                                                                                                                                                                                 |
| `fulltags/intake-cue-postmortem.md`, `product-state-2026-09-07.md`, `agent-playbook.md`                                                                                                                                                                                                                                                                                                                        | verify zero interface strings remain (prose already standardized)                                                                                                                                                                                               |
| `cratedeck/web/products/fulltags/DESIGN-NOTES.md`                                                                                                                                                                                                                                                                                                                                                              | grep "setbuild" — update if present                                                                                                                                                                                                                             |
| **Comment-only mentions (C1 ride-along):** `src/getdat/commands/adopt.ts:132`, `src/fulltags/cues.ts:11`, `cratedeck/src/archive.ts:64,674`, `cratedeck/web/ui/data.tsx:7`, `cratedeck/web/styles/data.css:101` (comment), `src/shared/maintenance-cmds.ts:356` (comment), `cratedeck/shared/camelot.ts:3` (comment), `docs/megaset/03-competitive-analysis.md:208` (`the setbuild call` → `the megaset call`) | rewrite wording while renaming                                                                                                                                                                                                                                  |
| `cratedeck/web/dist/**`                                                                                                                                                                                                                                                                                                                                                                                        | gitignored build output — regenerated by `bun run check`'s vite build; never hand-edited                                                                                                                                                                        |
| MegaMem                                                                                                                                                                                                                                                                                                                                                                                                        | auto-reindexes tracked `*.md` ~2 s after edit; do not re-index by hand                                                                                                                                                                                          |

### 1.4 Test pins that flip (same commit as the code they pin)

| Test                                                           | Pin                                                                                                                                                                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cratedeck/test/surface-parity.test.ts:269-276`                | `["setbuild", "archive_set_build"]` twin pair; `^\s{2}setbuild,$` registry regex; `src/fulltags/setbuild.ts` read; `from "../../cratedeck/src/setbuild"` import check                                                       |
| `cratedeck/test/archive-setbuild-surface.test.ts` (whole file) | tool key `archive_set_build`, route URLs ×4, tmpdir prefixes, local type names; **rename the file too**                                                                                                                     |
| `cratedeck/test/setbuild.test.ts` (renamed in C1)                     | every import + `describe("parseSetbuildQuery")`                                                                                                                                                                             |
| `src/rekordbox/rb-playlist.test.ts`                            | 4 mentions — default playlist name + import path                                                                                                                                                                            |
| `cratedeck/web/test/fulltags-similar-ux.test.tsx`              | CSS class regexes (`setbuild-preset-option` ×3-count, `setbuild-build`, `setbuild-preset-arc`, `setbuild-preset-label`), route string `"/api/archive/setbuild?"`, `SetBuildPayload`/`SetBuilderResult` imports              |
| `cratedeck/test/mcp-protocol.test.ts`                          | tools/list census — verify whether tool names are asserted individually (grep in C2; count-pins survive a rename, name-pins flip)                                                                                           |
| `deckctl-help.test.ts` / usage census                          | `megadj megaset` must appear in `src/usage.ts` (help-text completeness test) — flips with the verb                                                                                                                          |
| `src/boundary-number-census.test.ts`                           | 1 path mention (`SimilarTab.tsx::SetBuildPanel` reviewed-inventory key) + the §1.3 domain-arg string; keys are `file::symbol::expr` — the symbol rename changes the key, update in the same commit (census must stay green) |
| `cratedeck/test/camelot.test.ts`                               | comment only — ride along                                                                                                                                                                                                   |

## 2. Commit slicing (one branch, four gate-green commits)

### C1 — mechanical code rename, zero behavior change

- `git mv` the five files (§1.1 rows "Files").
- Rename types, functions, constants (§1.1, §1.2) inside moved files.
- Update **every importer** to new paths/names: `cratedeck/shared/types.ts`
  (re-export leaf — keep it the only import surface), `archive_similar.ts`,
  `archive_routes.ts`, `archive_tools.ts`, `mcp.ts` (import only — tool
  key rename is C2), `src/fulltags/megaset.ts`, `rb-playlist.ts` (imports),
  web components' type imports.
- Tests that import the module: engine test, surface test (imports only —
  their route/tool strings stay C2), rb-playlist.test imports.
- `src/fulltags/setbuild.ts` also carries the **`SetbuildOptions` interface** — rename to `MegasetOptions` (grep-verified: only in-file + the CLI import).
- Run the madge cycle check (shared/types.ts import-leaf invariant).
- **Gate:** `bun run check && bun test` green. Knip confirms no orphaned
  old exports.

### C2 — wire surfaces (the breaking rename)

- Route: `archive_routes.ts` → `/api/archive/megaset`; surface-test URLs.
- MCP: tool key → `megaset_propose` in `archive_tools.ts` + `mcp.ts`
  registration + description prose; `mcp-protocol.test.ts` if name-pinned.
- CLI: handler + registry + `usage.ts` → `megadj megaset`; domain args
  in `nonNegOpt` calls; help/usage census test flips with it.
- rb-playlist default playlist name + `boundary-number-census.test.ts`
  reviewed-inventory string.
- M3U8 filename.
- Docs: NONE yet (docs point at new names only after code lands — keeps
  main's docs truthful at every commit).
- **Gate:** `bun run check:full && bun test`; manual smoke: `megadj megaset
--preset peak --json`, `--format=m3u8` download, MCP stdio `tools/list`
  shows `megaset_propose`, `megadj rb-playlist` dry-run prints the chain.

### C3 — web UI

- CSS class renames (both files), component file renames (`git mv`),
  `SimilarTab.tsx` internals (class strings, aria-labels, copy audit,
  draft kind, JSON filename), fetch URLs if not already in C2 (they are —
  keep them in C2; C3 is pure presentation).
- `fulltags-similar-ux.test.tsx` flips.
- **Gate:** `bun run check` (includes vite build) + web tests.

### C4 — docs, skill, parity doc (docs-audit before push)

- Every row in §1.3. Add the surface-parity rev line. Update
  `docs/README.md` MegaSet block only if titles changed (they don't).
- MegaMem reindexes automatically; verify `megamem search "megaj megaset"`
  finds the renamed surfaces afterwards (honesty check, not a gate).
- **Gate:** docs audit pass; cross-links validate; `bun run check` still
  green (docs-only, but cheap).

### Explicit non-goals

- No folder restructuring (`cratedeck/src/` stays flat — the product is
  one engine + one wire module; folders would be ceremony).
- No compat aliases/redirects for the old verb/route/tool (single-user
  product; two names for one thing violates the SSOT rule).
- No migration of historical rekordbox playlist names or exported draft
  JSONs.
- No `SimilarTab.tsx` split into its own panel file (concurrent-agent
  churn zone; extraction can ride a future UI pass).

## 3. Final verification checklist

- [ ] `bun run check` — typecheck 100%, oxlint, knip, vite build
- [ ] `bun run check:full` — ruff + mypy strict gates
- [ ] `bun test` full suite by hand before push (not just staged scope)
- [ ] `megadj megaset --preset warmup --minutes 45` table output == old shape
- [ ] `megadj megaset --json` payload: field names unchanged except none
      (payload keys were already product-neutral: `pool`, `steps`, … —
      verify zero JSON key changes; wire keys are NOT renamed)
- [ ] `?format=m3u8` export plays; filename `megaset-…`
- [ ] MCP stdio: `tools/list` → `megaset_propose`, propose-only hint intact
- [ ] Web panel: build 3 presets, arc renders, Save JSON draft, M3U8 download
- [ ] `megadj rb-playlist` dry-run + `--apply` gates unchanged
- [ ] `megamem search` surfaces renamed docs
- [ ] `git log --oneline -4` shows the four slices; `git status` clean of
      unrelated files

## 4. Risk register

| Risk                                               | Mitigation                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Concurrent agent edits a rename target mid-flight  | §0 pre-flight; slice commits keep rebase cost small; never stage others' files                                                              |
| CSS rename misses a dynamically-built class string | web test greps rendered HTML for `setbuild-` count — flipped regexes catch residue; final `grep -rn "setbuild" cratedeck/web/` must be zero |
| MCP clients cache old tool name                    | session-scoped only; tools/list re-read per session                                                                                         |
| Silent drift between renamed surfaces and docs     | C2 lands with docs still pointing at old names (deliberate); C4 closes the gap same-branch                                                  |
| Payload key accidentally renamed                   | checklist asserts JSON keys unchanged — the wire API is MegaSet-branded by name, not by payload                                             |
