# AGENTS.md — megadj

Rules and traps only. Product detail: [`docs/`](docs/README.md); full incident
history: [`docs/agent-playbook.md`](docs/agent-playbook.md).

## Non-negotiables

- English only. Product decisions follow [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md).
  macOS/Pioneer only; no CI; no PR flow — direct pushes to `main`.
- Gates before push: `bun run check && bun test`. Hard 100% type coverage:
  `bun run check:full` (adds ruff + mypy strict over `src/deck/python` and
  `tools/*.py`, plus `tools/*_test.py`). `check` = tsc + oxlint + format +
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
  locally. The git-identity census was RETIRED (Sep 23, owner call — the pin
  "didn't need it anymore, simplify"); local identity config remains the only
  enforcement. Machine-wide identity lives in shell-config `gitconfig.local`;
  git `[include]` cannot override values set earlier in `~/.gitconfig` (first
  value wins), so the template's `[user]` placeholders must stay commented out.
- One file-naming convention repo-wide (#240, kebab-case):
  `src/census/naming-convention-census.test.ts` fails when a snake_case
  `.ts`/`.tsx` basename appears outside node_modules — module AND test files
  alike (the Sep-2026 pass renamed the 77-file snake majority in
  cratedeck/src plus the src/core, fulltags, and cratedeck/shared
  strays). New files are kebab; a rename moves code+docs+census pins in the
  SAME commit via `git mv` + specifier rewrites (`src/deck/shared/check-matrix.ts`
  is pinned by name in this file). Python keeps snake_case (PEP 8,
  exempt by the *.py exclusion).
- No bare `catch {}` / `.catch(() => {})`. Boundary `JSON.parse` uses a guarded
  parser; gate numerics with `Number.isFinite`; CLI numeric options use
  `nonNegOpt` (bad input → exit 2, zero work). Keep
  `src/census/boundary-number-census.test.ts` and `src/census/boundary-json-census.test.ts`
  green when either call surface changes. Multiple `Number()` parses in one
  function need distinct binding names per call — the census pairs
  `Number.isFinite` guards by variable name; reusing `n` cross-shadows siblings
  (Sep 30 comment-v3/v4 parsers). Env-var PATH overrides go through
  `nonEmptyEnv` (`src/shared/leaf/guards.ts`), never raw `??` on
  `process.env` — `??` only catches `undefined`, so `MEGADJ_MUSIC_DIR="$SHELF"`
  with `$SHELF` unset expanded to empty string, resolved CWD-relative, and
  dropped a dated batch folder in the repo root (#281, Sep 20: 20 downloads,
  20+ ledger rows repaired). Present-but-empty env = typo, read it as
  absent. `downloadBatchDir` additionally refuses relative archive dirs
  (pinned by `src/getdat/commands/intake-folder.test.ts`). Positionals go through
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
  404'd `genre-why` live, Sep 17); `src/deck/test/archive-dispatch-census.test.ts`
  pins every key's reachability. When a route 404s but the handler exists,
  suspect a dispatch twin first.
- No private identifiers, local paths, stored state, or secrets in commits.
  No dependency bumps without the release-age floor + full gate. Probe it with
  `bun run deps:age` (latest publish date per devDep) before any bump; a bump
  candidate younger than ~7 days waits (oxlint ships weekly, so "latest" is
  almost never a same-week action).
- No one-off scripts: encode safety in reusable commands, tests, skills.
- `src/deck/tsconfig.json` is an `extends` shim (#271, census-pinned by
  `src/census/tsconfig-bunfig-census.test.ts` — it was a 19-option byte-twin
  that shared the root `tsBuildInfoFile`, so `tsc -p cratedeck` poisoned the
  shared cache; never run a project-scoped tsc there without
  `--incremental false`). Root `typecheck` runs warm-incremental;
  `typecheck:forced` is the cold full-tree check — reach for it when a cache
  is suspected (Sep 19 audit: warm and forced disagreed only on a foreign WIP
  break, never on cache staleness). `erasableSyntaxOnly` is ON in the root
  config (#272/#274: TS7-ready syntax, probed 0 violations) — `enum`,
  `namespace`, and parameter properties will not compile. Nested
  `bunfig.toml` copies are INERT (bun reads bunfig only from the
  process-start CWD): `src/deck/bunfig.toml` is a documented tripwire whose
  timeout must differ from root, `src/fulltags/bunfig.toml` is deleted.
  `.oxlintrc.json` rule list: the `off` entries are deliberate (each kills
  a firing style rule — e.g. sort-keys fires 3,255× without it); add
  stricter `typescript/*` rules before re-enabling style noise. Plain
  (non-smart) `eqeqeq` is enforced (#272) — nullish presence checks use
  `=== null`/`!== null`/`=== undefined` explicitly; when narrowing an
  optional chain's base AND property, narrow both (`a !== undefined &&
a.prop !== null`), one strict check does NOT imply the other.

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
- `shelf-sync` artifact multiplication bug (root-caused Sep 30):
  `divergentDestination()` writes `track [archive].ext` for byte-divergent
  same-name copies; on the next sync run `walkArchive()` re-picked them up as
  new source, creating `[archive 2]`, `[archive 3]` … `[archive 9]`.
  `SYNC_ARTIFACT_RE` (regex: `\[archive(?: \d+)?\]|\[BACKUP\d*\]`) now filters
  BOTH `walkArchive()` (source scan) AND `shelfAudioIndex()` (shelf index), so
  artifacts are invisible to sync. Test-pinned in `sync.test.ts`. The filter is
  sync-only: `shelf-archive`'s `ShelfIndex` correctly indexes artifacts (they
  suppress re-copy), and `dupescan` needs to see them as dedup candidates.
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
- `megadj sync` is serial against YouTube BY DESIGN — parallel yt-dlp earns
  IP-403 storms that stop everything (`ratelimit.ts`); parallelism belongs in
  the analysis chain (`fetch`/`beats`/`mood --jobs 4`). The music gate is
  recall-favored on purpose: `classifyMusic` also accepts title-shaped song
  signals (`[AI]`/`(AI)` brackets, official video/audio/visualizer, feat./ft.)
  after a real false-positive (PERC 30, AI song gated, fix `56fd857e`) — a
  wrong "music" just downloads something liked anyway. AI songs ARE music
  (owner call, Sep 19). Downloads land in dated batch folders
  (`<date> <label> downloads/`) — never loose, never genre folders (the Sep 19
  "loose files / genre-organized dj-imports" owner correction), and those
  folders are permanent batch sources: keep the folder even after import
  empties it — nothing deletes it, owner policy. `megadj organize` is the sweep
  that enforces this (genre folders are retired as a destination; `sync` and
  `drop` run it automatically post-run), and its summary reports shelf-mirror
  rows as an honest `outsideScope` bucket, never "missing" (Sep 20). Long-track analysis is
  skipped by default: mood/beats cap tracks over 10 minutes
  (`DEFAULT_MAX_MOOD_SECONDS`, `--max-seconds 0` to include) — that is the
  intentional duration cap, not a bug.
- The `hygiene_findings` natural key is (kind, paths[0], paths[1]) — NEVER
  keeper-based: a keeper-only key collapses every singleton finding
  (zero-byte/junk: null keeper) of a kind onto ONE row and a confirm on
  file A silently absorbs file B's evidence (the #9-class status bleed,
  fixed 2026-09-17; pinned in store.test.ts). New check kinds register in
  REGISTERED_KINDS (`checks/index.ts`) — `--kind` validates against it
  (unknown = exit 2, zero work); a CLI flag the engine never reads is a
  silent no-op bug (`--kind` shipped parsed-but-dropped for months).
  Plan §4.2 detectors truncated-name, stale-pointer, orphan-audio, and
  re-download are all SHIPPED with tests (#37 closed Sep 30); spelling-typo
  remains unbuilt.
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
- FullTags booth comment **v4 is plan of record** (owner spec Sep 30,
  `docs/fulltags/comment-v3-proposal-2026-09-30.md` — filename legacy):
  mix-first string `E8 IN:32 OUT:16 VOX Drop Dark · MelTechno` — library-relative
  E1–E9, IN/OUT bar counts (round DOWN to 0/8/16/32/64), VOX/HOOK, Drop/Roll,
  Hard/Soft + Dark/Euph within-family, VAR for non-constant grids, subgenre
  after `·`. Comment shows only what RB columns omit (no Key/BPM/primary genre).
  **Three channels:** Comment (read), My Tags (XDJ-XZ Track Filter), track color
  (energy scan). Words not symbols — `booth-text.ts` `NON_FLEET_TEXT` blocks
  emoji/arrows; ASCII + `·` only. v3 (`comment-v3.ts`) is interim until
  `rb-comment-sync` ships v4; `buildCommentV4`/`parseCommentV4` in
  `src/fulltags/booth/comment-v4.ts`. Python twin in `comment-sync.kit.py`
  MUST stay in sync — the census doesn't cross-check them.

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
  `src/deck/shared/check-matrix.ts`. CrateDeck reads scratch copies and
  refuses while RB runs. On shelf tier, `dualDbCheck` treats legacy
  `export.pdb` as vestigial — parity work is `master.db` ↔
  `exportLibrary.db` (OneLibrary). Programmatic exportLibrary sync from
  master needs pyrekordbox **git** (`DeviceLibraryPlus` is not in the PyPI
  wheel); ORM `Content.genre`/`artist` are relationships, not columns — raw
  SQL inserts avoid cascade errors; device paths are drive-relative (strip
  the mount prefix). `export.pdb` writes still require rekordbox export (USB
  prep), not pyrekordbox alone.
- Doctor F2 title+duration dupes are heuristic — different artists can share
  a title and similar length (e.g. two "Nevada" tracks). Confirm with
  `rb-dedup` / `shelf-dupescan` fingerprint evidence before deleting; leftover
  F2 pairs after cleanup are often false positives, not missing dedup work.
- GROOVE CIRCUIT sampler preset rows in master.db use local
  `Music/rekordbox/Sampler/` paths — RB built-in pad content, not user
  library; keep Mac-local, never repoint to SHELF1.
- RB auto-writes are `rb-import`'s job only (closed, dated backup, whole-table
  verify); `Write to master.db` tool calls refuse while RB runs. Rekordbox is
  SSOT for the collection, never archive bytes: unreferenced files get
  fingerprint-proven + quarantined, not deleted. Energy is engine-computed;
  only Comment carries derived energy, never BPM.
- `import-write.kit.py` maps extensions to pyrekordbox `FileType` (M4A=4,
  FLAC=5, …) — a past M4A/FLAC swap wrote wrong codec metadata on every new
  import (Sep 29); keep aligned with the enum in the rb-adopt codec bullet.
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
- `tag-fix.kit.py` pushes archive.db title/artist fixes to master.db.
  Safety rules (hardened Sep 30 after 37 titles damaged): (1) timestamp filter
  via argv, never hardcoded; (2) title push only when archive.db is genuinely
  better (longer, case-fix, or filename-style cleanup — never overwrite a
  proper master.db title with a truncated YouTube one; artist-only archive
  fixes must not re-push stale lowercase titles just because `updated_at`
  re-enters the since filter); (3) pgrep RB-closed
  guard before commit; (4) WAL checkpoint on close. The `.kit.py` files have
  `@kit()` annotation markers that the TS orchestrator expands via
  `renderKitMarkers` — running a `.kit.py` directly with `python` leaves the
  markers as comments and any code AFTER the marker (like the RB-closed guard
  raise) runs unconditionally. Always invoke kits through the CLI
  (`megadj rb-comment-sync`) or `runPyScript`/`pyUvFileArgv`, never bare
  `python src/rekordbox/rb-scripts/*.kit.py`.

## Test and process traps

- RB guard tests must inject `assertClosed` (or equivalent) and isolate from
  live `pgrep` — suites that assume RB is closed fail whenever rekordbox is
  running on the host (Sep 30: `guard.test.ts` + twin rollback).
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
  Its `--orphan-runs` tier (Sep 20) closes crashed run rows (`finished_at
NULL`) — `sync` now closes its run row in a `finally`. macOS `lsof` exits 1
  BOTH when nothing matched AND on real errors: exit 1 with rows printed is
  SUCCESS, never a parse failure (#270).
- Red tests/censuses during a concurrent-agent push are a torn read first:
  re-run on settled HEAD before debugging (Sep 17: `891b330` landed mid-suite
  and broke a `CompareCard` import mid-run; retry was green). Same for census
  digests — a foreign WIP refactor (e.g. `job_legs.ts` → `job-legs-parse.ts`)
  feeds the digest; verify against clean HEAD, don't "fix" your own pass.
  Git-spawning censuses FAIL LOUD on git errors (Sep 23, `21702db3`): under
  the 16-way parallel suite a `git ls-files` can lose the index.lock race,
  exit non-zero with empty stdout — `test-placement-census.test.ts`'s
  `trackedTests()` silently scanned nothing and reported a misleading
  "Expected > 100, Received 0"; both git-spawning censuses (`test-placement`,
  `issue-198-ccn`) now throw the git error instead of returning an empty
  inventory. An EMPTY scan must never read as a passing census.
- The pre-push leg is the repo's OWN `.githooks/pre-push` chaining
  `$HOME/.githooks/pre-push` + `bun run test` (landed 13e43e8, Sep 17 — until
  then the AGENTS-documented full-suite-at-pre-push never ran; `core.hooksPath`
  overrides the global hook dir, so an unchained hook is silently dead).
  `src/census/githooks-census.test.ts` pins existence + exec bit + chained gates.
- Suite wedges are environmental first: leaked `/tmp/megadj-*` fixtures (purge
  > 24h old) and orphaned bun processes; identify a spinning worker via open
  > file handles, not stack traces. The suite uses the real clock: a red
  > date-keyed test around 00:00 UTC is the UTC-midnight straddle, not a
  > regression (Sep 19: ingest same-day-dump re-ingest test straddled midnight;
  > fix by freezing time, not by relaxing the invariant).
- The launchctl deck server (`:7742`) goes stale the moment commits land on
  `main`: `launchctl kickstart -k` and re-probe live before debugging a route
  delta. Don't assume the port either: a concurrent agent's dev server may
  answer on a random port (Sep 17: :59997 ran the newer route while :7742
  was absent), and E2E must bind-probe candidates before spawn — its random
  7800–7899 range collided with the launchd megamem service (:7823), and
  EADDRINUSE mid-boot masqueraded as "server failed to boot" (fixed
  03e5ed2, Sep 17). Since #247 the deck server installs as launchd
  `com.nick.megadj-deck` (`src/ops/deck-service.ts`, doctor `deck-service`
  check probes pid + `/api/interlock`) — restart via launchctl, not bare
  background processes. Render launchd filesystem paths with XML escaping and
  single-pass callback substitution; native `plutil` round-trip tests must
  preserve metacharacters and literal template tokens.

## CrateDeck

- `src/deck/shared/types.ts` is the import leaf; run the madge cycle check on
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
- Volume reconcile: `photoMountResync` runs only when `justMountedIds` is
  non-empty (#420, Sep 30) — not every FSEvents/poll sweep. `listMountedVolumes`
  caches on an unchanged volume name set to skip the per-sweep diskutil/plutil
  subprocess storm.
- Jobs watch progress fraction, never log activity; every leg has a wall-clock
  budget; cancellation never forces progress to 1; `setJobProgress` is
  tri-state (`undefined` keep, `null` clear). The megadj↔CrateDeck live-run
  protocol is contract-pinned (`src/deck/test/fetch-events-census.test.ts`):
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
- FullTags v3 (Sep 29): plan of record is
  `docs/fulltags/fulltags-v3-rebench-and-build-plan-2026-09-29.md`; every
  stage is re-measured through `megadj bench` and `src/fulltags/bench/`
  (answer keys, baseline freeze, compare runs) before production thresholds
  move.
- `megadj mood` pass 2 (ONNX) shards the queue across `--jobs` parallel
  workers (default 2) — one uv/model bootstrap per worker, not per chunk
  (Sep 29; use `--jobs 4` on long fleet runs). `analyzeMoods()` streams
  results through an `onResult` callback that writes each file's mood +
  embedding to DB immediately (Sep 30, `a5b053f6`); without the callback
  results accumulate in a `Map` and write ONLY after the full batch — a
  crash loses everything (4 failed force runs lost ~2,800 files each before
  the streaming fix). Never revert to batch-accumulate architecture.
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
- Wants findings surfaced before fixes on audits and risky ops: report first (canvas or grouped GitHub issues), then an explicit go-ahead to act (Sep 19: "instead of you fixing please make a detailed canvas of all bugs"; "lets turn that off right now" on a suspected backup).
- Wants long-running multi-stage work encoded as one reusable command, never a hand-run step list: "keep didve / make sure automatic next time" produced `src/ops/full-pipeline.sh` + `docs/runbooks/0e-full-pipeline.md`; when a manual step bites a second time, script it, runbook it, and cite both (Sep 20). Pipeline expanded Sep 30: 5→8 stages (added `catch-up`, `artwork-extract`, `rb-comment-sync`, `album-push.kit.py`), `--ai-fallback` flag for AI genre stragglers, RB-closed gate with skip+warning.
- SHELF1/drive-day pipelines: prep offline (fixes, baselines, dry checks), report ready, then wait for explicit mount confirmation before shelf-sync/RB writes ("plugged in, do it") (Sep 29).
- After material mood/analysis pipeline changes, pilot a bounded cohort and compare to the prior baseline before fleet-wide `--force` re-analysis (Sep 29).
- Iterates by re-sending and deepening ("status now?", "full canvas update fully") — each pass must re-measure live and land visible artifacts (canvas version bump, doc status header, pushed commit), not re-assert old numbers.
- Quota-style quality passes (N calculation fixes, N visual bugs, hundreds of LOC dedup) require manual per-file review and judgment — grep/lint/check alone does not satisfy the ask (Sep 26 build-fixing session).
- Booth metadata: mix-first v4 (IN/OUT bars, vocal clash, structure, genre-relative mood words) over v3 vibe + A/H percentages; paste/update the written spec when iterating — not ad-hoc comment tweaks (Sep 30).
- Genre source expansion (Oct 1, fully wired): **10-rung vote ladder**: bp(0.60) > file(0.55) ≥ discogs(0.55) > bc(0.50) > ai(0.45) > mb(0.40) > sc(0.35) > lastfm(0.30) > sync(0.20) > imprint(0.15). New rungs wired in `fetch-pipeline.ts`: Last.fm W8 (`LASTFM_API_KEY` env, tag count ≥ 25); MusicBrainz recording-level (`mbGenreForRecording`); Discogs W9 (`MEGADJ_DISCOGS_DB` env, offline SQLite cache via `discogs-vote.ts`). **Remix routing** (`remix-route.ts`): artist-level sources (SC/MB/Last.fm) query the remixer when a remix/edit/bootleg is detected. **Evidence bridge** (`vote-evidence-bridge.ts`): every fetch run populates `genre_evidence` for the Dawid-Skene estimator (dynamic import, degrades silently). SC tag sanitizer built but unwired (needs per-track metadata fetch, not available in flat search). Dawid-Skene estimator + evidence store fully built, flag-gated (`MEGADJ_GENRE_ESTIMATOR=1`).
- Energy recalibration must not depend on manual reference-track judgments — library percentile ranking plus multi-feature drop-section composites is the accepted path (`docs/fulltags/energy-v3-plan-2026-10-01.md`).

## Learned Workspace Facts

- Test/support trees follow one convention (Sep 17, post-rename): per-product `test/` dirs beside source (`src/fulltags/test/`, cratedeck/test/ (now src/deck/test/), `src/test-support/` shared helpers) — never a stuttered `test-support/fulltags/fulltags` doubling. When moving a test tree, the four pin classes that break are: relative import specifiers, `import.meta.dir` constructions, knip entry globs, and ACTIVE docs citing the path (`docs-paths-census` validates those live; archived docs are exempt). Tests move WITH their subject (#23/#234, completed Sep 17); `src/` root keeps exactly the host-kit set — host-kit tests (`cli-flags`, `numeric-options`, `json-summary`) plus `src/census/` (the `*-census` / `issue-*` tripwires, #244) and `src/test-support/`; cross-domain plumbing like `progress` lives in `src/shared/`, never at the root. Test PLACEMENT rule (#246, census-pinned by `src/census/test-placement-census.test.ts`): a subject's test co-locates beside it (`foo.ts` ↔ `foo.test.ts`, any depth); a product's `test/` dir holds ONLY shared support — fixtures, workers, builders, case tables — never a subject's own test; the known co-location debt is an allowlist ratchet in that census, every row naming its migration issue (#220/#214/#235). Fixture hygiene is also census-pinned (#248): raw `mkdtempSync`/`new ArchiveState` in tests fail `fixture-seam-census` — temp dirs go through the seam and get swept.
- `AGENTS.md` and docs content is test-pinned by census tests (the two `boundary-*-census.test.ts` strings, plus `docs-paths`/`docs-safety` censuses) — keep pinned strings intact when condensing; archive-internal broken links are intentionally left (frozen snapshots).
- Genre source matching has one artist-gate SSOT, `fulltags/src/sources/name-match.ts` (test-pinned): SoundCloud and Beatport scorers both route through it; the hard must-contain-artist gate is what makes remix-safe matches possible.
- `fulltags/src/sources/bandcamp.ts` is the fetch ladder's third genre vote (W2b): `autocomplete_elastic` search → `scoreBcHits` (shares the artist gate) → JSON-LD/HTML page parse (tags, genre, label, art); `bcGenre` refuses numeric/`Music` junk like the SC/BP arms.
- Genre vocabularies are consolidated in `fulltags/src/genre/genre-vocab.ts` (one module, plainly-named maps) — it replaced the `GENRE_MAP`/`SC_GENRE_CANON`/`DJ_GENRES`/`GENRE_FAMILY` twins and the two different `inferGenre` functions.
- Genre vote ladder (#173) SHIPPED in f54ba04 (Sep 16, closed Sep 17): every rung votes (genre+weight+provenance), one election seam (`stageGenreElection`) owns tag+DB write, breakdown persists in `tracks.genre_votes`, weights versioned in code as `GENRE_VOTE_WEIGHTS` (test-pinned ordering). First-win writes are gone. The writer-only GAP closed: `genre-why.ts` is now the production reader of `ArchiveState.genreVotes()` (#215 closed Sep 17). Lesson stands: knip is blind to dead methods on live classes — only a caller census catches that class. Shipped ≠ run: a day after ship, `tracks.genre_votes` was still 0 rows (no real fetch since the ship run) — quote per-cohort run state, not the feature's existence (Sep 18). The megamem transfer doc is `docs/megaset/embedding-learnings-from-megamem-2026-09-17.md` (v2 rewrite, Sep 18: 2,003 experiments re-censused, status split 1,001 failed / 681 done / 279 skipped / 40 queued); `docs/megaset/11-master-architecture-v2.md` (`e2e08918`) is the v2 synthesis with the 7 cross-shop invariants and a reject list (all 19 DIV diversity experiments dead — diversity ships as hard caps only).
- `archive.db` is megadj's own intake ledger, not a shelf copy: rows decompose into YouTube liked-videos (music-checked by `megadj sync`, mostly never downloaded), local ingests, and playlists; `pending` ≠ gap and `skipped_not_music` rows are correctly parked non-music. Never present ledger counts as library size. Measured decomposition (Sep 18): ~5.9k tracks = 3.1k rekordbox mirror + 750 ingest + ~2.0k liked/liked-videos (1,087 liked-videos pending, unclassified since Aug 22); known audio ~26 GB vs 3,125 rows on SHELF1. YT rows are `tracks` rows keyed by video_id ONLY — zero embeddings/beats/mood; FullTags has NO YouTube search arm (votes: SoundCloud via yt-dlp, Beatport, Bandcamp), so there is no youtube-find store to reconcile. Storage/retention answers live in `docs/getdat/data-model.md` + the `storage-intake-census` skill (Sep 18, `9dae86a4`): every state-dir path has exactly one retention owner (dated backups → `tmp-purge --state`, newest per stem always kept); RB pilots zip + `.sha256`, never plain-delete; the "library size" honest answer is bytes-per-volume → ledger decomposition → per-source freshness.
- SoundCloud is a first-class DOWNLOAD source since 062355ce + 4411f57e (Sep 19, #255–#259): `src/getdat/soundcloud.ts` is the one acquisition module (format ladder `SC_FORMAT` tops out at `hls_aac_256k` with a Plus-authenticated session — cookies; `hls_aac_160k` stays the honest anonymous ceiling; walled tracks serve a 30-second preview, not the song — the MONETIZE class stays unrippable at ANY tier (Widevine; verified live against a fresh Plus session, Sep 19; a DRM-circumvention ask was refused twice — the owner-accepted paths are the purchase-link census via Beatport/Bandcamp `link_surfaced` and official SNIP alternates); link-first means purchase/free-download/smart-links (`smarturl.it` included) surface as `link_surfaced` + `source_links` and are NEVER counted as downloaded (`--force-rip` overrides; the decision lands in the ledger so sync never re-queues); SC rows key on numeric SC id; permalink 404 = permanent `gone` (the old generic class retried dead slugs forever); the HIGHQ bar is source-aware (SC ≥160k). `scExtractionArgs(formatId)` makes mp3-fallback streams COPY (`-c copy`), never re-encode — a lossy→lossy transcode of an mp3 stream is double lossy (pinned in `soundcloud.test.ts`, Sep 20). The #278/#279 analysis DB short-circuit is a rule, not an optimization: ledgered == analyzed, and gap passes must skip ledgered work unless `--force` (the old `--embeddings` path re-queued 3.1k analyzed tracks into an ~8h compute storm).
- The backup decision is RECORDED (Sep 19): the shelf IS the backup — `shelf-sync` to SHELF1 gives every track two physical copies; no cloud backup infra exists or runs (issue #2 was a never-wired proposal, retired from the drive-day plan, stays parked). Don't start or assume a backup. #147 (GA-07 write-path spike) **closed Sep 30 by owner** — harness shipped, four hands-on RB observations still unrun but deprioritized until grid/cue repair is the active arc.
- Concurrent-agent collisions resolve content-first: a foreign commit that swept staged files counts as landed when the diff is byte-identical vs the worktree (hash is irrelevant); a stash round-trip restores content byte-identical but loses the staged/unstaged distinction. Staging is contested under concurrency: a plain `git add`/`commit` on the shared index can sweep (or unstage, or resurrect) another agent's paths — for surgical multi-agent commits use a temp/plumbing index containing exactly your set (`git commit-tree` + ref advance), and after any foreign sweep audit HEAD for duplicate/resurrected paths before "fixing" (Sep 18: the #244 moves landed via three cooperative sweeps; one foreign commit re-added 24 old paths alongside the new ones — the follow-up deletions completed the rename).
- rb-adopt mirrors write `tracks.codec` from the master DB's own `FileType`/`BitDepth` columns (pyrekordbox enum: MP3=1, M4A=4, FLAC=5, WAV=11, AIFF=12), never from filename extensions — a `.m4a` name on a FileType-11 row is still WAV. `rb-adopt-apply.ts` originally skipped the column entirely, leaving the whole 3,133-row rekordbox mirror as `unknown` in the Codecs card (fixed `15e8544d`, Sep 19); the UPDATE branch backfills on the next `rb-adopt --apply --yes` run with the drive mounted.
- plugin/skills files are git symlinks (mode 120000) into .claude/skills — that IS the dedup mechanism, not duplication; `wc` over `git ls-files` double-counts symlinked content (a v1 audit claimed 1.3kL of dupes that don't exist). Verify with `git ls-files -s` mode 120000 before proposing a dedup.
- Stash temp commits (`WIP on main:` / `index on main:` pairs) are git's internal bookkeeping from concurrent agents' stash push/pop cycles — thousands of "unreachable" commits are empty husks whose content landed through their real commits, never merge candidates. A pre-rewrite mirror repo (`megadj-backup-before-rewrite-20260904`, different root hashes / same subjects) was audited content-first and deleted once every unique blob was proven landed (Sep 19) — audit mirrors by blob comparison before deletion, and delete confirmed-dead mirrors rather than keeping them.
- Typecov strict-miss triage under concurrency: `check:full`'s 100% typecov dips are triaged HEAD-owned vs foreign-WIP first — fixes go only into files OUTSIDE the other agent's active edit zone (an in-flight flatMap hunk was left to its owner, contract-documented in the commit message); `Array.isArray` on `unknown` narrows to `any[]` and makes type-predicate params implicit-any, so write explicit `unknown[]` casts before the predicate (fixed `f6f62026`, Sep 19).
- The two-tree layout is GONE: `cratedeck/` folded into `src/deck` + `ops/` into `src/ops` (`7887a37a`, Sep 22, 433 files, #193-pattern atomic migration — cratedeck/{src,shared,test,web,python} → src/deck/*, docs/cratedeck → docs/deck, pyproject/python and package scripts re-pointed, knip single workspace). The #222 boundary-direction census was REWRITTEN, not deleted: the src↔cratedeck seam rule died with the fold; it now pins the folded leaf/seam paths + "no cratedeck/ regrowth" — cite that new contract, not the old two-tree rule. The fold's own incident class: hard-coded `import.meta.dir`-relative roots break one level down (deck-install REPO_ROOT crash-looped the launchd service post-push, fixed `afc6a535` with a depth-rule pin; docs CRATEDECK_DATA default `f9f12465`). STRIKE THREE of that class (Sep 23, #327 super-sure pass): the inline `nonEmptyEnv("CRATEDECK_ROOT") ?? join(import.meta.dir, "../deck")` fallback was copy-pasted into 7 files and is depth-correct only at `src/*` — the three `src/fulltags/megaset` arms silently loaded DEFAULT config (no config.toml at the phantom `src/fulltags/deck` root; calibrate's digest landed in a phantom data dir, caught live because a real one existed to compare). Config-root reads now go through ONE resolver, `crateDeckRoot()` (`src/shared/volume.ts`: env override → walk up to the package.json+.git anchor → `<anchor>/src/deck`), census-pinned by `src/shared/volume.test.ts` — never re-inline the env-fallback math, and never derive a repo/config root from `import.meta.dir` depth arithmetic in a new file.
- The Sep 23 dedup arc (#322 + #317, all closed) fixed the small-module half of the fold debt: #322 merged seven single-importer twins (search-query→`name-match.ts`, `shelf/match`→`index-files.ts`, `mb`→`mb-lookup.ts` (one politeness/rateLimit seam per external source), artwork-queue format→`fulltags/write/artwork.ts` (layering un-inverted), regate-genre→`regate.ts`, `shared/status`→`getdat/cli-commands.ts`); #317 retired pass-through twins (`walkAudioFiles`/dupescan `walkAudio` → direct `walkAudioDir`, progress's private `fmtBytes`/`fmtDur` → leaf/fmt). Its KEPT-BOTH judgments are recorded in file headers, not bugs: `src/deck/tools/walk.ts` (async server-side walker) vs `src/shared/walk-tree.ts` (sync CLI walker) stay separate per RUNTIME; `src/deck/deckapi.ts` (CLI/MCP client: offline gate, auto-start, absolute BASE) vs `src/deck/web/ui/api.ts` (browser client: same-origin, ApiError, FormData) stay separate per PROCESS — don't merge either pair without overturning those headers.
- rb-playlist reconcile (XML-twin healer) scopes to AGENT-MANAGED subtrees only (#282, `3437a574`, Sep 21): descendants of the DJ-Imports/MegaSets roots (+`--group` extras), `--all` opts back into whole-DB for manual audits — the XML sidecar intentionally carries only agent-written playlists, so a whole-DB diff false-flags ~180 rekordbox-managed rows (user playlists/folders never get NODEs, DB-side by design); doctor F7 shares the same scoping with root names interpolated from `agentGroupRoots()` (one SSOT).
- The TypeScript compiler API lives behind ONE seam, `src/test-support/ts-ast.ts` (#274, Sep 22): every census/test/tool imports `parseSourceFile`/`forEachChild`/`is*` guards/enums through it, and `src/census/ts-api-seam-census.test.ts` fails any direct `import * as ts from "typescript"` elsewhere. TS7 IS the toolchain now (#338 landed Sep 23 via dumpster-clean): the `typescript` package root is a 2-export stub and its `unstable/ast*` subpaths ship the 345 `is*` guards + enums but NO text→SourceFile parser (probed live — the parser lives inside the native binary). The seam therefore binds the compiler API to the aliased devDep `typescript-compiler-api` (= `npm:typescript@5.9.3`, the last full JS API) — exactly that ONE file imports the twin; the boundary/CCN census digests stayed byte-identical through the swap (122 census tests re-run green). The earlier "type-coverage crashes on TS7" claim is OBSOLETE: type-coverage 2.30.1 passes 100% (187,872/187,872) under the native compiler. Do not re-inline `typescript` imports in census files — the native package has no parser to import.
- Doctor F7's output contract is TEST-PINNED (`doctor-state.test.ts`, #323): 3437a574 reworded the fix line from whole-DB to agent-managed scope and any automation parsing the old wording would have misfired. The `fix:` line carries the ONE repair command (`run: megadj rb-playlist reconcile <drive> --apply --yes (rekordbox quit)`), a negative missing-count reads as UNKNOWN (never a silent pass), and the green detail names the agent-managed scope — change any of those and the named test fails in the same commit. Audit result (Sep 22): no in-repo automation parses doctor fix lines today (checked MCP tools, runbooks, skills, ops scripts, deckctl); the pin is the guard for FUTURE parsers.
- Stash discipline on a shared worktree: `git stash push <paths>` + `git stash pop` can LOSE the pop silently when a foreign agent's index sweep intervenes (`No stash entries found` after a successful push = the pop must be retried from the stash reflog, not assumed). After any stash round-trip, `git status` your exact file set before continuing — two of this session's staged files were reverted by an interleaved `checkout HEAD` and had to be redone (Sep 22, #274 pass).
- Wire-payload rounding SSOT is `src/shared/leaf/fmt.ts` (`round1`, `round2`, `round3`, `round3n`, `round4`) — ban hand-rolled `Math.round(v * 1000)/1000` / local misnamed `r4` helpers (Sep 26: `mood.ts` exported 3dp under a 4dp name; ~15 files consolidated; `round2` added Sep 28).
- Rekordbox duplicate storms trace to import path + suffix classes, not missing fingerprint tooling: `rb-import-probe` prefers shelf paths under `<mount>/Contents/` over Mac-local archive paths (paro incident: 17 `/Users/...` rows), strips `[archive …]` / `[BACKUP2]` stems for matching, and dedupes intra-batch imports (148-row audit, Sep 26); `rb-dedup` scan adds suffix-aware title+stem grouping for acoustic pairs (Sep 27); Python scanner emits `"stem-twin"` for filename-stem matches — TS parser/graph treat it like `"candidate"` (fingerprint-gated, not pathGraph) (Sep 28). Collection cleanup stays `shelf-dupescan` + `rb-dedup` + hygiene — not hand-editing master.db or guessing from filenames alone. Sep 30 deep cleanup: 94 dupe title+artist groups (78 both-files-exist, 15 one-dead-ref, 1 both-dead), 55 dead-file references removed, 94 dupes removed (preferred canonical `Contents/Artist/Album/` path over rescue/BACKUP artifacts); `djmdCue`+`djmdSongPlaylist` cascade-deleted for removed rows. Post-cleanup: 3,650 tracks, 0 dupes, 0 dead refs.
- After pyrekordbox master.db write sessions: `PRAGMA wal_checkpoint(TRUNCATE)` before `db.close()` in every RB `*.kit.py` that commits — leftover WAL crashes RB on open (5.7 MB WAL, Sep 28); all six write kits checkpoint (Sep 29 expanded beyond comment-sync only).
- `src/cli-env.ts` is the SSOT for `DB_PATH`, `MUSIC_DIR`, and cookie defaults (`nonEmptyEnv` on `MEGADJ_*` + `HOME`); throws if `HOME` is unset/empty — never hardcode `~/.local/state/megadj/archive.db` in TS/tools (Sep 29 consolidated eight dupes).
- `rb-comment-sync` runs three phases: (1) Comment write (Key·Energy·Mood), (2) comment enrichment (partial→full — key from RB `djmdKey.ScaleName`, mood-arousal-derived energy as fallback; ~3807/3819 tracks have KeyID vs sparse TXXX tags), (3) genre sync (archive.db vote-winner → RB `GenreID`); primary genre lands in RB, secondary stays archive-only.
- `album-push.kit.py` pushes album data from archive.db → master.db: matches on NFC-casefolded file path first, then title+artist fallback; creates new `djmdAlbum` rows with UUID+timestamps via raw SQL (ORM album creation fails on NULL identity key). **Junk guard** (Sep 30): rejects any album containing "UnknownArtist", "Unknown Album", or "UnknownAlbum" — the old `rb-import-probe` " · " parser generated "UnknownArtist · UnknownAlbum · Artist - Unknown Album" junk that inflated coverage from 55% honest to 94% fake (1,216 junk rows nuked, 154 cleaned from archive.db). Honest album = 55.3% (2,102/3,799); integrated into `full-pipeline.sh` stage 8.
- `tracks.genre_secondary` in archive.db holds vote runner-ups + embedding KNN (~60–64% coverage); only the vote winner writes to RB genre.
- Every `djmdGenre` row MUST have a non-null UUID — NULL UUID crashes RB on open (342 bad rows Sep 28); delete orphan genre rows with no content references; post-cleanup target is a small clean set (44 rows, all valid UUIDs, Sep 28).
- RB "missing artwork" is often embedded in the file — RB does not re-read tags after initial import; fix by extracting embedded art to `PIONEER/Artwork/<uuid-prefix>/<uuid-rest>/artwork.jpg` and setting `ImagePath` on the content row. `artwork-extract.kit.py` (pipeline stage 6, Sep 30) automates this: reads master.db ImagePath, checks disk existence (device-relative paths need mount prefix!), extracts APIC/covr from audio via mutagen, writes JPEG to disk. Disk-only writes, safe while RB is open. Trap: `ImagePath` is device-relative (`/PIONEER/Artwork/...`), not absolute — prepend the mount point for `os.path.exists()` (the first audit false-alarmed 2,525 "missing" because it checked the bare device-relative path). Sep 30: extracted 2,464 → 100% coverage (3,649/3,650).
- `mbGenreForArtist` must run each MusicBrainz folksonomy tag through `canonGenre` individually — joining all tags into one space-separated string was tag-soup (89 tracks, fixed Sep 28); `guessFromFreeText` per tag is the fallback.
- Title contamination root cause chain (#321, hardened Sep 30 after two fix rounds): yt-dlp/SC filenames are `Artist - Track.ext`; the contamination flowed through THREE layers before the fix: (1) `buildMetadata` kept the full "Artist - Track" as the title in archive.db and file tags, (2) `rb-import-probe.ts` used a " · " (middle-dot) parser that treated the ENTIRE stem as both title AND artist for " - " files (parts.length === 1 → artist = title = stem, so the strip never fired), (3) `import-write.kit.py` received the same-string artist/title and its strip also couldn't fire. Three-layer fix: `buildMetadata` now strips the artist prefix from the title when `splitArtistFromTitle` extracts the same artist, `rb-import-probe.ts` uses `splitArtistFromTitle` for non-" · " stems (no more `parts[0]` = whole stem as artist), `import-write.kit.py` handles `artist == title` as a fallback. Test-pinned in `metadata-build.test.ts` (8 cases) and `rb-import-probe.test.ts` (4 stem-parsing cases). The filename parser `parseFilename` in `media-probe.ts` (used by `ingest`) already split on " - " correctly — only `rb-import-probe` was wrong. When adding a new title-reading path, use `splitArtistFromTitle` or `parseFilename`, never hand-parse.
- Production `tracks.energy` is still Energy 2.0 (`measureRms` → `energyFromLufs` blended with danceability + arousal in `pipeline-stages.ts`); docs calling it a loudness meter describe shipped behavior and explain EDM library saturation (~8.5/10 avg). Energy v3.1 core pipeline SHIPPED (Oct 1): `energy-features.ts` (DB schema + inline Python extractor, 12 signals across Tiers A+B, 6 ONNX models), `energy-composite.ts` (5 blocs, 4 weight presets, rank normalization, E1–E9 banding, dead-signal auto-exclusion IQR<0.02), `energy-validate.ts` (6 non-circular gates: bloc-dominance, not-BPM, tier-agreement, genre-direction, gain-invariance, duplicate-consistency), CLI `megadj energy --phase0|--extract|--freeze|--score|--gates|--full|--shadow|--json` + `megadj energy-why <video_id>`. 80 tests, 1527 assertions. NOT yet switched over: Phase 4 (pipeline-stages.ts swap, comment-sync update, `--apply`) + Phase 5 (bench verification) — `docs/fulltags/energy-v3-plan-2026-10-01.md`.
- DJ metadata signals research (Oct 1, `docs/archive/dj-metadata-signals-research-2026-10-01.md`): 1001Tracklists co-play graph is the main genuinely unwired external signal for MegaSet transitions; Last.fm WIRED as W8 (Oct 1); MusicBrainz deepened to recording-level (Oct 1); Discogs WIRED as W9 (Oct 1, offline SQLite cache); evidence bridge populates `genre_evidence` table for Dawid-Skene; remix routing (`remix-route.ts`) directs artist-level genre queries to the remixer. 10-rung ladder: bp(0.60) > file(0.55) ≥ discogs(0.55) > bc(0.50) > ai(0.45) > mb(0.40) > sc(0.35) > lastfm(0.30) > sync(0.20) > imprint(0.15). Remaining unwired: 1001Tracklists co-play graph, rekordbox play history, SC per-track tags (needs `--print-json` fetch arm).
