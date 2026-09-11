# Agent Playbook — full detail behind AGENTS.md

`AGENTS.md` is the compressed, always-loaded invariant list. This file holds
the full war stories, mechanics, and numbers behind each rule — nothing was
dropped in the Sep 10 compression, it moved here. Sections mirror AGENTS.md.

## Ground-rule mechanics

- **Guarded JSON parsing.** `driveBadges` runs on every `/api/status` +
  `/api/drives` request — one unguarded `JSON.parse` of a persisted blob
  (`last_snapshot_json`, `verify_report_json`, `data_json`) 500s the whole
  drive rail. `parseSnapshotJson` in `cratedeck/shared/badges.ts` makes the
  failure a visible state (badge, `corrupt:true` payload, logged boundary).
  Corrupt persisted JSON can never read as success — and never crashes hot
  paths either. Regression-tested in `cratedeck/test/badges.test.ts`.
- **Boundary numbers.** `MEGADJ_ART_MAX=""` → `Number("")` is `NaN` →
  `slice(0, NaN)` processed nothing while "succeeding" — hence the
  `Number.isFinite` gate. `Number("")` is also `0`, so CLI numeric flags go
  through `nonNegOpt`: invalid input (`abc`, empty) returns undefined, guards
  fire, command exits 2 with zero work (`src/commands/numeric-options.test.ts`).
- **SSOT twins that drifted.** MCP `deck_explain` truncated `KIND_DOCS`
  without `typical`/`needs`; local `SetBuildResult`/`Bench` re-declarations;
  two `STATUS_LANG` copies formed a web import cycle; stale tool/verb counts
  sat in README/deckctl.md across 9 files. Census tests must DERIVE expected
  strings from source and assert exact equality — a `>= N` floor plus
  hardcoded strings passed while the counts were stale (root-fixed in
  `cratedeck/test/surface-parity.test.ts`; mutation-verify by reverting one
  count and watching the census fail). Assertions stay whitespace-tolerant
  (`\|\s+N verbs\s+\|`) — a formatter padding the markdown table cells once
  false-failed the census; the COUNT stays exact.
- **Pre-commit hooks.** Repo hook tuning lives in `.shell-config-hooks.conf`
  (per-file 800-line cap, block-at-100%). Sanctioned bypass for a legitimately
  huge commit: `GIT_SKIP_FILE_LENGTH_CHECK=1 GIT_ALLOW_LARGE_COMMIT=1` (say
  why in the commit body). Because blocked-commit output can be cut off
  mid-stream, a blocked commit can LOOK landed — after every commit confirm
  with `git log --oneline -1` + `git status`, never trust the exit chatter.
  The hook also validates the whole worktree, not just the staged set — a
  concurrent agent's mid-write WIP file (their TS error, a flaky MCP test)
  can fail your commit even though your staged files typecheck standalone;
  wait for their save to land and retry, don't debug their file.
- **DOM verification.** Screenshots show stale `dist/` or `color-mix` quirks,
  so the CDP DOM dump is authoritative. Two-thirds UX law from the Sep 9
  sweeps: data-heavy cards open with a plain-language VERDICT banner, then
  the fix-first work queue (worst first, each item names its `megadj`/
  `deckctl` fix command with a Copy button for handing the list to an agent),
  then raw detail. `icons.tsx` is a typed dispatcher over `lucide-preact`;
  `fuse.js` is the shared fuzzy module; `tinykeys` drives the ⌘K palette.

## Shelf & archive detail

- **Shelf migration (Sep 9 2026)** copied the full `Contents/` + `PIONEER/`
  analysis from the master stick. rsync WEDGES on macOS's fskit exFAT driver,
  so per-dir tar-pipes with file-count resume checks are the proven method
  (foreground slices; backgrounded runners get reaped and launchd is
  TCC-blocked from `/Volumes`). A byte-level audit proved the shelf a strict
  superset of both sticks — Unicode/case-compare artifacts had produced false
  "missing" counts before.
