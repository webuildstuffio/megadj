# AGENTS.md — megadj

Notes for coding agents working in this repo. Pointers over prose: this file
holds invariants and traps only — product detail lives in `docs/`, full
mechanics/war-stories behind each rule in `docs/agent-playbook.md`.

## Ground rules

- **English only, always** — commits, docs, comments, identifiers, replies.
- **Product principles SSOT: `docs/PRINCIPLES.md`.** Mac-only/Pioneer-only,
  electronic music is the design target, AI turns unstructured into
  structured, zero commercial intent, latest-tech-only, ship-today. Unclear
  decision → PRINCIPLES.md wins.
- **No CI — ever.** The gate is local: `bun run check` && `bun test` before
  every push. Type coverage is a hard 100% (`bun run check:full`).
- **Zero bare `catch {}` in prod code.** Every catch must surface to the
  user, log at the boundary, or be documented sanctioned resilience. Every
  `JSON.parse` of a persisted blob goes through a guarded parser
  (`parseSnapshotJson` in `cratedeck/shared/badges.ts`) whose failure is a
  visible state — never success, never a crash. No `.catch(() => {})`;
  `Number(env)` at a boundary must be `Number.isFinite`-gated; CLI numeric
  flags go through `nonNegOpt` (bad input → exit 2 with zero work).
