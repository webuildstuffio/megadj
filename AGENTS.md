# AGENTS.md — megadj

Notes for coding agents working in this repo.

## What this repo is

- megadj is a YouTube Music archiver (Bun/TypeScript CLI) feeding a pair of
  DJ USB drives: a **master** and a **mirror** (kept identical). Volume names
  are user-specific — examples in docs/scripts use `DJMASTER`/`DJMIRROR`;
  override via arguments, `config.toml`, or `USB_SYNC_MASTER`/`USB_SYNC_MIRROR`.
- Rekordbox device libraries are dual-DB: OneLibrary `exportLibrary.db`
  (SQLCipher) plus legacy `export.pdb`/`exportExt.pdb`/`playlists3*.sync`
  that older players (XDJ-XZ, legacy CDJs) read; a sync is only done when the
  export.pdb live-row count equals the OneLibrary count. Full pipeline +
  safety rules (quit rekordbox before DB edits, never write drive DBs in
  place, never delete source files) live in
  `.claude/skills/rekordbox-usb-sync/SKILL.md`. CrateDeck's verify job is a
  read-only deep integrity audit of exactly these failure modes: dual-DB
  agreement, audio file existence per DB track, ANLZ files at the hashed
  paths hardware looks up, grid sanity (duration × BPM ≈ beat count),
  playlist integrity, cross-drive parity; `deckctl explain` documents every
  job type.
- `megadj ingest` (`src/commands/ingest.ts`) imports external downloads into
  the archive: MusicBrainz album/date fill, iTunes artwork embedding, genre
  inference, `--dry-run` flag; zips expand + delete only when fully ingested;
  sources are moved (not copied) after success. User-facing guide:
  `.claude/skills/new-music-intake/SKILL.md`.
- `tools/fetch_all.ts` is THE consolidated post-ingest pass (tags + genres +
  artwork + years, parallel, idempotent, ground-truth file reads). Art
  ladder: SC search → SC page og:image at original/t1080 res → hypeddit
  gateways → mp3-twin → Deezer → iTunes → AI queue. Genre: SC tag → canonical
  map → OpenRouter flash-lite (conf ≥ 0.7). Years: SC upload timestamp/page
  `display_date` (flash-lite guesses 2023 — always verify via
  `tools/fix_years.ts`). CLI: `megadj fetch` (enrichment pass) and
  `megadj audit` (ground-truth completeness gate).
- **FullTags** (`fulltags/`, Sep 4 2026) is the in-repo enrichment engine
  sub-project: every tag/art capability (formerly scattered across
  `src/metadata.ts`, `src/commands/{energy,embed,remix,wav-to-aiff}.ts`,
  `tools/fetch_lib.ts`, `tools/fetch_ai.ts`) behind one schema
  (`FullTag`/`TagPatch`), one atomic writer (`writer.ts` — all format
  gotchas: ffmpeg drops AIFF ID3 chunks → mutagen; WAV art via mutagen APIC;
  mp3 id3v2.3; **ffmpeg infers the muxer from the tmp filename, so tmp
  outputs must keep their extension**), file-first readers, the full art
  ladder, and a standalone CLI (`bun run fulltags/cli.ts <target>
  [--tags|--genre|--art|--year|--energy] [--dry-run]`; `fulltags audit
  <folder> --json` = same completeness gate as `megadj audit`). megadj's
  modules are thin re-export shims — import surface unchanged. Idempotent
  (energy stamped as TXXX:ENERGY; re-run = no-op). 49 tests in
  `fulltags/test/`. Roadmap (key via libKeyFinder, beat_this BPM,
  chromaprint fingerprints, Essentia ONNX heads — research-verified Sep
  2026): `docs/fulltags-roadmap.md`.
- **rekordbox WAV artwork**: RB never reads art embedded in WAVs (RIFF INFO
  has no art field; it ignores the ID3 APIC chunk). Two-part solution:
  (1) **ingest converts new WAVs → AIFF** (`src/commands/wav-to-aiff.ts`,
  lossless stream copy + mutagen ID3 frame copy — ffmpeg's aiff muxer DROPS
  the ID3 chunk, and `applyTags` uses mutagen for AIFF for the same reason),
  so new tracks have native covers; (2) **legacy** archive WAVs can be
  pointer-fixed via `tools/rb_art.py` pilot → batch. Gotcha: RB renders
  covers from `artwork_m.jpg`/`artwork_s.jpg` thumbnails — dirs with only
  `artwork.jpg` silently show nothing; `ensure_artwork_file` generates all
  three. Full research + 7-option comparison: `docs/rekordbox-wav-artwork.md`.