- **The three-stick sweep** the same day (BANGERS + BOSEXY + empty) became
  `megadj shelf-archive [volume …]`. `--deep` exists because one stick had
  291 same-size different-bytes files — size alone is NOT coverage.
- fskit exFAT also loses files on whole-directory `shutil.move` across dirs
  (an empty dir arrived; 8 MD5-verified files gone) — per-file moves with
  destination MD5 re-verify only.
- Quarantine and staging dirs live at SHELF ROOT, never inside `Contents/` —
  auto-relocate scans `Contents/` and will chase quarantined files.
- Divergent same-name rips are preserved as `<name> [<volume>]` twins, never
  overwritten — the shelf's rekordbox DB references its own files.

- **Prose passes:** preserve em dashes and punctuation in shipped docs.

## Rekordbox detail

- **Master DB on the shelf.** rekordbox won't open without SHELF1 attached;
  exFAT + SQLite mid-write power-loss is the corruption risk. Bulk relink of
  relocated audio is Collection view → ⌘A → right-click "Relocate Lost
  Files" (the right-click is greyed in playlist/device views — the
  one-by-one trap).
- **The `YTMusic Liked` dump** overlaps the artist folders (588 files; ~38%
  dupes) — dedupe is fingerprint-verified + move-to-archive only, never
  delete without explicit OK. Auto-relocate RENUMBERS and scatters dump
  files into artist dirs, so "dead row" lists built on exact-numbering
  matching produce false kills — hunt renumbered/scattered twins before
  declaring anything gone (real mixes were rescued that way).
- **Measure before blaming bandwidth.** `/bin/dd` read SHELF1 at 62 MB/s
  (USB3-class; Homebrew `dd` is shim-blocked) — a "slow drive" was actually
  Auto Relocate's per-track full-volume scans plus a bad/USB-2.0 port, fixed
  by the user's port swap. Auto Relocate matches stale stored paths first
  (slow walk per unresolved row on exFAT — the 6-hour relocate) while manual
  browse matches by filename anywhere and is fast.
- **Whole-table existence check.** A prefix-scoped post-check hid 351 broken
  rewrites and produced two false "done" reports (Sep 10) — that cost the
  user's trust; the final whole-table existence check left only the rows
  genuinely gone from disk. Hence: after ANY DB path rewrite, verify EVERY
  row's file exists on disk, never just rows matching a prefix pattern.
- **The shelf device tree.** The shelf's `PIONEER/rekordbox/` tree is the
  migrated old stick's library (identity `DJLIBRARYM`, 3,926 rows) and NO
  player ever reads the shelf — its EMPTY state is correct, "Synchronize" on
  the shelf's device entry is a decoy: it DID write (OneLibrary 3,053→3,926
  = the legacy tree's count), which looks wrong but is the tree reconciling
  to its old-stick identity. The tree view's 3,053 was the true master count
  all along. Before chasing any count, ask which DB/tree the number comes
  FROM. Shelf-tier pdb/OneLibrary parity is informational, never a gate;
  verify + preflight handle this via `--shelf-drives` (usb_verify.py) and
  role-aware dual-db (preflight.ts/verify_report.ts); the Drives tab marks
  the card "master library lives here · sticks sync from this". The
  role-aware check matrix lives ONCE in `cratedeck/shared/check_matrix.ts`
  (`CHECK_APPLIES`, `checkApplies`, `TIER_EXPLANATION`); a refactor once
  dropped the `driveRole` arg and the `--shelf-drives` flag and shelf drives
  silently re-failed — the derived census in `check-matrix.test.ts` catches
  that class. Gig-stick concerns (players, grids/ANLZ, mirror parity, pdb
  parity, changed-since-verify, speed floor) are OMITTED on shelf-role
  drives, never failed; space, junk, checksums, artwork, and verify still
  apply (a FAILED verify shows on every tier until re-run — only its
  freshness sub-verdict is gig-tier).
