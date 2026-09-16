# AGENTS.md — megadj

This file contains only rules and traps. Product detail belongs in
[`docs/`](docs/) and the full incident history is in
[`docs/agent-playbook.md`](docs/agent-playbook.md).

## Non-negotiables

- English only. Product decisions follow [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md).
- macOS/Pioneer only; no CI. Before pushing: `bun run check && bun test`.
 Type coverage is a hard 100%: `bun run check:full`. `check` also runs knip
 and the web vite build; `check:full` additionally runs the Python gates
 (`lint:py` ruff + `typecheck:py` mypy strict over `cratedeck/python` and
 `tools/*.py`, config in `pyproject.toml`), coverage lives in `test:coverage`,
 and `test:py` runs the Python unittests (`tools/*_test.py`) — part of
 `check:full`, not `bun test`.
- Pre-commit runs STAGED-SCOPED tests (`SC_HOOK_TEST_SCOPE=staged` in
  `.shell-config-hooks.conf`): only test files in packages touched by the
  staged paths (root `src/`/`test/` → root tests; `cratedeck/*` → cratedeck
  tests). That makes untracked WIP test files from concurrent agents
  invisible to your commit. The full suite runs automatically at PRE-PUSH
  (shell-config generic fallback: no `tests/run_all.sh` + bun repo →
  `bun test --parallel=16`; failure blocks, timeout warns) — still run
  `bun test` yourself before pushing if you want the result earlier. The
  LOC-budget pre-commit gate (`.githooks/pre-commit` + `tools/loc-budget.ts`)
  requires every commit to be a net code REDUCTION in tracked code until 75k
  LOC; it never blocks on self-error (advisory only) and bypass is deliberate
  + audit-logged (`MEGADJ_LOC_BYPASS='reason'`).
- Never use `git add -A`; preserve concurrent work. Re-read before editing and
  verify the worktree diff, not only a commit hash. Before committing, check
  for another agent's PRE-STAGED files — a mid-refactor staged snapshot that
  rides along breaks the pushed build; rebuild the commit path-scoped if so.
  Concurrent-agent sweeps can silently revert landed refactors; the census
  tests (`src/apply-gate-census.test.ts`, `src/boundary-*-census.test.ts`)
  are the tripwire — a clobbered fix gets re-committed immediately.
- No bare production `catch {}` or `.catch(() => {})`. Boundary `JSON.parse`
  uses a guarded parser and exposes failure. Gate numeric boundaries with
  `Number.isFinite`; CLI numeric options use `nonNegOpt` (bad input: exit 2,
  zero work). Keep the reviewed inventories in
  `src/boundary-number-census.test.ts` and
  `src/boundary-json-census.test.ts` green when either call surface changes.
