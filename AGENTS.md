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
  sanctioned resilience. Corrupt persisted JSON can never read as success —
  and never CRASH hot paths either: every `JSON.parse` of a persisted blob
  (`last_snapshot_json`, `verify_report_json`, `data_json`) goes through a
  guarded parser (`parseSnapshotJson` in `cratedeck/shared/badges.ts` for
  snapshot blobs) whose failure is a _visible state_ (badge, `corrupt:true`
  payload, logged boundary), because `driveBadges` runs on every
  `/api/status` + `/api/drives` request — one unguarded parse 500s the
  whole drive rail (regression-tested in `cratedeck/test/badges.test.ts`).
  Also: no `.catch(() => {})` on fire-and-forget work (log instead), and
  `Number(env)` at a boundary must be `Number.isFinite`-gated (`MEGADJ_ART_MAX=""`
  → NaN → `slice(0, NaN)` processed nothing while "succeeding"). CLI numeric
  flags go through `nonNegOpt` — invalid input (`abc`, empty; `Number("")` is 0)
  returns undefined so guards fire and the command exits 2 with zero work
  (regression-tested in `src/commands/numeric-options.test.ts`).
- **Concurrent agents work this repo.** Never `git add -A` — stage only your
  own files; re-read immediately before editing; verify content landed via
  worktree-vs-HEAD diff, not commit hash (amends and swept-in staged files
  are normal). Long `bun test` runs can hang on in-flight churn — rerun
  clean before declaring failure. Scratch-port `EADDRINUSE` when a dev
  server restarts is usually another agent's instance winning the race —
  check who owns the port before killing anything. When a staged file
  requires another agent's still-untracked module (extraction moved a
  function there), that module must ride along or HEAD breaks.
- **One SSOT per shared surface artifact — never a hand-maintained twin.**
  Every hand-copied twin drifted within days (MCP `deck_explain` truncating
  `KIND_DOCS` without `typical`/`needs`; local `SetBuildResult`/`Bench`
  re-declarations; two `STATUS_LANG` copies that formed a web import cycle;
  stale tool/verb counts in README/deckctl.md). Rule: derive from the
  producer (`shared/types.ts` re-export, `KIND_DOCS` import, census test),
  and keep UI payload shapes, help text, and tool counts generated from
  their SSOT modules.
- **Pre-commit hooks BLOCK, and their failure output can be truncated.**
  Repo hook tuning lives in `.shell-config-hooks.conf` (per-file 800-line
  cap, block-at-100%). Sanctioned bypass for a legitimately huge commit:
  `GIT_SKIP_FILE_LENGTH_CHECK=1 GIT_ALLOW_LARGE_COMMIT=1` (say why in the
  commit body). Because blocked-commit output can be cut off mid-stream, a
  blocked commit can LOOK landed — after every commit confirm with
  `git log --oneline -1` + `git status`, never trust the exit chatter.
  The hook also validates the whole worktree, not just the staged set —
  a concurrent agent's mid-write WIP file (their TS error, a flaky MCP
  test) can fail your commit even though your staged files typecheck
  standalone; wait for their save to land and retry, don't debug their file.
- **Prose passes:** preserve em dashes and punctuation in shipped docs.
- **Scrub private identifiers before history-touching work.** When removing a
  private name (drive/volume/service) from the product, wipe every reference
  from code, docs, and stored app state — and don't name it in the commit
  message or replacement text either; history and diffs count as leaks.
