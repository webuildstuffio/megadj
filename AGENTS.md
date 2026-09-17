# AGENTS.md — megadj

Rules and traps only. Product detail: [`docs/`](docs/README.md); full incident
history: [`docs/agent-playbook.md`](docs/agent-playbook.md).

## Non-negotiables

- English only. Product decisions follow [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md).
  macOS/Pioneer only; no CI; no PR flow — direct pushes to `main`.
- Gates before push: `bun run check && bun test`. Hard 100% type coverage:
  `bun run check:full` (adds ruff + mypy strict over `cratedeck/python` and
  `tools/*.py`, plus `tools/*_test.py`). `check` = tsc + oxlint + format +
  knip + web vite build.
- Pre-commit runs STAGED-SCOPED tests (untracked WIP from concurrent agents is
  invisible); the full suite runs at PRE-PUSH against the SHARED worktree —
  another agent's red WIP blocks your push; don't `--no-verify` over it. LOC
  budget: net code reduction per commit until 75k LOC (advisory on self-error;
  bypass `MEGADJ_LOC_BYPASS='reason'`, audit-logged).
- Never `git add -A`; preserve concurrent work. Re-read before editing; check
  for others' PRE-STAGED files before committing (rebuild path-scoped if so);
  verify `git log --oneline -1` + `git status` after every commit. The census
  tests (`src/apply-gate-census.test.ts`, `src/boundary-*-census.test.ts`) are
  the tripwire for silently reverted refactors — re-commit a clobbered fix.
  Never pipe `git commit` through `| tail`/`| head`: a blocked commit's
  nonzero exit code is masked by the pipe and a hooked block looks landed
  (redirect to a file, then read it). Oversized commits need
  `GIT_ALLOW_LARGE_COMMIT=1` (42-file diet split d02eb55).
- No bare `catch {}` / `.catch(() => {})`. Boundary `JSON.parse` uses a guarded
  parser; gate numerics with `Number.isFinite`; CLI numeric options use
  `nonNegOpt` (bad input → exit 2, zero work). Keep
  `src/boundary-number-census.test.ts` and `src/boundary-json-census.test.ts`
  green when either call surface changes.
- stdout is a boundary: JSON via the awaited seams (`emitJson` deckctl,
  `writeJson` megadj CLI) — never raw `console.log(JSON.stringify)` (pipe-EOF
  truncation) or `Bun.write(Bun.stdout, "")`; drain with
  `process.stdout.write("")`.
- Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noUncheckedSideEffectImports`, `allowUnreachableCode:false`. Never run
  repo-wide `oxlint --fix`/sed rewriters unattended (they corrupted template
  literals on main once). Lizard CCN hotspots are ghosts here — span-verify
  against real `function` boundaries before refactoring.
- One source of truth per shared surface: derive types, job lists, help,
  counts, census strings from producers — never hand-copied twins.
- No private identifiers, local paths, stored state, or secrets in commits.
  No dependency bumps without the release-age floor + full gate.
- No one-off scripts: encode safety in reusable commands, tests, skills.

## Workflow map

`sync` download · `ingest` import · `fetch`/`audit` enrich + verify ·
`shelf-sync` archive→shelf · `shelf-archive` drive→shelf · `megaset` set-builder
(`setbuild` alias retired, #56) · `deckctl`/MCP/web = CrateDeck. Every command:
`--json` (one summary object, meaningful exit code).

## Shelf and intake

- The shelf is the archive master. `shelf-archive`: additive, junk-filtered,
  NFC/casefold, MD5-verified, preserves divergent same-name files; `--deep` for
  byte compare; `--trashes --into F` for trash intake. Quarantine/staging at
  the shelf root, never under `Contents/`; never walk `PIONEER/`, do walk
  `PIONEER REC/`.
- Whole-volume ExFAT rsync wedges — never use it; per-directory tar-pipe /
  file-count resume (shelf-intake skill). Move files individually and verify
  the destination hash; whole-directory moves can lose files.
- Distrust extensions: MP4/AAC audio wears `.mp3` names (muxer exit 234);
  `drop`'s container-truth probe renames to the true `.m4a`. Per-file failures
  quarantine and report — one bad file never kills a batch.
- Never `ID3(p).save()` on AIFF (prepends a raw ID3 chunk over FORM — silent
  corruption); use `AIFF(p)`. Buried-FORM recovery strips a junk prefix; audio
  bytes survive.
- Ingest batches live inside the archive music dir; re-ingesting a batch is a
  safe no-op; each dump gets a fresh folder. On ExFAT, prefilter by
  size/duration/name BEFORE hashing (full-volume MD5 ≈ 50 min).
- The hygiene engine owns the listen-first guard: `quality-diff`, `oddball`,
  `ear-check` findings cannot be batch-confirmed from any spoke.
- `shelf-dupescan` judges duplicates by fingerprint, never by name; keep its
  fpcalc parser base64url-complete (a truncating regex poisons the whole
  `shelf_fingerprints` cache); guard every `DupFpCache.put` on non-null
  fp (a persisted null poisons the row). One md5 seam
  (`src/shelf/md5-cli.ts`) — never hand-roll a second spawn.

## Genres

- Real sources only (SoundCloud/Beatport/Bandcamp/Hypeddit); AI fallback is
  opt-in, off by default; missing genre = honest gap, never a guess. No
  hand-labeling pass exists (owner policy, 2026-09-15).
- `yt-dlp` SC metadata returns numeric genre IDs: both write points
  (`art-sources.ts` hit filter, `applyScGenre`) refuse numeric/`Music` genres.
  SC hits pass a hard artist gate (`scoreScHits`, mirrors `scoreBpHit`). Keep
  the `COL|` destructure aligned to the real 6 fields. `?? "Music"` is banned;
  the `sc_genre_ids` cache was dropped (#108) — never resurrect without owning
  its writer. ID3 genre frames are unreliable: curated genres live in the
  archive ledger, never the tag frame.
- FullTags comment = `Key · Energy · Mood`; BPM has its own RB column and never
  enters the comment.

## Rekordbox and hardware

- Quit rekordbox before DB work; every master.db write hard-gates on RB closed
  and verifies with a delayed re-read. Dated `rekordbox_bak_*.zip` backups are
  sacred. Never write drive DBs in place; never delete source files.
- Master DB: `/Volumes/SHELF1/PIONEER/Master/master.db` (configured volume
  names win over examples). Pass DB paths positionally to Python seams; verify
  every row's file after path rewrites. Local
  `~/Library/Pioneer/rekordbox/master.db` is stale.
- Two DBs, two roles: SHELF1 `master.db` = collection SSOT; `archive.db` =
  pipeline ledger. Never present ledger coverage as library size; decompose
  ledger cohorts before quoting. Disk counts (incl. quarantine) always exceed
  DB rows — explain by provenance, never equate.
- The playing USB (`flip-master`) is user-managed: agents never sync, export,
  or write it — SHELF1 only; the user stages USB content. Import order:
  `shelf-sync`, then drag from the shelf volume, never local staging.
- Every drive carries `export.pdb` (the one hardware players read) + the
  OneLibrary master. Green master ≠ hardware sees it: re-export after
  imports/relocations. Shelf-tier empty `PIONEER/rekordbox/` is correct — do
  not export to the shelf; role-aware checks come only from
  `cratedeck/shared/check_matrix.ts`. CrateDeck reads scratch copies and
  refuses while RB runs.
- RB auto-writes are `rb-import`'s job only (closed, dated backup, whole-table
  verify); `Write to master.db` tool calls refuse while RB runs. Rekordbox is
  SSOT for the collection, never archive bytes: unreferenced files get
  fingerprint-proven + quarantined, not deleted. Energy is engine-computed;
  only Comment carries derived energy, never BPM.
- Cue conventions are OPPOSITE: XML `POSITION_MARK Num="0..7"` = hot,
  `-1` = memory; DB `djmdCue.Kind` is `1` = hot, `0` = memory. Verify against a
  hand-authored reference before any cue write ships
  (intake-cue-postmortem F4/F1). Playlists: `djmdPlaylist` +
  `masterPlaylists6.xml` are twins — write both or neither, one seam. One
  playlist per dated intake under `DJ-Imports`; never genre playlists. Hot
  cues: max 8, semantically placed; pads need `Kind = 1`.
- WAV artwork is unsupported: ingest converts WAV → AIFF. TKEY is reliable on
  AIFF/MP3; RB analysis can overwrite it. Audio analysis decodes in-process
  via PyAV (`Audio2Beats(signal, sr)`) — never reintroduce the ffmpeg
  temp-WAV bridge.

## Test and process traps

- Parallel-suite flakes at exactly 5s = the one SQLite seam's
  `busy_timeout` (`openLedger`); child-CLI hangs = worker spawned with no work.
  Lazy-open expensive sessions only for real work; hermetic workers
  (`CRATEDECK_OFFLINE` kills HTTP spawns; kill the process GROUP — detached
  grandchildren reparent to launchd and leak ports).
- Suite wedges are environmental first: leaked `/tmp/megadj-*` fixtures (purge
  > 24h old) and orphaned bun processes; identify a spinning worker via open
  > file handles, not stack traces.
- The launchctl deck server (`:7742`) goes stale the moment commits land on
  `main`: `launchctl kickstart -k` and re-probe live before debugging a route
  delta.

## CrateDeck

- `cratedeck/shared/types.ts` is the import leaf; run the madge cycle check on
  boundary changes.
- Snapshot/checksum work stays async; only physical external hardware passes
  `detect.ts`. Unknown-only checks are never healthy; bitrot requires real
  checksums.
- API legs get longer client deadlines; SSE has heartbeat/reaper; UI coalesces
  job events; caps: 20 snapshots, 2,000 events per drive.
- Jobs watch progress fraction, never log activity; every leg has a wall-clock
  budget; cancellation never forces progress to 1; `setJobProgress` is
  tri-state (`undefined` keep, `null` clear).
- `deckctl help` works server-down; `--help` is stdout/exit 0. Capabilities
  need a twin or a [`docs/surface-parity.md`](docs/surface-parity.md) row;
  census strings and command names are test-pinned — rename docs and code in
  the SAME pass. Hover cards are portal-rendered through `tipPlace.ts`.

## FullTags

- `setFileTags`/`writePatchSync` stay synchronous; no Bun-spawn bridges.
  Format-specific writers: mutagen for AIFF/WAV art and AIFF tags, ID3v2.3 for
  MP3, atomic temp-file replacement.
- Analysis lives in DB ledgers until its write gate passes. Positive ONNX
  labels come first except `mood_party`; saturated heads fail loudly. Audit
  requires mood + energy; reruns are idempotent.
- Booth compatibility is data-driven (`[booth].fleet` / `MEGADJ_FLEET`);
  `player-compat.ts` + `booth-text.ts` enforce it. `megadj booth-fix` proposes
  by default.

## Docs and state

- Docs changes go through the docs audit before pushes. Dated docs are
  snapshots; completed work gets a status header + shipped marker. State
  belongs in the DB, not markdown. GitHub is the roadmap SSOT: issues own
  WHAT/priority/status; docs own WHY + measured numbers. Never resurrect the
  archived `ideas.md`/`roadmap-index.md` mirrors. Issue labels: one each of
  `type:*`, `priority:*`, `effort:*`; bug fixes need a reproducer + evidence.
- MegaMem workspace: `megamem search "<query>"` before grepping docs; never
  re-index manually. `tokensave` MCP is rooted per project — mis-rooted
  results mean fix the root flag, never the index.
## Learned User Preferences

- Types informally with frequent typos and stream-of-consciousness requests; infers intent from context rather than asking clarifying questions.
- "fully 100% 10x" is the run-to-completion bar — no partial fixes, no dangling follow-ups; bare "10x" pushes polish harder each pass.
- When fixing a bug, harden the fix into `AGENTS.md` / skills / docs so the same class of bug cannot recur (regression test + doc update in the same pass).
- Audit and consolidate before adding — one CLI/script with different params over new one-offs, merge duplicate docs; stale canvases are working artifacts: audit them, file surviving opportunities as GitHub issues, then delete the canvas.
- Turns audit/code-quality findings into GitHub issues first (batched ~3–10, one `type:*`/`priority:*`/`effort:*` label each), then burns them down in later sessions; issues close only with measured evidence, and fixes land as logical chunks pushed straight to `main`.
- Re-sends identical messages as emphasis ("do another 2 genre categorization features" ×2) — treat duplicates as "keep going", not new scope; never restart or duplicate in-flight work because of a re-send.
- Wants live, measured numbers with a cited timestamp for any status/coverage answer — stale or remembered counts repeatedly caused confusion; prefers an honest "I don't know" over a guessed figure.
- Expects a locally running dev server to hand-test UI changes ("dev up please and let me test it out").

## Learned Workspace Facts

- `AGENTS.md` and docs content is test-pinned by census tests (the two `boundary-*-census.test.ts` strings, plus `docs-paths`/`docs-safety` censuses) — keep pinned strings intact when condensing; archive-internal broken links are intentionally left (frozen snapshots).
- Genre source matching has one artist-gate SSOT, `fulltags/src/name-match.ts` (test-pinned): SoundCloud and Beatport scorers both route through it; the hard must-contain-artist gate is what makes remix-safe matches possible.
- `fulltags/src/bandcamp.ts` is the fetch ladder's third genre vote (W2b): `autocomplete_elastic` search → `scoreBcHits` (shares the artist gate) → JSON-LD/HTML page parse (tags, genre, label, art); `bcGenre` refuses numeric/`Music` junk like the SC/BP arms.
- Genre vocabularies are consolidated in `fulltags/src/genre-vocab.ts` (one module, plainly-named maps) — it replaced the `GENRE_MAP`/`SC_GENRE_CANON`/`DJ_GENRES`/`GENRE_FAMILY` twins and the two different `inferGenre` functions.
- Genre writes stay first-win as of Sep 16; the weighted vote ladder (#173) is designed, not verified shipped (a `genre-vote.ts` WIP exists): planned weights are measured (Beatport 6 > SoundCloud 5 = Bandcamp), SC trust raised because it carries ~3.4× the remix rate, migration is shadow-mode first. Don't quote canvas plans as shipped.
- `archive.db` is megadj's own intake ledger, not a shelf copy: rows decompose into YouTube liked-videos (music-checked by `megadj sync`, mostly never downloaded), local ingests, and playlists; `pending` ≠ gap and `skipped_not_music` rows are correctly parked non-music. Never present ledger counts as library size.
- Concurrent-agent collisions resolve content-first: a foreign commit that swept staged files counts as landed when the diff is byte-identical vs the worktree (hash is irrelevant); a stash round-trip restores content byte-identical but loses the staged/unstaged distinction.
