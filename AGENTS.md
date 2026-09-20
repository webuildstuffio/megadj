# AGENTS.md — megadj

Rules and traps only. Product detail: [`docs/`](docs/README.md); full incident
history: [`docs/agent-playbook.md`](docs/agent-playbook.md).

## Non-negotiables

- English only. Product decisions follow [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md).
  macOS/Pioneer only; no CI; no PR flow — direct pushes to `main`.
- Gates before push: `bun run check && bun test`. Hard 100% type coverage:
  `bun run check:full` (adds ruff + mypy strict over `cratedeck/python` and
  `tools/*.py`, plus   `tools/*_test.py`). `check` = tsc + oxlint + format +
  knip + web vite build. `check` green has hidden a red `check:full` before
  (typecov 99.62% found Sep 18; earlier "gate green" claims were check-scoped)
  — claim the hard gate only after `check:full`.
- Pre-commit runs STAGED-SCOPED tests (untracked WIP from concurrent agents is
  invisible); the full suite runs at PRE-PUSH against the SHARED worktree —
  another agent's red WIP blocks your push; don't `--no-verify` over it. LOC
  budget: net code reduction per commit until 75k LOC (advisory on self-error;
  bypass `MEGADJ_LOC_BYPASS='reason'`, audit-logged).
- Never `git add -A`; preserve concurrent work. Re-read before editing; check
  for others' PRE-STAGED files before committing (rebuild path-scoped if so);
  verify `git log --oneline -1` + `git status` after every commit. The census
  tests (`src/census/apply-gate-census.test.ts`, `src/census/boundary-*-census.test.ts`) are
  the tripwire for silently reverted refactors — re-commit a clobbered fix.
  Never pipe `git commit` through `| tail`/`| head`: a blocked commit's
  nonzero exit code is masked by the pipe and a hooked block looks landed
  (redirect to a file, then read it). Oversized commits need
  `GIT_ALLOW_LARGE_COMMIT=1` (42-file diet split d02eb55).
- Concurrent agents — the working contract (Sep 19, after two same-day
  collision rounds): (1) before picking an issue, run `git status` +
  `git log --oneline -5` and treat a hot file (recent commit OR uncommitted
  diff by another agent) as CLAIMED — pick a different tree, don't "help";
  (2) `git reset --hard`/`checkout .` on a SHARED worktree destroys other
  agents' unstaged work — never run them; restore single paths instead;
  (3) stage your own files AS YOU EDIT (`git add <paths>`): an unstaged
  append can be eaten by another agent's reset and the loss is invisible;
  (4) two agents refactoring the SAME verb/subject = dedup to ONE arm, the
  richer contract (json-safe epilogue + emit seams) wins; the census pins
  catch the twin (`maintenance-verbs.test.ts` dupes check); (5) after ANY
  foreign commit lands mid-flight, re-run the touched censuses before your
  own commit — a torn read is the other agent's landed rename, not your bug.
- Git identity attributes commits on EMAIL, not name — a wrong repo-local
 `user.email` hands your authorship to whoever owns that address on GitHub
 (Sep 19: 13 commits shipped as a stranger's `nick@users.noreply.github.com`;
 a legacy-format noreply address resolves to the owner of the short username).
 This repo pins `Nicholas Montgomery <1810803+nichm@users.noreply.github.com>`
 locally; `src/census/git-identity-census.test.ts` fails any commit outside
 that identity. Machine-wide identity lives in shell-config `gitconfig.local`;
 git `[include]` cannot override values set earlier in `~/.gitconfig` (first
 value wins), so the template's `[user]` placeholders must stay commented out.
