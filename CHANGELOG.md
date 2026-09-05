# Changelog

All notable changes to megadj are documented here. Format:
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: semver.

## [Unreleased]

### Added

- FullTags analysis stages (roadmap rev 4 #1–#3, Sep 5 2026): `--fingerprint`
  (chromaprint → `TXXX:ACOUSTID`), `--bpm` (beat_this → `TBPM`, half/double
  folded into 70–180), `--key` (OpenKeyScan analyzer → `TKEY` +
  `TXXX:CAMELOT`); all offline, idempotent via existing-stamp detection,
  missing-env → skip note. Schema grows `fingerprint`/`label`/`mixName`
  (+`camelot` patch field); writers/readers updated for every format
  (m4a freeform `initialkey`/`CAMELOT`/`ACOUSTID`/`LABEL`/`MIXNAME`).
  New `fulltags/verify-key.ts` gauntlet gate (≥80% Camelot-aware agreement)
  and `fulltags/test/analysis.test.ts` (14 env-gated tests).
- AI provenance: AI-filled genre/year stamped as `TXXX:AI-GENRE` /
  `TXXX:AI-YEAR` with classifier confidence; `fulltags audit` reports
  `aiFilled` per track (text + `--json`).
- `megadj fetch` live progress bar with ETA (plain milestone lines when
  piped).
- `megadj init`: scaffolds `cratedeck/config.toml`, auto-fills master/
  mirror drive names from mounted volumes, copies `.env.example` → `.env`,
  then runs `megadj doctor`.
- `megadj doctor` / `megadj init` first-run diagnostics (`--json` usable as
  a gate; exits 1 when a required check is broken).
- `--json` machine output on every `megadj` command (P1: agent-first —
  one summary object on stdout, exit code still meaningful).
- CrateDeck MCP server (`bun run mcp`) — 10 tools mirroring `deckctl`;
  mutating tools annotated, rekordbox interlock enforced in-tool.
- CrateDeck `deckctl` CLI: `status|drives|report|run|coverage|redundancy|
diff|jobs|cancel|stop|explain` with `--json`, spinner + ETA, exit 3 on
  the rekordbox interlock.
- Fleet queries: `coverage` / `redundancy` / `diff` across drives (UI, API,
  and CLI).
- ⌘K global search over all snapshots in the web topbar.

### Changed

- `tools/fetch_all.ts` reuse of the shared `ProgressBar` (one progress
  implementation for the whole repo).
- Config story documented in one place (README §Configuration): config
  file → env override → default.
- `fulltags/` tests count 68 after schema validation + bugfix regression
  additions.

### Removed

- CI workflow: the repo is one author on one Mac — the gate is local
  (`bun run check && bun test`). Recorded in `docs/PRINCIPLES.md` §1.

### Fixed

- FullTags: five bugs found in a same-day audit, fixed with regression
  tests (`fulltags/test/m4a-stamps.test.ts`, suite 56 → 68+):
  - `fulltags single <file>` misparsed the file as the target dir
    (parseArgs only skipped `audit` as a subcommand).
  - failed ffmpeg tag writes leaked the `.tagged` tmp file (async path's
    cleanup never ran past a thrown `$`; sync path checked nothing).
  - m4a silently dropped bpm/energy/mbid/AI stamps and wiped freeform
    atoms on every rewrite (ffmpeg ipod muxer) — M4A writes now go through
    mutagen (`writePatchMp4`), `readTxxx` parses m4a freeform + flac
    Vorbis stamps (idempotency restored).
  - `qualityScore` treated AIFF/hi-res WAV as lossy (only pcm_s16le was
    recognized) — explicit `LOSSLESS_CODECS` set.
  - `audit --json` never exited 1 on gaps (CI contract restored).
- GetDat (`megadj sync` + downloader): ten bugs found and fixed with
  regression tests (`src/commands/sync.test.ts`, suite now 54):
  - `--json` mode leaked human logs into stdout on `sync`/`adopt`/
    `organize`/`enrich` (artwork/ingest already suppressed) — agents got
    unparsable output; PRINCIPLES §1 restored everywhere.
  - expired cookies classified every live video **GONE** (`sign in to
    confirm` was in the gone patterns) and `markGone` is permanent — one
    dead session poisoned the archive; auth-shield text now backs off and
    retries (`megadj retry` requeues a failed run).
  - `--dry-run` mutated the state DB (playlist upserts + a finished run
    row); it now previews the would-be queue in memory and writes nothing.
  - `fetchPlaylist` ignored `MEGADJ_COOKIES` browser extraction — the
    default config (cookies=chrome, no jar) failed playlist auth even
    though the downloader would have used the same session.
  - a landed file vanishing before `stat()` (AV quarantine, race) threw
    and killed the whole run mid-archive; now logs a warning, counts the
    track, keeps going.
  - `--target-total abc` was silently ignored (NaN is falsy) and started
    an UNBOUNDED run; numeric sync options now validate (whole number >= 0)
    and `--target-total 0` actually stops immediately.
  - `Downloader`'s `ytdlpBin` option was declared and silently ignored —
    every spawn hardcoded the binary; the option is now honored (and args
    go through one hardened array-interpolation spawn).
  - removed dead code: `requality` option, `startTotal`, `pendingTracksFromSource`.
- GetDat round 2 — five more bugs found and fixed with regression tests
  (`src/commands/fetch.test.ts`, new; src suite 54 → 60):
  - `megadj fetch` parsed `--art|--genres|--tags|--years|--jobs|--dry-run`
    and then dropped all of them when spawning `tools/fetch_all.ts` — every
    scoped run did the full pass with default workers.
  - `megadj audit` / `auditArchive` read only the archive's top level;
    after `organize` moved tracks into genre subfolders it audited an
    empty set and reported 0/0 vacuous success. Now walks recursively.
  - `tools/fetch_all.ts` matched DB rows by *basename* against a top-level
    file set — organized tracks were silently skipped by every fetch pass
    and two same-named tracks in different genre folders collided.
    `archiveFiles()` now walks recursively and rows match by full path.
  - `megadj artwork` rewrote its queue with `entries.slice(batch.length)`,
    deleting batch entries that never completed: a failed generation or
    embed had its queue entry silently dropped forever (the log even said
    "entry stays in queue"). The rewrite now keeps every entry that did
    not finish, and `leftInQueue` reflects reality.
  - `megadj enrich` retagged with a raw `ffmpeg -c copy` remux: the AIFF
    muxer drops the ID3 chunk (the documented repo gotcha), so enriched
    tracks lost embedded artwork and comments, and a failed run leaked an
    orphan tmp per corrupt input. Now routes through FullTags'
    format-aware `writePatch` (atomic, mutagen for AIFF/WAV/m4a).
- GetDat round 3 — five more bugs found and fixed with regression tests
  (src suite now 69; new `enrich.test.ts`, `organize.test.ts`,
  `adopt.test.ts`):
  - `ArchiveState.migrate()` never added the `tracks.year` column that
    `megadj fetch` and `megadj years` write with plain SQL — every such
    write crashed a freshly created DB with "no such column: year"
    (existing DBs only worked because the column was added by hand).
    Fresh databases now migrate it automatically.
  - `megadj enrich` recorded the new genre in the DB even when the
    in-file tag write failed — DB and file diverged silently, and the
    track became invisible to every later enrich pass (its genre was no
    longer "weak/missing"). The DB update is now gated on the file write
    succeeding, and failures are counted + reported (`writeFailed`).
  - one corrupt line in `artwork-queue.jsonl` (partial write, hand edit)
    bricked the whole `megadj artwork` pass: the JSON.parse throw was
    caught as "queue is empty" and the command exited 0 having done
    nothing. Bad lines are now skipped and counted; good entries still
    process.
  - `megadj organize` updated `file_path` unconditionally after a
    quiet+nothrow `mv` (and crashed outright if `mkdir -p` failed) — a
    failed move left the DB pointing at a file that never existed, and
    every later pass treated the phantom path as ground truth. Moves and
    mkdirs are now exit-code gated; failures keep the old path and are
    reported (`moveFailed`).
  - `megadj adopt` / `megadj ingest` crashed when a file vanished between
    the directory walk and its `stat()` (cleanup, another agent) — one
    ENOENT killed the whole pass. Both now skip the vanished file and
    keep going (same hardening `sync` got in round 1).
- `scripts/export-cookies.sh` success line printed literal garbage;
  now reports the real cookie count.
- FullTags audit: five bugs found and fixed with regression tests
  (`fulltags/test/m4a-stamps.test.ts`, suite now 68):
  - m4a tag writes silently dropped `bpm`/`energy`/`aiGenre`/`aiYear`/
    `remixer`/`mbid` — ffmpeg's ipod muxer has no metadata mapping for
    those keys and every remux wiped existing freeform (`----`) atoms.
    m4a now writes through mutagen (`writePatchMp4`), matching the
    WAV/AIFF pattern; `readTxxx` reads m4a freeform atoms and flac
    vorbis comments, restoring pipeline idempotency on those formats.
  - failed ffmpeg writes leaked an orphan `.tagged` tmp file per corrupt
    input (async path's exit-code check was dead code — Bun `$` throws
    `ShellError`); both paths now clean up.
  - `qualityScore` scored AIFF (`pcm_s16be`) and hi-res WAV
    (`pcm_s24le/32le`) zero lossless bonus — only `pcm_s16le` mapped —
    so AIFF masters lost dupe-resolution; explicit codec set now.
  - `fulltags audit --json` never exited 1 on gaps (megadj audit parity:
    exit code is the gate in both output modes; json also carries `ok`).
  - `fulltags single <file>` was unparsable — `single` was picked up as
    the target, so the documented per-file hint entrypoint always
    printed the usage error.

## [0.1.0] — initial public release

- GetDat: YouTube/SoundCloud archiver feeding the archive DB.
- FullTags: one-pass enrichment (tags, genre, year, art, remixer, energy)
  with format-gotcha-safe atomic writes.
- CrateDeck: drive dashboard + verify/mirror/checksum jobs + fleet views.
- megadj CLI: ingest, sync, audit, artwork, doctor, init.
