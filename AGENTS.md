# AGENTS.md — megadj

Notes for coding agents working in this repo. Pointers over prose: this file
covers invariants and traps only — product detail lives in `docs/`.

## Ground rules

- **English only, always.** Every commit message, doc, comment, identifier,
  and reply this repo produces is plain English, regardless of request language.
- **Product principles SSOT: `docs/PRINCIPLES.md`.** Mac-only/Pioneer-only,
  electronic music is the design target, AI turns unstructured into
  structured, zero commercial intent, latest-tech-only, ship-today. When a
  decision is unclear, PRINCIPLES.md wins.
- **No CI — ever.** `.github/workflows/` was deleted outright (one author,
  one Mac, hosted runners are shared infra). The gate is local: `bun run
  check` && `bun test` before every push. Type coverage is a hard 100%
  (`bun run check:full`); nothing lands below it.
- **Zero bare `catch {}` in prod code.** Every catch must (a) surface to the
  user (toast/error state), (b) log at the boundary, or (c) be documented
  sanctioned resilience. Corrupt persisted JSON can never read as success.
- **Concurrent agents work this repo.** Never `git add -A` — stage only your
  own files; re-read immediately before editing; verify content landed via
  worktree-vs-HEAD diff, not commit hash (amends and swept-in staged files
  are normal). Long `bun test` runs can hang on in-flight churn — rerun
  clean before declaring failure.
- **Prose passes:** preserve em dashes and punctuation in shipped docs.

## What this repo is

megadj is a YouTube Music archiver (Bun/TypeScript CLI) feeding a master +
mirror pair of DJ USB drives. Volume names are user-specific — examples use
`DJMASTER`/`DJMIRROR`; override via args, `config.toml`, or
`USB_SYNC_MASTER`/`USB_SYNC_MIRROR`. Three named sub-projects (one-liners in
`docs/FEATURES.md`; honest state in `docs/product-state-2026-09-07.md`):

- **GetDat** — download + `megadj ingest` into the archive (MusicBrainz
  fill, art, genre; zips expand only when fully ingested; sources move after
  success). Guide: `.claude/skills/new-music-intake/SKILL.md`.
- **FullTags** (`fulltags/`) — the enrichment engine: one schema
  (`FullTag`/`TagPatch`), one atomic writer (`writer.ts`), file-first
  readers, art ladder, standalone CLI. megadj imports it via thin shims.
  Roadmap + analysis-gate results: `docs/fulltags-roadmap.md`.
- **CrateDeck** (`cratedeck/`) — Bun + Preact dashboard over the drives'
  rekordbox libraries (Python seam: `cratedeck/python/rb_read.py`). Driven
  via `deckctl` (guide: `cratedeck/deckctl.md`) and the MCP server
  (`bun run mcp`, 26 tools). Surface registry: `docs/surface-parity.md`.
  Idea backlog: `docs/ideas.md` (§0 = do-now gate → one GitHub issue each).

**Agent-first contract (enforced by `src/commands/json-summary.test.ts`):**
every `megadj` command takes `--json` — one summary JSON object on stdout,
human logs suppressed, exit code still meaningful.

## Rekordbox realities

- Device libraries are dual-DB: OneLibrary `exportLibrary.db` (SQLCipher) +
  legacy `export.pdb`/`exportExt.pdb` that older players read. A sync only
  happens when the export.pdb live-row count equals the OneLibrary count.
  Pipeline + safety rules: `.claude/skills/rekordbox-usb-sync/SKILL.md`.
- CrateDeck's verify job audits exactly these failure modes (dual-DB
  agreement, file existence, ANLZ at hashed paths, grid sanity, playlist
  integrity, parity); `deckctl explain` documents every job type.
- RB never reads art in WAVs (RIFF INFO has no art field) — ingest converts
  new WAVs → AIFF (`src/commands/wav-to-aiff.ts`); legacy WAVs are
  pointer-fixed via `tools/rb_art.py`. RB renders covers from
  `artwork_m/s.jpg` thumbnails — `ensure_artwork_file` generates all three.
  Research: `docs/rekordbox-wav-artwork.md`.
- TKEY is read on AIFF/MP3 only, and RB overwrites imported keys on analysis
  unless Key analysis is disabled (`docs/fulltags-roadmap.md` gauntlet).
- Safety: quit rekordbox before DB edits; never write drive DBs in place;
  never delete source files.

## CrateDeck invariants (all regression-tested — re-read before touching)

