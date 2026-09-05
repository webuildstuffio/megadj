# Changelog

All notable changes to megadj are documented here. Format:
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: semver.

## [Unreleased]

### Added

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