- One file-naming convention repo-wide (#240, kebab-case):
  `src/census/naming-convention-census.test.ts` fails when a snake_case
  `.ts`/`.tsx` basename appears outside node_modules — module AND test files
  alike (the Sep-2026 pass renamed the 77-file snake majority in
  cratedeck/src plus the src/archive, fulltags, and cratedeck/shared
  strays). New files are kebab; a rename moves code+docs+census pins in the
  SAME commit via `git mv` + specifier rewrites (`cratedeck/shared/check-matrix.ts`
  is pinned by name in this file). Python keeps snake_case (PEP 8,
  exempt by the *.py exclusion).
- No bare `catch {}` / `.catch(() => {})`. Boundary `JSON.parse` uses a guarded
  parser; gate numerics with `Number.isFinite`; CLI numeric options use
  `nonNegOpt` (bad input → exit 2, zero work). Keep
  `src/census/boundary-number-census.test.ts` and `src/census/boundary-json-census.test.ts`
  green when either call surface changes. Positionals go through
  `firstPositional(args, cmd, stringOpts)`/`positionalArgs` — the stringOpts
  argument is load-bearing: without it a space-form flag's VALUE reads as the
  positional (`ingest --min-duration 30 <folder>` took "30" as the folder;
  the SAME bug recurred in the rb-unmatched/rb-import/rb-playlist arms via
  `positionalArgs(rest, [])` beside a non-empty parseFlags string list,
  re-fixed 2026-09-17 — the stringOpts lists must MATCH parseFlags, a
  mismatch is a bug). Never hand-roll a numeric-parse closure beside
  `nonNegOpt` (the rb-playlist twin needed exitCode READS to bail out);
  `numOpt` (silent default on bad input, `0` → unlimited) is retired.
  Path identity is `pathKey` (`src/shelf/intake-status.ts`): NFC+casefold
  before compare — raw path strings missed 3 files in the #238 strays
  incident (APFS case twins are one file, two DB rows); intake-status joins
  disk↔ledger through it and reports case-collision buckets.
- stdout is a boundary: JSON via the awaited seams (`emitJson` deckctl,
  `writeJson` megadj CLI) — never raw `console.log(JSON.stringify)` (pipe-EOF
  truncation) or `Bun.write(Bun.stdout, "")`; drain with
  `process.stdout.write("")`. Big payloads on a PIPE wedge `Bun.write`
  forever (the promise never resolves, drainStdout is never reached):
  `intake-status --json | head -c 400` hung minutes until writeJson moved
  to the bounded `process.stdout.write` writer with an EPIPE guard
  (`cli-output.test.ts` pins the topology).
- Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noUncheckedSideEffectImports`, `allowUnreachableCode:false`. Never run
  repo-wide `oxlint --fix`/sed rewriters unattended (they corrupted template
  literals on main once). Lizard CCN hotspots are usually ghosts here —
  span-verify against real `function` boundaries before refactoring: lizard
  folds regex-literal data tables and adjacent small fns into phantom
  hotspots (5 of #195's 7 "CCN≥24" entries were phantoms; #195 comment,
  2026-09-17). File-level `awk '$2>30'` sweeps compound the error — grep
  the `name@start-end` rows and read the span. Anonymous closures get NO
  lizard name rows at all, so "no named fn ≥X" is blind to every arrow
  function — before claiming a complexity tier is empty, sweep with the
  census-parity AST rules (`src/test-support/source-metrics.ts`), which
  is also the only measurer whose numbers match the pinned census tests
  (#199 found six real 16–22 fns invisible to the lizard table).
  The AST census is now ENFORCED: `src/census/issue-198-ccn-census.test.ts`
  pins a repo-wide CCN ceiling (ratchet — lower it to just above the new
  max in the same commit as a refactor, never raise it), and
  `bun tools/ast-ccn.ts --list <files.txt> N` is the probe. The 159–64
  "lizard ≥45" tier was entirely phantom — the real max was 56 after the
  #88 splits (2026-09-17).
- Exit codes go through the one `setExit` seam — never write `process.exitCode`
  raw (a landed fix did exactly that in `genre-why.ts` and tripped the
  `exit-code-census`; rerouted in-pass, Sep 17).
- One source of truth per shared surface: derive types, job lists, help,
  counts, census strings from producers — never hand-copied twins. Route
  dispatch too: `archiveRoutes` derives the /api/archive/* route list from
  the `archiveHandlers()` map keys (a hand-copied route-list regex twin
  404'd `genre-why` live, Sep 17); `cratedeck/test/archive-dispatch-census.test.ts`
  pins every key's reachability. When a route 404s but the handler exists,
  suspect a dispatch twin first.
- No private identifiers, local paths, stored state, or secrets in commits.
  No dependency bumps without the release-age floor + full gate. Probe it with
  `bun run deps:age` (latest publish date per devDep) before any bump; a bump
  candidate younger than ~7 days waits (oxlint ships weekly, so "latest" is
  almost never a same-week action).
- No one-off scripts: encode safety in reusable commands, tests, skills.
- `cratedeck/tsconfig.json` must stay an `extends` shim (it duplicates the
  root compilerOptions 1:1 today — the twin drifted once and shares the root
  `tsBuildInfoFile`, so `tsc -p cratedeck` Poisons the shared cache; never run
  a project-scoped tsc there without `--incremental false`). Root
  `typecheck` runs warm-incremental; `typecheck:forced` is the cold full-tree
  check — reach for it when a cache is suspected (Sep 19 audit: warm and
  forced disagreed only on a foreign WIP break, never on cache staleness).
  `.oxlintrc.json` rule list: the `off` entries are deliberate (each kills
  a firing style rule — e.g. sort-keys fires 3,255× without it); add
  stricter `typescript/*` rules before re-enabling style noise.

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
  safe no-op; each dump gets a fresh folder. The dated batch folder is the
  ledger key: ingest itself upserts the `intake_dumps` table in archive.db
  (#20 — same-day dumps stay distinct, `pending > 0` = partial, resumes flip
  to done; surfaced via `intake-status --json`, `GET /api/intake/dumps`, MCP
  `getdat_intake`). On ExFAT, prefilter by
  size/duration/name BEFORE hashing (full-volume MD5 ≈ 50 min).
- The hygiene engine owns the listen-first guard: `quality-diff`, `oddball`,
  `ear-check` findings cannot be batch-confirmed from any spoke.
- The `hygiene_findings` natural key is (kind, paths[0], paths[1]) — NEVER
  keeper-based: a keeper-only key collapses every singleton finding
  (zero-byte/junk: null keeper) of a kind onto ONE row and a confirm on
  file A silently absorbs file B's evidence (the #9-class status bleed,
  fixed 2026-09-17; pinned in store.test.ts). New check kinds register in
  REGISTERED_KINDS (`checks/index.ts`) — `--kind` validates against it
  (unknown = exit 2, zero work); a CLI flag the engine never reads is a
  silent no-op bug (`--kind` shipped parsed-but-dropped for months).
  Applied findings keep a recoverable ledger copy: `shelf-restore
  <finding-id|path>` (MD5-verified) + `/api/hygiene/restore` with a
  QuarantinePanel (#35/#36, Sep 19) — quarantine-empty flips rows to
  `archived` behind a literal `{confirm:"DELETE"}` gate, receipts survive.
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
  the `COL|` destructure aligned to the real 6 fields. `?? "Music"` is banned
  EVERYWHERE (the sync download-folder plumbing still had one in Sep 17 —
  null + "Music" both land in sanitizeGenreFolder's "Unknown Genre" bucket);
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
  names win over examples; drive-name lookups go through
  `src/shared/volume.ts` — `configuredMasterDrive()` reads config
  `library.master_drive`, never a private env twin like the
  `MEGADJ_MASTER_DRIVE` that made rb-grid-triage diverge, removed
  2026-09-17). Pass DB paths positionally to Python seams; verify
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
  `cratedeck/shared/check-matrix.ts`. CrateDeck reads scratch copies and
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
  grandchildren reparent to launchd and leak ports). Test fixtures leak at
  scale: a full-suite run leaves ~1,300 `/tmp/megadj-*` dirs/day (25,892
  dirs / 12.5 GB measured Sep 18) — `megadj tmp-purge` (#236, age-gated) is
  the sweep; its `--state` tier (`5668af4b`) prunes superseded
  `archive.db` backups/orphan sidecars. `spike/` JSONs are load-bearing
  compare baselines, never swept; `cratedeck.db` was a writerless 0-byte stub.
- Red tests/censuses during a concurrent-agent push are a torn read first:
  re-run on settled HEAD before debugging (Sep 17: `891b330` landed mid-suite
  and broke a `CompareCard` import mid-run; retry was green). Same for census
  digests — a foreign WIP refactor (e.g. `job_legs.ts` → `job-legs-parse.ts`)
  feeds the digest; verify against clean HEAD, don't "fix" your own pass.
- The pre-push leg is the repo's OWN `.githooks/pre-push` chaining
  `$HOME/.githooks/pre-push` + `bun run test` (landed 13e43e8, Sep 17 — until
  then the AGENTS-documented full-suite-at-pre-push never ran; `core.hooksPath`
  overrides the global hook dir, so an unchained hook is silently dead).
  `src/census/githooks-census.test.ts` pins existence + exec bit + chained gates.
- Suite wedges are environmental first: leaked `/tmp/megadj-*` fixtures (purge
  > 24h old) and orphaned bun processes; identify a spinning worker via open
  > file handles, not stack traces.
- The launchctl deck server (`:7742`) goes stale the moment commits land on
  `main`: `launchctl kickstart -k` and re-probe live before debugging a route
  delta. Don't assume the port either: a concurrent agent's dev server may
  answer on a random port (Sep 17: :59997 ran the newer route while :7742
  was absent), and E2E must bind-probe candidates before spawn — its random
  7800–7899 range collided with the launchd megamem service (:7823), and
  EADDRINUSE mid-boot masqueraded as "server failed to boot" (fixed
  03e5ed2, Sep 17). Since #247 the deck server installs as launchd
  `com.nick.megadj-deck` (`ops/deck-service.ts`, doctor `deck-service`
  check probes pid + `/api/interlock`) — restart via launchctl, not bare
  background processes. Render launchd filesystem paths with XML escaping and
  single-pass callback substitution; native `plutil` round-trip tests must
  preserve metacharacters and literal template tokens.

## CrateDeck

- `cratedeck/shared/types.ts` is the import leaf; run the madge cycle check on
  boundary changes. The src ↔ cratedeck seam has ONE direction rule (#222,
  census-pinned by `src/census/boundary-direction-census.test.ts`): the two
  trees may import each other ONLY through the dependency-free leaf
  `src/shared/leaf/{guards,fmt,vector-space,fixes}.ts` plus the allowlisted
  seam modules in that census — any other crossing is a red build, and new
  rows need an owning issue (#225A retires them).
- Snapshot/checksum work stays async; only physical external hardware passes
  `detect.ts`. Unknown-only checks are never healthy; bitrot requires real
  checksums.
- API legs get longer client deadlines; SSE has heartbeat/reaper; UI coalesces
  job events; caps: 20 snapshots, 2,000 events per drive.
- Jobs watch progress fraction, never log activity; every leg has a wall-clock
  budget; cancellation never forces progress to 1; `setJobProgress` is
  tri-state (`undefined` keep, `null` clear). The megadj↔CrateDeck live-run
  protocol is contract-pinned (`cratedeck/test/fetch-events-census.test.ts`):
  fetch emits `@event {json}` lines on STDERR; the two products share no
  code, so tag names/wire shapes are the pin — a rename on either side
  fails the census instead of silently blanking the live UI (Sep 18, #215).
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
- Docs teaching surface names are census-enforced:
  `src/census/docs-surface-names-census.test.ts` derives every megadj verb,
  deckctl verb, MCP tool, and job kind FROM THE PRODUCERS
  (`command-registry.ts`, `DECK_COMMANDS`/`PRE_SERVER_VERBS`, the
  `*_tools.ts` key maps, `JOB_KINDS`) and fails when docs/skills teach a
  name the producers don't define (`archive_set_build` survived its
  rename in 4 docs; `deckctl verify <drive>` survived the #41 verb-table
  split in a skill — both invisible until Sep 17). Rename = code + docs
  in the same commit; a name that is only historical goes in prose
  WITHOUT backticks (backticks are the "teachable name" signal the
  census reads). The docs-paths census likewise rejects a backticked
  path that doesn't exist in THIS repo — foreign-repo docs (mem-bench)
  go in prose too (Sep 18 catch, `0502e8b`). Planned-but-unbuilt commands
  need an allowlist entry
  with a reason (`docs/fulltags/intake-cue-postmortem.md`'s intake-status).
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
- Wants live, measured numbers with a cited timestamp for any status/coverage answer — stale or remembered counts repeatedly caused confusion; prefers an honest "I don't know" over a guessed figure. "you made it and pushed to main, yeah?" got an honest "no — researched but never wrote/pushed" (Sep 18): claims must be verified against real repo/remote state before agreeing.
- Runs multiple agents on one repo and expects them orchestrated, not avoided: "put all their stuff together on one branch and ship in logical parts to main" / "work alongside them properly, don't overlap" — consolidate concurrent agents' work into logical chunks, wait out (or surgically untangle) in-flight foreign edits, and never declare work lost without a worktree-vs-HEAD content check.
- Super-sure verification passes are expected to find something: a pass that ends "all green" should still probe the hard gates (`check:full` caught a silent 99.62% typecov baseline), re-prove acceptance live (fresh-run leak sweep), and fix defects found — not just re-list statuses.
- Expects a locally running dev server to hand-test UI changes ("dev up please and let me test it out").

## Learned Workspace Facts

- Concurrent-agent collisions resolve content-first: a foreign commit that swept staged files counts as landed when the diff is byte-identical vs the worktree (hash is irrelevant); a stash round-trip restores content byte-identical but loses the staged/unstaged distinction. Staging is contested under concurrency: a plain `git add`/`commit` on the shared index can sweep (or unstage, or resurrect) another agent's paths — for surgical multi-agent commits use a temp/plumbing index containing exactly your set (`git commit-tree` + ref advance), and after any foreign sweep audit HEAD for duplicate/resurrected paths before "fixing" (Sep 18: the #244 moves landed via three cooperative sweeps; one foreign commit re-added 24 old paths alongside the new ones — the follow-up deletions completed the rename).
- Test/support trees follow one convention (Sep 17, post-rename): per-product `test/` dirs beside source (`src/fulltags/test/`, `cratedeck/test/`, `src/test-support/` shared helpers) — never a stuttered `test-support/fulltags/fulltags` doubling. When moving a test tree, the four pin classes that break are: relative import specifiers, `import.meta.dir` constructions, knip entry globs, and ACTIVE docs citing the path (`docs-paths-census` validates those live; archived docs are exempt). Tests move WITH their subject (#23/#234, completed Sep 17); `src/` root keeps exactly the host-kit set — host-kit tests (`cli-flags`, `numeric-options`, `json-summary`) plus `src/census/` (the `*-census` / `issue-*` tripwires, #244) and `src/test-support/`; cross-domain plumbing like `progress` lives in `src/shared/`, never at the root. Test PLACEMENT rule (#246, census-pinned by `src/census/test-placement-census.test.ts`): a subject's test co-locates beside it (`foo.ts` ↔ `foo.test.ts`, any depth); a product's `test/` dir holds ONLY shared support — fixtures, workers, builders, case tables — never a subject's own test; the known co-location debt is an allowlist ratchet in that census, every row naming its migration issue (#220/#214/#235). Fixture hygiene is also census-pinned (#248): raw `mkdtempSync`/`new ArchiveState` in tests fail `fixture-seam-census` — temp dirs go through the seam and get swept.
- `AGENTS.md` and docs content is test-pinned by census tests (the two `boundary-*-census.test.ts` strings, plus `docs-paths`/`docs-safety` censuses) — keep pinned strings intact when condensing; archive-internal broken links are intentionally left (frozen snapshots).
- Genre source matching has one artist-gate SSOT, `fulltags/src/sources/name-match.ts` (test-pinned): SoundCloud and Beatport scorers both route through it; the hard must-contain-artist gate is what makes remix-safe matches possible.
- `fulltags/src/sources/bandcamp.ts` is the fetch ladder's third genre vote (W2b): `autocomplete_elastic` search → `scoreBcHits` (shares the artist gate) → JSON-LD/HTML page parse (tags, genre, label, art); `bcGenre` refuses numeric/`Music` junk like the SC/BP arms.
- Genre vocabularies are consolidated in `fulltags/src/genre/genre-vocab.ts` (one module, plainly-named maps) — it replaced the `GENRE_MAP`/`SC_GENRE_CANON`/`DJ_GENRES`/`GENRE_FAMILY` twins and the two different `inferGenre` functions.
- Genre vote ladder (#173) SHIPPED in f54ba04 (Sep 16, closed Sep 17): every rung votes (genre+weight+provenance), one election seam (`stageGenreElection`) owns tag+DB write, breakdown persists in `tracks.genre_votes`, weights versioned in code as `GENRE_VOTE_WEIGHTS` (test-pinned ordering). First-win writes are gone. The writer-only GAP closed: `genre-why.ts` is now the production reader of `ArchiveState.genreVotes()` (#215 closed Sep 17). Lesson stands: knip is blind to dead methods on live classes — only a caller census catches that class. Shipped ≠ run: a day after ship, `tracks.genre_votes` was still 0 rows (no real fetch since the ship run) — quote per-cohort run state, not the feature's existence (Sep 18). The megamem transfer doc is `docs/megaset/embedding-learnings-from-megamem-2026-09-17.md` (v2 rewrite, Sep 18: 2,003 experiments re-censused, status split 1,001 failed / 681 done / 279 skipped / 40 queued); `docs/megaset/11-master-architecture-v2.md` (`e2e08918`) is the v2 synthesis with the 7 cross-shop invariants and a reject list (all 19 DIV diversity experiments dead — diversity ships as hard caps only).
- `archive.db` is megadj's own intake ledger, not a shelf copy: rows decompose into YouTube liked-videos (music-checked by `megadj sync`, mostly never downloaded), local ingests, and playlists; `pending` ≠ gap and `skipped_not_music` rows are correctly parked non-music. Never present ledger counts as library size. Measured decomposition (Sep 18): ~5.9k tracks = 3.1k rekordbox mirror + 750 ingest + ~2.0k liked/liked-videos (1,087 liked-videos pending, unclassified since Aug 22); known audio ~26 GB vs 3,125 rows on SHELF1. YT rows are `tracks` rows keyed by video_id ONLY — zero embeddings/beats/mood; FullTags has NO YouTube search arm (votes: SoundCloud via yt-dlp, Beatport, Bandcamp), so there is no youtube-find store to reconcile. Storage/retention answers live in `docs/getdat/data-model.md` + the `storage-intake-census` skill (Sep 18, `9dae86a4`): every state-dir path has exactly one retention owner (dated backups → `tmp-purge --state`, newest per stem always kept); RB pilots zip + `.sha256`, never plain-delete; the "library size" honest answer is bytes-per-volume → ledger decomposition → per-source freshness.
- Concurrent-agent collisions resolve content-first: a foreign commit that swept staged files counts as landed when the diff is byte-identical vs the worktree (hash is irrelevant); a stash round-trip restores content byte-identical but loses the staged/unstaged distinction.
- Concurrent-agent collisions resolve content-first: a foreign commit that swept staged files counts as landed when the diff is byte-identical vs the worktree (hash is irrelevant); a stash round-trip restores content byte-identical but loses the staged/unstaged distinction. Staging is contested under concurrency: a plain `git add`/`commit` on the shared index can sweep (or unstage, or resurrect) another agent's paths — for surgical multi-agent commits use a temp/plumbing index containing exactly your set (`git commit-tree` + ref advance), and after any foreign sweep audit HEAD for duplicate/resurrected paths before "fixing" (Sep 18: the #244 moves landed via three cooperative sweeps; one foreign commit re-added 24 old paths alongside the new ones — the follow-up deletions completed the rename).
- plugin/skills files are git symlinks (mode 120000) into .claude/skills — that IS the dedup mechanism, not duplication; `wc` over `git ls-files` double-counts symlinked content (a v1 audit claimed 1.3kL of dupes that don't exist). Verify with `git ls-files -s` mode 120000 before proposing a dedup.