- **`rb-fix-paths` matching ladder:** exact → NFC+casefold → unique basename
  → strip `-N` copy suffixes → 20-char prefix → largest twin. Encodes the
  Sep 9/10 repair saga; flow: `.claude/skills/rekordbox-library-repair/SKILL.md`.

## CrateDeck detail

- **Import-graph cycles once forced `GIT_SKIP_HOOKS` on every commit.**
  `shared/types.ts` is the leaf; verify with `bunx madge --circular
  --extensions ts,tsx cratedeck/src cratedeck/shared cratedeck/web`. Madge
  follows type-only imports too — a type-only back-edge IS a cycle (Sep 9
  sweep found 6). Wire type whose producer chain reaches `shared/types.ts`
  (anything importing `db.ts`/`fleet.ts`) is DEFINED canonically there and
  the producer imports it back — never derived from that producer
  (`DriveImage` was the offender). Split-out implementation modules
  (`archive_similar.ts`, `archive_overview.ts`, `report_checks.ts`, …) type
  parent-class/parent-input parameters against a leaf seam (`archive_types.ts`
  `ArchiveQuery`, `report_types.ts` `ReportInput`), never against the parent
  module — `ArchiveReader implements ArchiveQuery` verifies the seam at
  compile time.
- **Web shape drift shipped runtime bugs three-in-one-tab** — components
  re-declaring server payload shapes locally. The fix: derive from
  `shared/types.ts` re-exports (`ArchiveIngestStatus`, `FleetDiff`,
  `SearchResult`, …) so drift fails `typecheck`.
