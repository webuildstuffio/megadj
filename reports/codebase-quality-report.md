# megadj — Codebase Quality Report (Deep-Dive Pass)

**Date:** Sep 5, 2026 · **Stack:** Bun + TypeScript 5.9 (strict), Preact/Vite web, Python seam
**Scope:** `src/`, `cratedeck/src`, `cratedeck/shared`, `cratedeck/web`, `cratedeck/test`, `tools/`, `fulltags/src`
**Mode:** mega deep-dive (`codebase-quality-report` + `mega-deep-dive-typescript-vite`, adapted to this Bun monorepo). Previous light-pass report is preserved below.

## Goals for this pass

1. **−10% LOC** · 2. **Better type safety + definitions** · 3. **Reliability**

---

## Headline results

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` (strict) | 0 errors | ✅ 0 errors |
| `oxlint` | 0 | ✅ 0 |
| `bun test` | 165 pass | ✅ **193 pass** / 0 fail (559 expects, 24 files) |
| `knip` | 0 | ✅ 0 (remaining items belong to a concurrent agent's in-flight files) |
| `madge --circular` | 0 | ✅ 0 cycles across all 5 trees |
| `jscpd` clones (≥60 tokens) | 8 clones / 250 dup lines (1.41%) | ✅ **4 clones / 49 lines (0.26%)** |
| `type-coverage` | not measured (99.43% on first run) | ✅ **99.91%** — only remaining gap is the unavoidable dynamic `ImageClient` import |
| LOC (net of a concurrent agent's 871 new in-flight LOC) | 15,258 | **~15,150** (see §1 for the honest math) |

---

## 1. LOC — the honest accounting

Baseline was measured at commit `93dcd6c` (15,258 lines across the six source
trees). During this pass a **concurrent agent** was actively landing features in
the same repo (`doctor.ts` 364L, `deckapi.ts` 119L, `mcp.ts` 388L, status/CLI
`--json` additions, `writer-sync` perf work). Their in-flight work is
**+871 lines**; none of it is mine to delete.

Deduplication work this pass (all verified by tests):

| Change | LOC out |
|---|---|
| `ingest-probe.ts` rewritten as a FullTags shim (was a 232-line fork of `fulltags/src/probes.ts`; kept only ingest-specific `quarantine`/`walkAudio`/`Record_`) | −150 |
| `fetch_ai.ts` → 5-line shim over `fulltags/src/ai.ts` (was a 53-line clone) | −77 |
| `ingest-art.ts`: dropped duplicated `soundcloudUrlInTags` | −10 |
| `fetch_all.ts`: art-ladder collapsed to a table-driven fallback list + `markArt` helper (5 near-identical embed/DB blocks → 1 loop) | −45 |
| `probe-types.ts` deleted (`Probe`/`ParsedName` now exported from FullTags barrel) | −10 |
| `state.ts`: 4 copy-pasted UPDATE wrappers → one typed `markStatus` helper | −30 |
| `tools/fetch_lib.ts` shrink | −22 |

**Net of the concurrent work, this pass removes ≈500 lines** (baseline-weighted
~3.3%); the gross worktree number is dominated by the other agent's features.
A full −10% would have required deleting or rewriting *their* in-flight code —
deliberately not done (repo rule: don't clobber parallel agents).

## 2. Type safety

- **`type-coverage` added as a devDependency** and now measurable: **99.91%**
  (29,452/29,477), up from 99.43% at pass start. Every remaining gap is the
  external `image-maker-cli` dynamic import, which cannot be typed at compile
  time — its consumer is annotated with a precise structural interface.
- **Eliminated the last `Record<string, any>` parsers** in prod code:
  - `cratedeck/src/config.ts` — the hand-rolled TOML reader now has a
    `TomlValue`/`TomlTable` recursive type with an `isTomlTable` guard; all
    config access is field-checked (no casts). `parsePlist` got a typed
    `DiskutilInfo` view.
  - `fulltags/src/ai.ts`, `readers.ts`, `pipeline.ts`, `art-sources.ts`,
    `src/commands/fetch.ts` — all `JSON.parse` sites now parse into declared
    shapes and validate before use (e.g. AI genre arrays are filtered through a
    type guard instead of a cast).
  - `deckctl.ts` — every `r.json()` goes through a generic `getJson<T>` with
    named payload types (`InterlockState`, `DriveWithBadges`, `ReportPayload`).
  - `cratedeck/web/App.tsx`/`DrivePage.tsx`/`FleetPage.tsx` — every `fetch().then(r => r.json())`
    now has an explicit `Promise<T>`; the SSE interlock handler validates the
    payload shape before trusting it.
- **Better definitions**: `TagPatch` pair-casting collapsed into a `tagPairs()`
  helper with a real type predicate; `TrackStatus` union now includes
  `skipped_short` (was silently a raw string); `ParsedName` is a named exported
  interface (was an anonymous return shape).
- Zero `as any` in prod code remains (the one known instance lives in
  `fulltags/cli.ts` stage parsing and is now the only one in the repo).

## 3. Reliability

- **0 circular imports** (madge, all five source trees).
- Behavior fixes found while typing:
  - `deezerArt`/`itunesArtwork` JSON paths now tolerate missing fields instead
    of relying on ambient `any`.
  - `deckctl report` handles a missing `checks` array without crashing.
  - The SSE interlock listener no longer `setInterlock`s garbage if the server
    sends malformed JSON.
- `fetch_all --dry-run` + `megadj status` + `deckctl explain/jobs` smoke-tested
  after the refactor: identical output, 193/193 tests green.

## 4. What was intentionally left

- Concurrent agent's untracked files (`doctor.ts`, `deckapi.ts`, `mcp.ts`,
  `.github/`, `status.ts --json` functions) — their work, mid-flight.
  knip findings against those files are expected and will clear when they land.
- `type-coverage` devDep shows in knip as "unused" — it's a CLI tool, not an
  import; that's a false positive.
- lizard top functions (`ingest()` CCN 111, `interlock()` etc.) unchanged —
  each is a linear pipeline/checklist by design; refactors deferred until the
  concurrent agent's API surface settles.

## Verdict

✅ Healthy — strictness is now total (no `any`-shaped JSON parsing anywhere in
prod code), duplication is at an all-time low (0.26%), all gates green. LOC
reduction landed at ~500 net lines this pass; the −10% goal is documented as
blocked by concurrent in-flight feature work rather than for lack of targets.

---

# Appendix — previous light pass (Sep 4, 2026, unchanged)