- **Dependency bumps carry a ~5-day release-age floor** ("latest stable minus
  5 days") — too-fresh releases get held back to the next pass, and the gate
  is re-run fully after every bump.
- **Ship DOM-verified UI, not API-verified.** Every UI change is verified in
  the rendered DOM (CDP dump/screenshot against the live server) before
  push — screenshots show stale `dist/` or `color-mix` quirks, so the DOM
  dump is authoritative. Two-thirds UX law from the Sep 9 sweeps: data-heavy
  cards open with a plain-language VERDICT banner, then the fix-first work
  queue (worst first, each item names its `megadj`/`deckctl` fix command
  with a Copy button for handing the list to an agent), then raw detail.
  Every hand-rolled UX primitive was swapped for a headless lib:
  `@tanstack/preact-table`, `virtua`, `lucide-preact` (icons.tsx is a typed
  dispatcher), `fuse.js` (shared fuzzy module), `tinykeys` (⌘K palette);
  `@tanstack/preact-virtual` DOESN'T EXIST — `virtua` is the Preact pick.
  Web child content caps at 1240px for readable line lengths.

## What this repo is

megadj is a YouTube Music archiver (Bun/TypeScript CLI) feeding a shelf
master (archive-grade HDD, `library.shelf_drive`, default `SHELF1`) plus a
master + mirror pair of DJ USB drives that sync FROM the shelf. The shelf
migration (Sep 9 2026) copied the full `Contents/` + `PIONEER/` analysis
from the master stick — rsync WEDGES on macOS's fskit exFAT driver, so
per-dir tar-pipes with file-count resume checks are the proven method
(foreground slices; backgrounded runners get reaped and launchd is
TCC-blocked from `/Volumes`) — and a byte-level audit proved the shelf a
strict superset of both sticks (Unicode/case-compare artifacts produced
false "missing" counts once). The three-stick sweep the same day
(BANGERS + BOSEXY + empty) is now a command: **`megadj shelf-archive
[volume …]`** — drive(s) → shelf, additive, `._*`/junk-filtered,
NFC+casefold name matching, MD5-verified copies, divergent same-name rips
preserved as `<name> [<volume>]` twins (never overwrite — the shelf's
rekordbox DB references its own files), `--trashes --into F` for trash
rescue, `--deep` to MD5 same-size pairs (one stick had 291 same-size
different-bytes files — size alone is NOT coverage). Coverage rules:
`PIONEER/` (device DBs) is never walked; `PIONEER REC/` is. Process +
verification loop: `.claude/skills/shelf-intake/SKILL.md`; every sweep
auto-records a verdict row in the archive DB (`shelf_sweeps` — query with
`megadj shelf-sweeps`), so state lives in the DB, not just markdown. Volume
names are user-specific — examples use `DJMASTER`/`DJMIRROR`; override via
args, `config.toml`, or `USB_SYNC_MASTER`/`USB_SYNC_MIRROR`. Three named
sub-projects (one-liners in
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
  (`bun run mcp`, 34 tools). Surface registry: `docs/surface-parity.md`.
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
  integrity, parity); `deckctl explain` documents every job type and
  `deckctl help [term]` serves the UI glossary/tour (same SSOT as the
  tooltips — `cratedeck/shared/help.ts`, also `deck_help` over MCP).
- RB never reads art in WAVs (RIFF INFO has no art field) — ingest converts
  new WAVs → AIFF (`src/commands/wav-to-aiff.ts`); legacy WAVs are
  pointer-fixed via `tools/rb_art.py`. RB renders covers from
  `artwork_m/s.jpg` thumbnails — `ensure_artwork_file` generates all three.
  Research: `docs/rekordbox-wav-artwork.md`.
- TKEY is read on AIFF/MP3 only, and RB overwrites imported keys on analysis
  unless Key analysis is disabled (`docs/fulltags-roadmap.md` gauntlet).
- Safety: quit rekordbox before DB edits; never write drive DBs in place;
  never delete source files.
- **rekordbox's master DB now lives ON the shelf** (`/Volumes/SHELF1/PIONEER/
  Master/master.db` via Advanced → Database Management) — rekordbox won't
  open without SHELF1 attached, and exFAT + SQLite mid-write power-loss is
  the corruption risk; dated library backups (`rekordbox_bak_*.zip` in
  `~/Music/rekordbox/`) are treated as sacred. Bulk relink of relocated
  audio is Collection view → ⌘A → right-click "Relocate Lost Files" (the
  right-click is greyed in playlist/device views — the one-by-one trap).
  The legacy `YTMusic Liked` dump folder overlaps the artist folders
  (588 files; ~38% dupes) — dedupe is fingerprint-verified + move-to-
  archive only, never delete without explicit OK.

## CrateDeck invariants (all regression-tested — re-read before touching)

Architecture + wire-shape rules:

- `shared/types.ts` is the **leaf** of the import graph — it defines every
  cross-boundary wire type and imports nothing from `src/` (cycles there
  once forced `GIT_SKIP_HOOKS` on every commit). Verify:
  `bunx madge --circular --extensions ts,tsx cratedeck/src cratedeck/shared cratedeck/web`.
  **Madge follows type-only imports too — a type-only back-edge IS a cycle
  (Sep 9 sweep found 6).** Two rules keep the graph a DAG: (1) a wire type
  whose producer chain reaches `shared/types.ts` (anything importing
  `db.ts`/`fleet.ts`) is DEFINED canonically in `shared/types.ts` and the
  producer imports it back — never derived from that producer
  (`DriveImage` was the offender); (2) split-out implementation modules
  (`archive_similar.ts`, `archive_overview.ts`, `report_checks.ts`, …)
  type their parent-class/parent-input parameters against a leaf seam
  (`archive_types.ts` `ArchiveQuery`, `report_types.ts` `ReportInput`),
  never against the parent module — `ArchiveReader implements ArchiveQuery`
  verifies the seam at compile time.
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
- **A running job must never spin forever (Sep 8 "always spinning" sweep,
  regression-tested in `cratedeck/test/jobs-progress.test.ts`):** four
  independent defects each froze or lied about live jobs — (1) the ETA
  sampler pinned its rate baseline to the FIRST sample, so the ETA froze
  after 1s and flapped (fixed: `createEtaEstimator` re-bases the window
  every ≥1s sample; stalled window → `null`, honest unknown); (2)
  benchmark/checksum/scan legs had NO wall-clock bound and their 5s
  liveness heartbeat HID a wedged job from the phantom reaper forever
  (fixed: whole-job budget `job_timeout_min` + a stall watchdog in the
  reaper loop that watches the progress FRACTION — not `touched`, which
  log lines keep fresh — and kills a job stuck >`stall_timeout_min`);
  (3) the unwind forced `progress: 1` on cancelled jobs — a full green
  bar over unfinished work; (4) the dock treated every queued/running row
  as healthy live work — spinning header for a parked queue, a spinner
  with zero staleness signal, machine phase strings (`phase-2`), and
  `fmtEta` misused as "time ago". The dock now measures each row's
  staleness client-side (`_received` stamp set by `App`'s jobs fetch),
  warns amber before the server acts, and only spins while a job is
  genuinely `running`. Rule: **a watchdog fed by activity logs cannot
  catch a wedge that keeps logging — watch the progress fraction**.
- SSE `job` events fire up to ~4/s — `App` coalesces `refreshJobs` to ≤1/s,
  `DrivePage` throttles drive fetches to ≤1/2s. Jobs-refresh failures
  toast at most once per 30s (an outage would otherwise re-toast every
  second off the poll + reconnect loops).
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
- `FleetStore.sync` inserts playlist entries `OR IGNORE` — one duplicate
  row in a dirty drive snapshot (rekordbox can genuinely carry the same
  track twice in one playlist) once crashed the whole INSERT transaction,
  leaving all fleet tables permanently empty (regression-tested in
  `fleet.test.ts`).
- **Census/aggregation totals must come from `COUNT`, never from summing
  the displayed bucket list.** `skipCensus` once summed its LIMIT-clamped
  buckets, so totals undercounted whenever there were more distinct reasons
  than the limit (599 shown vs 602 true; regression-tested in
  `cratedeck/test/archive.test.ts`).
- Surface parity is enforced: a capability on one surface (deckctl / MCP /
  web) must exist on the others or carry an exemption row in
  `docs/surface-parity.md` §4 (`cratedeck/test/surface-parity.test.ts`).
  The web shell is now a three-product suite: Drives / GetDat / FullTags
  tabs under a megadj header, shared product chrome in
  `web/products/shared.tsx` (Verdict banner / ShareBar / Meter), styles
  split into per-concern sheets under `web/styles/`.
- `deckctl help [term|kind]` and `--help` work with the server DOWN —
  `help` reads `shared/help.ts` directly and must dispatch BEFORE
  `ensureServer`; `--help` prints to stdout with exit 0 (usage text is not
  an error — `usage()` to stderr + exit 2 stays for bad invocations), and
  an exact JOB-KIND match wins over a same-named glossary term
  (`help mirror` = the mirror job). The usage-text-syncs-with-dispatch
  census parses `PRE_SERVER_VERBS` too, and it already caught `stop`
  missing from usage.
- UI verification quirks: the Bun server serves the BUILT `web/dist` —
  screenshots of un-rebuilt bundles show stale UI; headless `color-mix`
  text can render all-accent while the DOM is correct (dump the DOM, don't
  trust the pixels); servers/child processes spawned in one shell call get
  reaped at call boundaries (relaunch via `deckctl status --json`'s
  auto-start or an `osascript` escape, then poll across calls).
- `apiPost` passes `FormData` through UNserialized (JSON.stringify of
  FormData → `{}` + JSON content-type silently broke photo upload);
  `InfoTip` has a `side` prop (right-placement) so rail tooltips don't
  clip against `overflow-y` rails; a preview `<img>` cache-buster must key
  off a save-changing value (`last_seen_at` never changes on photo save);
  `Verdict` accepts `"bad"` and the CSS tier must exist (`arch-verdict.bad`
  was a latent unstyled state); `Donut` takes `hasData` — "no report" and
  "report ran, 0% passed" must not share one dashed arc.

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
- Hardware-gated GitHub issues close as executable runbooks, not chat
  notes: `docs/runbooks/0*.md` carry the exact top-to-bottom commands to
  run when the drive mounts (`docs/usb-sync-log.md` seeds real incidents).
  "Open but armed" is a valid issue state when nothing code-side remains.
- Tools take volume names/paths from config — never hardcoded literals.
- **No one-time scripts in the repo.** If an operation was done by hand
  (ad-hoc python heredoc, /tmp script, throwaway merge loop), the deliverable
  is the REUSABLE command + its tests + the doc/skill update — the one-off
  is deleted, never committed. Sep 9 2026: the three-stick manual merge
  became `megadj shelf-archive` + 10 tests; the scratch scripts were
  removed the same day. If a sweep taught a trap, encode the trap in the
  command (junk filter, --deep, --trashes), not in a comment.
- Perf passes are QUANTIFIED: measure a baseline, then prove the saving
  (e.g. "≥20%") against it — never declare a pass done on vibes. Sep 8
  benchmark: full gate `bun run check:full` ~36s → 7.4s, `bun test` 385
  tests 32.3s → 6.5s (−80%) via `bun test --parallel=16` (workers
  subprocess-bound; 20 adds nothing) + splitting the
  `fulltags/test/analysis.test.ts` monolith per roadmap stage. On-disk
  I/O tuning needs COLD-CACHE numbers: the archive fits the page cache,
  so local harness reads measure cache at GB/s — 10× off real USB truth;
  `sudo purge` needs a TTY password, so plan for it (or borrow a machine
  where the drive data doesn't fit RAM).
- knip's "remove me" config hints LIE — its `ignoreBinaries`/
  `ignoreDependencies` entries are load-bearing (removing them produces 6
  real unlisted-dep findings). Verified and left byte-identical; don't
  "fix" the config into a broken gate.
- Hermetic CLI tests invoke `process.execPath` (real bun binary), not the
  user's `bun` shell shim — the shim chokes on empty-string args
  (`_bp_set: bad array subscript`), a local env artifact that once faked 2
  test failures.

## Local-only files

- `(local ops log)` and previous private versions of this file are
  **gitignored** — personal library details never get committed. Back up
  copies outside the repo.