- **The Sep 8 "always spinning" sweep** (regression-tested in
  `cratedeck/test/jobs-progress.test.ts`) found four independent defects:
  (1) the ETA sampler pinned its rate baseline to the FIRST sample, so ETA
  froze after 1s and flapped (fixed: `createEtaEstimator` re-bases the
  window every ≥1s sample; stalled window → `null`, honest unknown);
  (2) benchmark/checksum/scan legs had NO wall-clock bound and their 5s
  liveness heartbeat HID a wedged job from the phantom reaper forever
  (fixed: whole-job budget `job_timeout_min` + a stall watchdog in the
  reaper loop that watches the progress FRACTION — not `touched`, which log
  lines keep fresh — and kills a job stuck >`stall_timeout_min`);
  (3) the unwind forced `progress: 1` on cancelled jobs — a full green bar
  over unfinished work; (4) the dock treated every queued/running row as
  healthy live work — spinning header for a parked queue, a spinner with
  zero staleness signal, machine phase strings (`phase-2`), and `fmtEta`
  misused as "time ago". The dock now measures each row's staleness
  client-side (`_received` stamp set by `App`'s jobs fetch), warns amber
  before the server acts, and only spins while a job is genuinely running.
  Rule: **a watchdog fed by activity logs cannot catch a wedge that keeps
  logging — watch the progress fraction**.
- **SSE/stream specifics.** Bun kills idle SSE streams ~10s — the heartbeat
  once stranded a finished verify as "running 0%" forever. SSE `job` events
  fire up to ~4/s; jobs-refresh failures toast at most once per 30s (an
  outage would otherwise re-toast every second off the poll + reconnect
  loops). `jobs.ts drain()` must append only new stdout bytes. Agent notes
  ARE events — the 2000/drive event cap bounds them automatically.
- **FleetStore.sync** inserts playlist entries `OR IGNORE` — one duplicate
  row in a dirty drive snapshot (rekordbox can genuinely carry the same
  track twice in one playlist) once crashed the whole INSERT transaction,
  leaving all fleet tables permanently empty (`cratedeck/test/fleet.test.ts`).
- **Census totals.** `skipCensus` once summed its LIMIT-clamped buckets, so
  totals undercounted whenever there were more distinct reasons than the
  limit (599 shown vs 602 true; `cratedeck/test/archive.test.ts`).
- **deckctl help details.** `help`/`--help` work with the server DOWN —
  `help` reads `shared/help.ts` directly and must dispatch BEFORE
  `ensureServer`; `--help` prints to stdout with exit 0 (usage text is not
  an error — `usage()` to stderr + exit 2 stays for bad invocations), and
  an exact JOB-KIND match wins over a same-named glossary term (`help
  mirror` = the mirror job). The usage-text-syncs-with-dispatch census
  parses `PRE_SERVER_VERBS` too, and it already caught `stop` missing from
  usage.
- **UI quirks.** `apiPost` passing `FormData` through UNserialized matters:
  `JSON.stringify(FormData)` → `{}` + JSON content-type silently broke photo
  upload. A preview `<img>` cache-buster must key off a save-changing value
  (`last_seen_at` never changes on photo save). `Verdict` accepts `"bad"`
  and the CSS tier must exist (`arch-verdict.bad` was a latent unstyled
  state). `Donut` takes `hasData` — "no report" and "report ran, 0% passed"
  must not share one dashed arc. `InfoTip` has a `side` prop so rail
  tooltips don't clip against `overflow-y` rails. Headless
  `color-mix` text can render all-accent while the DOM is correct. Servers/
  child processes spawned in one shell call get reaped at call boundaries —
  relaunch via `deckctl status --json`'s auto-start or an `osascript` escape,
  then poll across calls.

## FullTags detail

- Analysis gates: key passed at 80.7%; BPM phase-lock and the genre head
  failed and are blocked — batch tag writes stay BLOCKED until re-gate.
- Booth fleet defaults: on = XDJ-XZ + CDJ-3000 + 2000NXS2, plain 2000 off.
- **No one-time scripts in the repo.** If an operation was done by hand
  (ad-hoc python heredoc, /tmp script, throwaway merge loop), the deliverable
  is the REUSABLE command + its tests + the doc/skill update — the one-off
  is deleted, never committed. If a sweep taught a trap, encode the trap in
  the command (junk filter, `--deep`, `--trashes`), not in a comment. The
  Sep 9 three-stick manual merge is the precedent: it became
  `megadj shelf-archive` + 10 tests, scratch scripts removed same day.

## Process & environment detail

- **Sep 8 perf benchmark:** full gate `bun run check:full` ~36s → 7.4s,
  `bun test` 385 tests 32.3s → 6.5s (−80%) via `bun test --parallel=16`
  (workers subprocess-bound; 20 adds nothing) + splitting the
  `fulltags/test/analysis.test.ts` monolith per roadmap stage.
- **Cold-cache rule:** the archive fits the page cache, so local harness
  reads measure cache at GB/s — 10× off real USB truth; `sudo purge` needs a
  TTY password, so plan for it (or borrow a machine where the drive data
  doesn't fit RAM).
- **knip's "remove me" config hints LIE** — its `ignoreBinaries`/
  `ignoreDependencies` entries are load-bearing (removing them produces 6
  real unlisted-dep findings). Verified and left byte-identical; don't "fix"
  the config into a broken gate.
- **Hermetic CLI tests** invoke `process.execPath` (real bun binary), not
  the user's `bun` shell shim — the shim chokes on empty-string args
  (`_bp_set: bad array subscript`), a local env artifact that once faked 2
  test failures. Tracked upstream in webuildstuffio/shell-config.
- **The local `uv` shim intercepts bare `python3`** — `python3 -c` prints uv
  usage instead of running the code — so one-liners need `/usr/bin/python3`
  (or `uv run`). Also tracked in webuildstuffio/shell-config.
- **Sticky-exit tests** must reset `process.exitCode` after the assertion —
  bun test reports the PROCESS exit code, so leaving `exitCode = 1` set
  (shelf-archive's no-shelf hard-error test did) made any suite including
  that file exit 1 with 0 failed tests, and the pre-commit hook blocked on a
  green suite (documented + reset in `src/commands/shelf-archive.test.ts`).