- **Strict tsconfig is live (`noUncheckedIndexedAccess`).** A
  `Record<string, T>` lookup yields `T | undefined` — fix with a literal-key
  `as const satisfies Record<string, T>` table (preflight's `BUILDER_ID`).
  Also on: `exactOptionalPropertyTypes` (optional props in `*Options`
  interfaces need explicit `| undefined`), `noUncheckedSideEffectImports`,
  `allowUnreachableCode:false`, plus oxlint (`.oxlintrc.json`) in the gate.
- **Concurrent agents work this repo.** Never `git add -A`; re-read before
  editing; verify content landed via worktree-vs-HEAD diff, not commit hash.
  `EADDRINUSE` on a dev-server restart is usually another agent winning the
  port race — check before killing. A staged file needing another agent's
  untracked module: the module rides along or HEAD breaks.
- **One SSOT per shared surface artifact — never a hand-maintained twin.**
  Derive from the producer (`shared/types.ts` re-export, `KIND_DOCS` import,
  census test). Census tests DERIVE expected strings from source and assert
  exact equality — never a `>= N` floor. Keep the COUNT exact, the regex
  whitespace-tolerant.
- **Pre-commit hooks BLOCK, and their failure output can be truncated** —
  after every commit confirm with `git log --oneline -1` + `git status`.
  Hook tuning: `.shell-config-hooks.conf`; sanctioned huge-commit bypass
  `GIT_SKIP_FILE_LENGTH_CHECK=1 GIT_ALLOW_LARGE_COMMIT=1` (say why). The
  hook validates the whole worktree — a concurrent agent's mid-write WIP
  fails your commit; wait and retry, don't debug their file.
- **Scrub private identifiers before history-touching work** — code, docs,
  stored app state, commit message, replacement text; diffs count as leaks.
- **Dependency bumps carry a ~5-day release-age floor;** re-run the full
  gate after every bump.
- **Ship DOM-verified UI, not API-verified** (CDP dump against the live
  server — the DOM dump is authoritative; screenshots show stale `dist/`
  and `color-mix` quirks). Two-thirds UX law: VERDICT banner → fix-first
  work queue (worst first, each item names its `megadj`/`deckctl` fix
  command with a Copy button) → raw detail. Headless libs only:
  `@tanstack/preact-table`, `virtua` (NOT `@tanstack/preact-virtual` —
  doesn't exist), `lucide-preact`, `fuse.js`, `tinykeys`. Web child content
  caps at 1240px.

## What this repo is

megadj is a YouTube Music archiver (Bun/TypeScript CLI) feeding a shelf
master (archive-grade HDD, `library.shelf_drive`, default `SHELF1`) plus a
master + mirror pair of DJ USB drives that sync FROM the shelf. Migration
and sweep history: `docs/agent-playbook.md`. Key commands and traps:

- **`megadj shelf-archive [volume …]`** — drive(s) → shelf, additive,
  `._*`/junk-filtered, NFC+casefold matching, MD5-verified, divergent
  same-name rips kept as `<name> [<volume>]` twins (never overwrite),
  `--trashes --into F`, `--deep` (same-size ≠ same-bytes). Siblings:
  `shelf-sync`, `shelf-dedupe`, `shelf-dupescan`, `shelf-sweeps`,
  `shelf-hygiene` (byte-twin/acoustic-twin/folder-variant findings ledger:
  scan → review → apply/confirm/dismiss, never bulk-apply unreviewed; 1:1
  across deckctl, `deck_hygiene` MCP, and the Hygiene tab).
  Listen-first acoustic buckets (quality-diff/oddball/ear-check) refuse
  batch-confirm — and the refusal must live in the ENGINE
  (`subcategory.ts`), not a UI spoke: a spoke-only guard once let a route
  probe batch-confirm 94 unreviewed findings while deckctl refused
  correctly. Guard-at-SSOT, filter-only elsewhere).
- rsync WEDGES on fskit exFAT — per-dir tar-pipes + file-count resume
  checks are the proven method (foreground slices only: backgrounded
  runners get reaped, and launchd is TCC-blocked from `/Volumes`). Per-file
  moves with destination MD5 re-verify only (whole-dir `shutil.move` loses
  files). Quarantine/staging dirs live at SHELF ROOT, never inside
  `Contents/`. `PIONEER/` (device DBs) is never walked; `PIONEER REC/` is.
- Every sweep auto-records a verdict row in the archive DB
  (`megadj shelf-sweeps`) — state lives in the DB, not markdown. Flow:
  `.claude/skills/shelf-intake/SKILL.md`.
- Volume names are user-specific — examples use `DJMASTER`/`DJMIRROR`;
  override via args, `config.toml`, or `USB_SYNC_MASTER`/`USB_SYNC_MIRROR`.
- **Ingest self-match guard** (`src/commands/ingest-selfmatch.test.ts`):
  batch folders live INSIDE the archive music dir, so re-ingesting a batch
  must be a safe no-op — "existing row IS this file" is a self-match, never
  a quarantine finding (a UI re-run once renamed 14 archive originals into
  `ingest-duplicates`; all restored). Each dump ingests into its own fresh
  subfolder — never mix dumps.

Sub-projects (one-liners in `docs/FEATURES.md`; honest state in
`docs/product-state-2026-09-07.md`):

- **GetDat** — download + `megadj ingest` (MusicBrainz fill, art, genre;
  zips expand only when fully ingested). Guide:
  `.claude/skills/new-music-intake/SKILL.md`.
- **FullTags** (`fulltags/`) — enrichment engine: one schema
  (`FullTag`/`TagPatch`), one atomic writer, file-first readers, art
  ladder, standalone CLI. Roadmap + gates: `docs/fulltags-roadmap.md`.
- **CrateDeck** (`cratedeck/`) — Bun + Preact dashboard over the drives'
  rekordbox libraries. Driven via `deckctl` (`cratedeck/deckctl.md`) and
  the MCP server (`bun run mcp`). Surface registry:
  `docs/surface-parity.md`; backlog: `docs/ideas.md` (§0 = do-now gate →
  one GitHub issue each).

**Agent-first contract (enforced by `src/commands/json-summary.test.ts`):**
every `megadj` command takes `--json` — one summary JSON object on stdout,
human logs suppressed, exit code still meaningful.

## Rekordbox realities

Safety first: quit rekordbox before DB edits; never write drive DBs in
place; never delete source files; dated backups
(`~/Music/rekordbox/rekordbox_bak_*.zip`) are sacred.

- **Dual-DB device libraries.** OneLibrary `exportLibrary.db` (SQLCipher) +
  legacy `export.pdb`/`exportExt.pdb` older players read. A sync only
  happens when the export.pdb live-row count equals the OneLibrary count.
  Pipeline: `.claude/skills/rekordbox-usb-sync/SKILL.md`.
- **The master DB lives ON the shelf** (`/Volumes/SHELF1/PIONEER/Master/
  master.db`) — rekordbox won't open without SHELF1; exFAT + SQLite
  mid-write power-loss is the corruption risk. Always pass the DB path
  positionally to pyrekordbox and confirm `db.session.bind.url`;
  `~/Library/Pioneer/rekordbox/master.db` is a stale local copy; never
  write while rekordbox runs (live WAL). CrateDeck snapshots read a scratch
  COPY of `exportLibrary.db` and refuse while rekordbox runs
  (`REKORDBOX_RUNNING` interlock) — DB changes show in the dashboard only
  after a fresh snapshot/verify, never live.
- **Archive tier ≠ gig tier.** The role-aware check matrix lives ONCE in
  `cratedeck/shared/check_matrix.ts` — preflight, checks, badges, banner
  all DERIVE from it; a local `role === "shelf"` string check is a
  regression (`check-matrix.test.ts` catches it). The shelf's EMPTY
  `PIONEER/rekordbox/` tree is CORRECT (no player reads the shelf);
  "Synchronize" on the shelf's device entry is a decoy (it writes the old
  stick's identity back — see playbook before chasing counts); pdb/
  OneLibrary parity is informational on shelf tier, a gig-stick gate only.
  Never "fix" a shelf card by exporting to it.
- **After ANY DB path rewrite, verify EVERY row's file exists on disk —
  never just prefix-matched rows** (a prefix-scoped check once hid 351
  broken rewrites). `megadj rb-fix-paths` encodes this + the matching
  ladder; dry-run by default; flow:
  `.claude/skills/rekordbox-library-repair/SKILL.md`.
- **rekordbox caches UI state.** Missing File Manager builds its list ONCE
  when opened — reopen it (or rekordbox) after out-of-band DB edits, or a
  landed fix looks like a no-op. Bulk relink: Collection view → ⌘A →
  right-click "Relocate Lost Files" (greyed in playlist/device views).
  Full mechanics: `.claude/skills/rekordbox-library-repair/SKILL.md`.
- **RB never reads art in WAVs** — new WAVs convert → AIFF at ingest
  (`src/commands/wav-to-aiff.ts`); covers render from `artwork_m/s.jpg`
  thumbnails. **TKEY is read on AIFF/MP3 only**, and RB overwrites imported
  keys on analysis unless Key analysis is disabled. Research:
  `docs/rekordbox-wav-artwork.md`.
- **Import order into rekordbox: `megadj shelf-sync` FIRST, then drag from
  the shelf volume** (`/Volumes/SHELF1/Contents/…`), never from a local
  staging folder — dragging locals registers Mac paths, skips the shelf,
  and breaks stick parity. Canonical answer is the "Import to shelf"
  glossary term (`cratedeck/shared/help.ts`).
- Verify job + help SSOT: `deckctl explain` documents job types; `deckctl
  help [term]` serves the UI glossary/tooltips (`cratedeck/shared/help.ts`).

## CrateDeck invariants (all regression-tested — re-read before touching)

Architecture and wire shapes:

- `shared/types.ts` is the **leaf** of the import graph (imports nothing
  from `src/`). Check cycles: `bunx madge --circular --extensions ts,tsx
  cratedeck/src cratedeck/shared cratedeck/web` — type-only back-edges
  count. Wire types with a producer chain to `shared/types.ts` are defined
  THERE, producer imports back; split-out modules type against leaf seams
  (`archive_types.ts`, `report_types.ts`), never the parent module.
- Web components never re-declare server payload shapes — derive from
  `shared/types.ts` re-exports so drift fails typecheck.
- `rbSnapshot`/`checksumLedger` stay async (spawnSync/hash loops froze the
  server). Only external physical hardware passes `detect.ts`
  `isPhysicalExternal`. `overall()` never reports `healthy` when every
  check is `unknown`; bitrot verdicts come from real checksum results.
- Every fetch deadline exceeds its server leg (`api()` 30s; prep digest 75s
  vs 60s sweep leg; `Bun.serve` `idleTimeout: 120`). SSE needs a heartbeat
  + phantom-job reaper.
- SSE `job` events fire up to ~4/s — `App` coalesces to ≤1/s, `DrivePage`
  ≤1/2s; jobs-refresh failures toast ≤ once/30s. Disk-burn guards:
  snapshots 20/drive, events 2000/drive.
- `FleetStore.sync` inserts playlist entries `OR IGNORE` (a dirty snapshot
  once emptied all fleet tables). Census/aggregation totals come from
  `COUNT`, never from summing LIMIT-clamped buckets.

Jobs must never lie or spin forever (`cratedeck/test/jobs-progress.test.ts`):

- ETA estimator re-bases every ≥1s; every job leg has a wall-clock budget;
  the stall watchdog watches the progress FRACTION (not log freshness);
  cancelled jobs never force `progress: 1`; the dock only spins while a job
  is genuinely `running`. **A watchdog fed by activity logs cannot catch a
  wedge that keeps logging — watch the progress fraction.**
- `setJobProgress` ETA is tri-state (undefined = keep, null = clear);
  `drain()` appends only new stdout bytes; usb_verify `tick(progress, 1)` —
  pass spans as done/total.

State and role handling:

- `setNickname` maps blank-after-trim to null; empty rename cancels, never
  wipes. `inferRole` compares CONFIGURED master/mirror names, never
  hardcoded volumes. The `setSnapshot` change-detector must recurse.

Surface parity and CLI help:

- A capability on one surface (deckctl / MCP / web) exists on all or has an
  exemption row in `docs/surface-parity.md` §4
  (`cratedeck/test/surface-parity.test.ts`). Web shell = three-product
  suite (Drives / GetDat / FullTags), shared chrome in
  `web/products/shared.tsx`.
- `deckctl help [term|kind]` and `--help` work with the server DOWN and
  dispatch BEFORE `ensureServer`; `--help` → stdout, exit 0; exact
  JOB-KIND match wins over a same-named glossary term.
- **`--json` exits must survive pipes** — `console.log` is a
  fire-and-forget write; a ~97KB payload truncated mid-string made piped
  consumers EOF with "Unterminated string". All JSON exits go through an
  awaited `Bun.write(Bun.stdout)` + a final stdio drain before exit
  (`cratedeck/src/deckctl.ts`). A crashed verify must read as a crash:
  corrupt/missing `verify_report_json` is a visible state, never "almost
  healthy".

UI gotchas (each one shipped a real bug — re-read before touching UI):

- `apiPost` passes `FormData` through UNserialized; `InfoTip` has a `side`
  prop; preview cache-busters key off save-changing values; `Verdict`
  accepts `"bad"` (CSS tier must exist); `Donut` takes `hasData`. Verify
  against the BUILT `web/dist`; servers spawned in one shell call get
  reaped — relaunch via `deckctl status --json` auto-start, poll across
  calls.
- **Hover cards are portal-rendered, never CSS-positioned.** CSS
  `position:absolute` inside the anchor got clipped by ~40 `overflow`
  ancestors and pushed off-screen at rail/edge sites — every tooltip in
  the app was unreadable. All hover cards go through the `tipPlace.ts`
  placement engine (portal to body, `position:fixed`, flip + clamp,
  `data-ready` reveal); cards must measure after mount via
  `transform:translate3d`, not React-owned `left/top` (imperative
  measurement writes fight React styles → card parks offscreen).

## FullTags invariants

- `setFileTags`/`writePatchSync` is sync — never bridge to async via
  spawned `bun -e` (6.4× slowdown, regression-tested).
- Writer gotchas: ffmpeg drops AIFF ID3 chunks (use mutagen); WAV art via
  mutagen APIC; mp3 id3v2.3; ffmpeg infers the muxer from the tmp filename.
- ONNX mood heads: positive label FIRST (except mood_party); emomusic
  outputs (valence, arousal) 1–9. An inverted/saturated head = wiring bug.
- Write gates stay BLOCKED until re-gate passes (key passed 80.7%; BPM
  phase-lock + genre head blocked). Analysis lives in DB ledgers (`beats`,
  `mood`, `cues`), never tags, until a gate passes. Audit gate requires
  mood + energy; idempotent re-runs are no-ops.
- Booth fleet gates live as data in `fleet.ts` (profiles WITH citations;
  `[booth].fleet` in config.toml / `MEGADJ_FLEET`); `player-compat.ts`
  floors codec/sample-rate; `booth-text.ts` flags tofu/mojibake/path
  chars. `megadj audit` enforces; `megadj booth-fix` proposes (dry by
  default). Flow: `.claude/skills/booth-check/SKILL.md`.

## Process

- Docs go through `/docs-audit` rounds before pushes; dated docs are
  snapshots — current state: `docs/product-state-2026-09-07.md`.
- Hardware-gated issues close as executable runbooks (`docs/runbooks/0*.md`);
  "open but armed" is valid. Tools take volume names/paths from config —
  never hardcoded literals.
- **No one-time scripts in the repo** — the deliverable is the reusable
  command + tests + doc/skill update; the one-off is deleted. Encode traps
  in the command (junk filter, `--deep`, `--trashes`), not comments.
- **Perf passes are QUANTIFIED** — measure a baseline, prove the saving.
  On-disk I/O numbers need COLD-CACHE measurement (the archive fits the
  page cache; local reads are 10× off real USB truth).
- knip's `ignoreBinaries`/`ignoreDependencies` entries are load-bearing —
  leave the config byte-identical.
- Hermetic CLI tests invoke `process.execPath`, not the user's `bun` shim;
  `python3` one-liners need `/usr/bin/python3` (local `uv` shim). Both are
  shell-config wrapper defects — tracked upstream in
  webuildstuffio/shell-config #300/#301; details in
  `docs/agent-playbook.md`.
- "Do it yourself fully" = hands-on, and a failed fix is reported as
  failed with root cause — false "done" reports are the cardinal sin.
- Tests exercising sticky-exit paths reset `process.exitCode` after the
  assertion (bun test reports the PROCESS exit code — a green suite can
  still fail the hook).
- Docs live in `docs/` — never a tracked root `plan.md`; dated session docs
  get a status header + SHIPPED stamps when their spec lands, else they
  read as open work forever. `/docs-audit` duplicates get merged into the
  linked SSOT, never re-expanded.
- A concurrent agent's mid-flight edit can strip a load-bearing safeguard
  (a documented test timeout override once was) — restore the documented
  value per concurrent-agent policy; don't debug their code or leave the
  gate broken.

## Local-only files

- `(local ops log)` and previous private versions of this file are
  **gitignored** — personal library details never get committed. Back up
  copies outside the repo.
