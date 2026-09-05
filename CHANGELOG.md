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
- `fulltags/` tests count 57 after schema validation additions.

### Removed

- CI workflow: the repo is one author on one Mac — the gate is local
  (`bun run check && bun test`). Recorded in `docs/PRINCIPLES.md` §1.

### Fixed

- `scripts/export-cookies.sh` success line printed literal garbage;
  now reports the real cookie count.

## [0.1.0] — initial public release

- GetDat: YouTube/SoundCloud archiver feeding the archive DB.
- FullTags: one-pass enrichment (tags, genre, year, art, remixer, energy)
  with format-gotcha-safe atomic writes.
- CrateDeck: drive dashboard + verify/mirror/checksum jobs + fleet views.
- megadj CLI: ingest, sync, audit, artwork, doctor, init.