- **ingest module map**: `ingest.ts` (pipeline), `ingest-probe.ts`
  (probe/parse/score/quarantine/walk/MB), `ingest-art.ts` (art ladder + AI
  queue), `ingest-zips.ts` (zip expand/delete), `wav-to-aiff.ts` (RB covers),
  `identity.ts` (normalize/dupe keys), `remix.ts` (remix detection),
  `energy.ts` (RMS energy), `metadata.ts` (tag writes).
- CrateDeck (`cratedeck/`) is an in-repo Bun + TypeScript + Preact web
  dashboard showing USB drive status, playlists, analysis/beatgrid state, and
  health, reading rekordbox data through a Python seam
  (`cratedeck/python/rb_read.py`); agents drive it via the `deckctl` CLI
  (`bun run cratedeck/src/deckctl.ts` — respects the rekordbox interlock,
  exit code 3 when locked; guide `cratedeck/deckctl.md`, skill
  `.claude/skills/cratedeck-deckctl/`). Canonical product docs live in
  `docs/cratedeck/` (brief, PRD, architecture, build plan, acceptance), ideas
  backlog in `docs/ideas.md` (§0 = do-now gate).
- CrateDeck UI is a two-pane shell — left `DriveRail` + main canvas — with
  NO drawer and NO sidebar; navigation is hash-routed (`web/router.ts`,
  `#/drives/:id/:tab`, deep-linkable, browser back/forward works). Drive
  pages have tabs (Overview, Playlists, Health, Timeline, Photo); jobs live
  in a bottom-right `JobsDock`; feedback via toasts (`web/toast.tsx`); icons
  are a central SVG set (`web/icons.tsx`). Unknown drive ids render a
  "Drive not found" card (server 404s on `GET /drives/:id`).
- CrateDeck's drive health report (`cratedeck/src/report.ts`) is the SSOT
  for readiness verdicts: dual-DB hardware gate, beatgrid coverage, space,
  bitrot, mirror parity — exposed at `GET /drives/:id/report` and folded into
  the `/drives/:id/export` dossier; served in the drive page's Health tab.
  Doc set status: `docs/cratedeck/acceptance.md`.
- `deckctl` (`cratedeck/src/deckctl.ts`) is the agent/user CLI over CrateDeck:
  `status|drives|report|run|coverage|redundancy|diff|jobs|cancel|stop|explain`,
  `--json` for machines, live spinner+ETA on `run`, exit code 3 = rekordbox
  interlock. Never bypass the interlock; auto-starts the server. Guide:
  `cratedeck/deckctl.md`, agent skill: `.claude/skills/cratedeck-deckctl/SKILL.md`.
- **CrateDeck fleet superpowers**: `cratedeck/src/fleet.ts` is the pure query
  engine — `coverage()` (track × drive matrix + at-risk list), `redundancy()`
  (per-playlist pass/warn/fail with gap lists), `diff()` (added/removed/
  changed between two drives). Data lives in
  `fleet_tracks`/`fleet_playlist_entries`/`fleet_manifest` tables, refreshed
  wholesale inside `db.setSnapshot` on every scan (full scan emits per-track +
  playlist-entry rows via `python/rb_read.py`; light scan emits the audio
  manifest in `scan.ts` — identity = NFC-casefolded Contents-relative path,
  meta-join = "artist - title"). UI: Fleet page (`web/FleetPage.tsx`,
  `#/fleet/:tab`, Fleet button in topbar); API
  `GET /api/fleet/{coverage,track,redundancy,diff}`; CLI
  `deckctl coverage|redundancy|diff`. Tests: `cratedeck/test/fleet.test.ts`.
- CrateDeck engineering invariants: `rbSnapshot`/`checksumLedger` must stay
  async (spawnSync/hash loops once froze the server for minutes); snapshots
  capped at 20/drive and events at 2000/drive (disk-burn guard, enforced in
  `db.ts` migrations); `overall()` never reports `healthy` when every check
  is `unknown`; bitrot verdicts come from real checksum job results
  (`db.latestChecksum`), never hardcoded; the SSE stream needs a heartbeat —
  Bun kills silent event streams after ~10s idle, which once stranded a
  finished verify as a phantom "running 0%" forever (fixed with 5s heartbeat
  + server-side phantom-job reaper marking stale `running` jobs `interrupted`
  after 2min + UI re-sync on reconnect + cache-busting headers).

## Local-only files

- `(local ops log)` (operations log) and the previous private version of
  this file are **gitignored** — they contain personal library details and
  never get committed. Keep them local; back up copies outside the repo.