Architecture + wire-shape rules:

- `shared/types.ts` is the **leaf** of the import graph — it defines every
  cross-boundary wire type and imports nothing from `src/` (cycles there
  once forced `GIT_SKIP_HOOKS` on every commit). Verify:
  `bunx madge --circular --extensions ts,tsx cratedeck/src cratedeck/shared cratedeck/web`.
- Web components must NOT re-declare server payload shapes locally — a
  local duplicate drifts silently and ships runtime bugs (it did, three in
  one tab). Derive from the producer: `shared/types.ts` re-exports
  (`ArchiveIngestStatus`, `FleetDiff`, `SearchResult`, …) fail `typecheck`
  on drift instead.
- `rbSnapshot`/`checksumLedger` stay async — spawnSync/hash loops froze the
  server for minutes once.
- Only external physical hardware passes `detect.ts` `isPhysicalExternal` —
  image-backed/internal volumes are rejected on measured `diskutil` signals
  before any row is written.
- `overall()` never reports `healthy` when every check is `unknown`; bitrot
  verdicts come from real checksum results, never hardcoded.
- Every fetch has a deadline that exists AND exceeds its server leg: `api()`
  defaults 30s (`AbortController`; `apiPost` forwards `timeoutMs`), prep
  digest passes 75s vs the 60s sweep leg, `Bun.serve` runs
  `idleTimeout: 120` so the ~18s prep handler isn't killed at the default
  10s. A hung request must abort into a clear toast, never spin forever.
- The SSE stream needs a heartbeat (Bun kills idle streams ~10s — this once
  stranded a finished verify as "running 0%" forever) + a phantom-job
  reaper for stale `running` rows.
- SSE `job` events fire up to ~4/s — `App` coalesces `refreshJobs` to ≤1/s,
  `DrivePage` throttles drive fetches to ≤1/2s.
- Disk-burn guards: snapshots capped 20/drive, events 2000/drive (agent
  notes ARE events — the cap bounds them automatically).
- `setNickname` trims and maps blank-after-trim to null — a nickname is
  never `''` or whitespace; empty rename input cancels, never wipes.
- `inferRole` compares against the CONFIGURED master/mirror names
  (`DB.masterName`/`mirrorName`) — hardcoding volume names broke custom
  setups once.
- The `setSnapshot` change-detector must recurse (a `JSON.stringify`
  replacer ARRAY filters keys at every depth — nested edits looked
  "unchanged"); `jobs.ts drain()` must append only new stdout bytes;
  ETA in `setJobProgress` is tri-state (undefined = keep, null = clear);
  usb_verify phase markers are indented and `tick(from, to)` means
  done/total — pass spans as `tick(progress, 1)`.
- Surface parity is enforced: a capability on one surface (deckctl / MCP /
  web) must exist on the others or carry an exemption row in
  `docs/surface-parity.md` §4 (`cratedeck/test/surface-parity.test.ts`).

## FullTags invariants

- **Perf:** `setFileTags`/`writePatchSync` is sync — never bridge it to
  async via spawned `bun -e` (measured 6.4× slowdown; regression test).
- Writer format gotchas: ffmpeg drops AIFF ID3 chunks (use mutagen); WAV
  art via mutagen APIC; mp3 id3v2.3; ffmpeg infers the muxer from the tmp
  filename — tmp outputs keep their extension.
- ONNX mood heads: label order is positive FIRST for every head except
  mood_party; emomusic outputs (valence, arousal) 1–9. An inverted or
  saturated head (same value on every track) means a wiring bug — probe the
  model directly before stamping.
- Write gates: batch tag writes stay BLOCKED unless the re-gate passes
  (key passed at 80.7%; BPM phase-lock and the genre head failed and are
  blocked). Analysis output lives in DB ledgers (`beats`, `mood`, `cues`),
  never in tags, until a gate passes.
- The audit gate requires mood + energy (`COMPLETENESS_FIELDS`); idempotent
  re-runs are no-ops.

## Process

- Docs go through `/docs-audit` rounds (SSOT-merge, kill stale claims,
  verify against code) before pushes. Dated analysis/learnings docs are
  snapshots — check `docs/product-state-2026-09-07.md` for current state.
- Tools take volume names/paths from config — never hardcoded literals.

## Local-only files

- `(local ops log)` and previous private versions of this file are
  **gitignored** — personal library details never get committed. Back up
  copies outside the repo.