- Strict TypeScript is live: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noUncheckedSideEffectImports`, and
  `allowUnreachableCode:false`. Oxlint and formatting are part of the gate.
  Never run repo-wide `oxlint --fix`/sed rewriters unattended: they have
  corrupted template literals across the worktree (one run landed on
  main) — scope the pass and diff the result before staging.
- One source of truth per shared surface. Derive types, job lists, help,
  counts, and census strings from producers; never maintain hand-copied twins.
- Do not commit private identifiers, local paths, stored state, or secrets.
  After every commit verify `git log --oneline -1` and `git status`.
- No dependency bumps without the release-age floor and a full gate.

## Core workflow

`megadj sync` downloads; `megadj ingest` imports; `megadj fetch`/`audit`
enriches and verifies; `megadj shelf-sync` sends archive → shelf;
`megadj shelf-archive` sends drive → shelf. Every command supports `--json`
with one summary object on stdout and a meaningful exit code. The set-builder
product is **MegaSet** — verb `megadj megaset`; the `setbuild` alias is
retired (unknown-command since #56): one name everywhere, no shims.

The shelf is the archive master. `shelf-archive` is additive, junk-filtered,
NFC/casefold matched, MD5 verified, and preserves divergent same-name files.
Use `--deep` for byte comparison and `--trashes --into F` for flat trash
intake. Quarantine/staging directories belong at the shelf root, never under
`Contents/`; never walk `PIONEER/`, but do walk `PIONEER REC/`.

ExFAT rsync can wedge. Use the proven per-directory tar-pipe/file-count
resume flow in the shelf-intake skill. Move files individually and verify the
destination hash; whole-directory moves can lose files.

Distrust extensions at intake: pool rips ship MP4/AAC audio wearing a
`.mp3` name (tag writer picks the mp3 muxer → exit 234, and Pioneer
chokes on the container). `drop`'s container-truth probe renames to the
true `.m4a` before any writer runs. Per-file failures quarantine and
report; one bad file never kills a batch run. AIFF tag writes are
format-specific too: never `ID3(p).save()` on AIFF — it prepends a raw
ID3 chunk over the FORM header (silent corruption). Use `AIFF(p)`; if a
corrupt file surfaces, scan for the buried `FORM` offset and strip the
junk prefix (audio bytes survive; the embedded ID3 chunk keeps tags).

Distrust SoundCloud genres too: `yt-dlp` search metadata returns a
numeric SC genre ID, never a name. Both write points (`art-sources.ts`
hit filter, `applyScGenre`) refuse numeric/`Music` genres. SC search
hits also pass a HARD ARTIST GATE (`scoreScHits`, mirrors Beatport's
`scoreBpHit`): query artist ≥3 chars must appear in the hit's uploader,
or the hit is dropped — a title-overlap win from an unrelated channel
wrote its genre once. Keep the yt-dlp `COL|` destructure aligned to the
REAL 6-field layout (title|url|uploader|thumbs|genre|timestamp): a
one-slot drift silently killed SC genre+year for months. Never mint a
placeholder genre: `?? "Music"` is banned — unknown stays null (the
~154 legacy `Music` rows are #61's unstrand remainder). The
`sc_genre_ids` cache was dropped 2026-09-15 (#108 — ghost table, dated
backup + census); never resurrect it without owning its writer.
Every master.db write must hard-gate on rekordbox being closed — RB's
in-memory state silently overwrites external edits on quit; verify with
a delayed re-read, not just a successful commit. Audio analysis decodes
compressed containers IN-PROCESS via PyAV and feeds raw samples to the
model APIs (`Audio2Beats(signal, sr)`); never reintroduce the ffmpeg
temp-WAV-bridge beside originals (orphan leak class, drift-prone twins).

`shelf-dupescan` judges duplicates by fingerprint, never by name; keep its
fpcalc parser base64url-complete (`-`/`_`) — a truncating regex silently
poisons the whole `shelf_fingerprints` cache with colliding prefixes. One
md5 seam repo-wide (`src/shelf/md5-cli.ts`, retries transient spawn
failures); never hand-roll a second spawn of it. Never persist a null
fingerprint: guard every `DupFpCache.put` on a non-null fp — a transient
fpcalc miss written to the ledger poisons the row forever.

Ingest batches live inside the archive music directory. Re-ingesting the same
batch is a safe no-op, and each dump gets its own fresh folder. The hygiene
engine owns the listen-first guard: `quality-diff`, `oddball`, and `ear-check`
findings cannot be batch-confirmed from any spoke. RB auto-writes
(`Write to master.db`) are `rb-import`'s job only: rekordbox closed, dated
backup, whole-table verify — never hand-run while the app is open, and
`Write to master.db` tool calls must refuse while rekordbox runs.
Rekordbox is the source of truth for the collection, never for archive
bytes: unreferenced files get fingerprint-proven and quarantined for
review, not deleted. Rekordbox's Energy column is engine-computed and
unwritable; only Comment carries derived energy, never BPM.

## Rekordbox and hardware safety

- Quit rekordbox before DB work. Never write drive DBs in place or delete
  source files. Dated `~/Music/rekordbox/rekordbox_bak_*.zip` backups are
  sacred.
- The master DB is `/Volumes/SHELF1/PIONEER/Master/master.db` by default;
  configured volume names always win over examples. Pass DB paths
  positionally to Python seams and verify every row's file exists after any
  path rewrite. The local `~/Library/Pioneer/rekordbox/master.db` is stale.
- CrateDeck reads scratch copies of device DBs and refuses while rekordbox is
  running. Shelf-tier empty `PIONEER/rekordbox/` is correct; do not export to
  the shelf. Role-aware checks come only from
  `cratedeck/shared/check_matrix.ts`.
- The playing USB (`flip-master`) is user-managed: never sync, export, or
  write playlists/DB state to it — agents touch only SHELF1; the user stages
  USB content himself.
- Import order is `megadj shelf-sync`, then drag from the shelf volume, never
  from local staging. WAV artwork is unsupported by rekordbox: ingest converts
  WAV → AIFF. TKEY is reliable on AIFF/MP3 and RB analysis can overwrite it.
- Every drive carries two rekordbox libraries: `export.pdb` (legacy — the
  only one hardware players read) and the `OneLibrary` master. A green
  master DB does not mean hardware sees the change: re-export after
  imports/relocations, and read verify's dual-db mismatch as an export
  gap (fail on gig sticks, informational on shelf tier).

## CrateDeck invariants

- `cratedeck/shared/types.ts` is the import leaf. Keep web payloads derived
  from it and run the documented madge cycle check when changing boundaries.
- Keep snapshot/checksum work async; only physical external hardware passes
  `detect.ts`. Unknown-only checks are never healthy; bitrot requires real
  checksum results.
- API legs have longer client deadlines, SSE has a heartbeat/reaper, and UI
  coalesces job events. Caps are 20 snapshots and 2,000 events per drive.
- Jobs watch progress fraction, not log activity. Every leg has a wall-clock
  budget; cancellation never forces progress to 1. `setJobProgress` is
  tri-state (`undefined` keep, `null` clear).
- `deckctl help` works with the server down. `--help` is stdout/exit 0.
  `deckctl`/MCP/web capabilities need a twin or an explicit row in
  [`docs/surface-parity.md`](docs/surface-parity.md). Surface-parity census
  strings and command/symbol names are test-pinned to source: rename
  interface identifiers in docs and code in the SAME pass or tests break.
  Hover cards are portal rendered through `tipPlace.ts`, never clipped CSS
  descendants.

## FullTags invariants

- `setFileTags` and `writePatchSync` stay synchronous; do not spawn Bun to
  bridge sync work. Writers are format-specific: mutagen for AIFF/WAV art and
  AIFF tags, ID3v2.3 for MP3, and atomic temp-file replacement.
- Analysis lives in DB ledgers until its write gate passes. Positive ONNX
  labels come first except `mood_party`; saturated heads fail loudly. Audit
  requires mood + energy and reruns are idempotent.
- Booth compatibility is data-driven by `[booth].fleet`/
  `MEGADJ_FLEET`; `player-compat.ts` and `booth-text.ts` enforce the selected
  fleet. `megadj booth-fix` proposes by default.

## Documentation and local state

- Docs changes go through the docs audit before pushes. Dated docs are
  snapshots; completed work gets a status header and shipped marker. State
  belongs in the DB, not hand-maintained markdown.
- Keep this file short and durable: record rules, invariants, and failure
  traps only. Do not embed volatile file trees, counts, session notes, or
  duplicated product detail; link to the owning document instead.
- GitHub is the roadmap SSOT: issues own WHAT/priority/status; docs keep
  WHY, measured numbers, and safety gates. The former `ideas.md` /
  `roadmap-index.md` mirrors are archived (`docs/archive/`) — never
  resurrect hand-built roadmap mirrors; source issues from PRDs/plans/
  audits, not `ideas.md` (least-authoritative — its issues get closed as
  rejected).
- `tokensave` MCP is rooted per project (`tokensave serve -p <root>` in
  `~/.cursor/mcp.json`); results citing another workspace (folio-app) mean
  the server is mis-rooted — fix the root flag, never the index; its
  analysis tools reject a second project's `graph_root`.
- No PR flow: work lands as direct pushes to `main`; the review target is the
  landed-but-unreviewed commit range (branch-review audit), not open PRs.
- For GitHub work, use one `type:*`, one `priority:*`, and one `effort:*`
  label per issue. Bug fixes require a reproducer/regression test, local
  verification, and an evidence-based close; docs issues close only when the
  documented outcome is live and cross-links validate.
- This repo is a MegaMem workspace (`megadj`): every tracked `*.md` is indexed
  (stella-400m via the hub embed server) and auto-reindexed ~2s after edits —
  use `megamem search "<query>"` (or MCP `search` with `workspace: "megadj"`)
  before grepping docs by hand, and never re-index manually. Config:
  `.megamem/megadj/search.toml` (gitignored); hub alias lives in the megamem
  repo's `megamem.toml` — do not hand-edit either.
- No one-off scripts in the repo. Encode safety in reusable commands, tests,
  and skills. Hardware-gated work ends as an executable runbook.
- Cue surfaces have OPPOSITE conventions: XML `POSITION_MARK Num="0..7"` =
  hot cue / `Num="-1"` = memory, but the collection DB `djmdCue.Kind` is
  `1` = hot cue, `0` = memory cue (pads read the DB side). Verify with a
  hand-authored reference before any cue write path ships. See
[`docs/fulltags/intake-cue-postmortem.md`](docs/fulltags/intake-cue-postmortem.md) F4/F1.
- Playlist rows (`djmdPlaylist`) and `masterPlaylists6.xml` are twins: write
  both or neither, through one seam. Missing XML nodes = "Playlist not found"
  warnings and playlists that vanish on RB rebuild.
- Classifying files on ExFAT: prefilter by size/duration/name BEFORE hashing.
  A full-volume MD5 pass costs ~50 minutes; a prefiltered one, seconds.
- Rekordbox playlist organization: ONE playlist per dated intake batch
  (`YYYY-MM-DD intake`), all grouped under `DJ-Imports`; never genre
  playlists.
- Hot cues: max 8 per track (8 pads on supported gear), semantically placed
  (phrase/chorus/drop); pads require clickable hot cues (`djmdCue.Kind = 1`).
- Track genres come from real sources
  (SoundCloud/Beatport/Bandcamp/Hypeddit); the AI genre fallback stays opt-in,
  off by default — a missing genre remains an honest gap, never a guess. No
  hand-labeling pass exists by owner policy (2026-09-15): the product stays
  fully automated; genre coverage work is automation-side only.
- FullTags comment format is `Key · Energy · Mood` (Camelot key, E-score,
  top ONNX moods); BPM never enters the comment — it has its own RB column.
- ID3 genre frames are unreliable and the pool ecosystem is worse: numeric
  SC genre IDs leak into tags and junk like "edits/bootlegs" dominates
  SoundCloud sourcing. Store curated genres in the archive ledger; never
  trust the tag frame as a genre source.
- Two DBs, two roles: the SHELF1 `master.db` is the collection SSOT;
  `archive.db` is megadj's pipeline ledger (FullTags/mood/cue results,
  `shelf_fingerprints`),   not a collection copy — never
  present ledger coverage as library size. Decompose ledger cohorts before
  quoting any archive.db number: unlabeled rows split into sync-pending
  (liked-videos queued, never downloaded), skipped-not-music, rekordbox
  intake, and deleted/gone ledger-only rows — the actionable population is
  far below the raw row count. Disk-file counts on the shelf
  (incl. quarantine/variants) always exceed rekordbox DB rows; explain
  deltas by provenance (UnknownArtist residue, dedup orphans), never
  report the two counts as the same population.
