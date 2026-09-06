# AGENTS.md — megadj

Notes for coding agents working in this repo.

## Language rule (always, non-negotiable)

**Write English only — always.** Every commit message, doc, comment, code
identifier, changelog, issue, PR description, and reply to the user must be
in plain English. No other language, ever, in any file or message this repo
produces, regardless of the language used in the request.

## What this repo is

- **Agent-first contract (PRINCIPLES.md §1, enforced by
  `src/commands/json-summary.test.ts`):** every `megadj` command takes
  `--json` — one summary JSON object on stdout (last line), human logs
  suppressed in json mode, exit code still meaningful. Adding a command
  without `--json` + a help-text entry fails the test suite.
- **Product principles SSOT: `docs/PRINCIPLES.md`** (Sep 5 2026): Mac-only/
  Pioneer-only, electronic music is the design target, AI turns unstructured
  data into structured (no manual duplicate eyeballing), zero commercial
  intent, sub-projects are named units (GetDat/FullTags/CrateDeck — one-liners
  in `docs/FEATURES.md`), latest-tech-only, ship-today. When a decision is
  unclear, PRINCIPLES.md wins. **No CI — ever** (decided Sep 5 2026):
  `.github/workflows/` was deleted outright, not disabled — hosted runners are
  shared team infra and this repo is one author on one Mac. The gate is local:
  `bun run check` && `bun test` before every push.
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
  `tools/fix_years.ts`). CLI: `megadj fetch` (enrichment pass),
  `megadj years` (year-verification pass, also `--json`), and
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
  (energy stamped as TXXX:ENERGY; re-run = no-op). 56 tests in
  `fulltags/test/`. **Perf invariant:** `setFileTags`/`writePatchSync` is
  sync — never bridge it to async code via a spawned `bun -e` (measured
  6.4× slowdown; there is a regression test). Roadmap **rev 3
  (2026-09-05, fact-checked twice — key via OpenKeyScan's analyzer
  open-source repo mode: JSON over stdin/stdout, MPS auto-select; the
  :58721 REST API is the closed desktop app's. keyfinder-cli is not in
  homebrew-core)**:
  `docs/fulltags-roadmap.md`. rekordbox tag gotchas verified: TKEY is
  read on AIFF/MP3 only (WAV RIFF INFO has no key field), and RB
  overwrites imported keys on analysis unless Key analysis is disabled —
  see the roadmap gauntlet. **Roadmap moves fast — re-read before citing:**
  rev 4 shipped #1–#3 as analysis pipeline stages (`fulltags/src/analysis.ts`:
  chromaprint fingerprints, beat_this BPM/key); rev 5 executed the gates on
  the real archive (88 files: fingerprint ledger DONE 88/88, key gate
  PASSED 80.7% + all 88 files keyed, BPM gate FAILED 12/24 within-2% —
  beat_this tempo is phase-locked ~2.2–2.6% off rekordbox on half the
  sample); rev 6 shipped the pivot: the **beats ledger** (`megadj beats`
  → archive DB `beats` table: bpm_raw/bpm_folded/beat+downbeat arrays,
  never tags; 88/88 executed, idempotent) + CrateDeck's independent
  `archive_grid_cross_check` (beat_this grid vs RB BPM×duration: ok/off/
  octave; real-archive verdict 46 ok / 40 off / 2 octave) — batch BPM tag
  writes stay BLOCKED (bar-grid re-gate 16/24 < 80%). rev 6.1 shipped
  **#4 mood/dance/valence** (`fulltags/src/models.ts`: Essentia ONNX heads
  via `uv --with onnxruntime` — effnet 1280-d embeddings → danceability +
  4 mood heads, vggish 128-d → emomusic valence/arousal; `fulltags --mood`
  → TXXX:MOOD, `ensure-models` pulls ~320 MB to `~/.local/share/fulltags-models`,
  CC BY-NC-SA personal; **energy 2.0** = `0.5·RMS + 0.3·dance + 0.2·arousal`
  when a MOOD stamp exists) and **#5 MB genre harvest** (`fulltags/src/mb.ts`,
  1 rps + cache; `megadj enrich` folded onto it + the shared writer — the
  last duplicate writer is deleted). **Archive execution (same day):**
  the first mood pass shipped with the head label order INVERTED — it is
  positive FIRST for every head except mood_party (per each model .json);
  saturated output (dance=0.00/party=1.00 on all 88) is the tell, direct
  ONNX probe confirms, stamps stripped + re-run, regression test pins it.
  `megadj mood` mirrors stamps into the DB `mood` ledger
  (`setMoodRecord`/`moodRecord`/`moodSummary`, 88/88); electronic genre
  head GATE FAILED (saturated 0.87–1.0 on every genre incl. Ambient) —
  genre writes stay BLOCKED. Head gotchas: label order positive FIRST
  (mood_party LAST), emomusic = (valence, arousal) 1–9, effnet melspec =
  MusiCNN 512/256 in 128-frame chunks (fixed ONNX batch), vggish = 400/200
  → 96-frame patches transposed (64, 96). **Pass 3 (same night):**
  `megadj cues` derives 8-bar phrase cues from the beats ledger's
  downbeats into the `cues` table (`setCueRecord`/`cueRecord`/
  `cueAnalyzedTracks`; 88/88 tracks, 1366 cues, idempotent, DB-side —
  rekordbox memory-cue writes remain a gated next step). The audit gate
  now REQUIRES mood + energy (`COMPLETENESS_FIELDS` + both audit CLIs);
  `groundTruth` reads TXXX:ENERGY (was hardcoded null, so
  `readFullTag().energy` always lied).
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
  backlog in `docs/ideas.md` (§0 = do-now gate; §0 items are tracked as
  GitHub issues — file one per new §0 item and link it from the doc).
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
  - server-side phantom-job reaper marking stale `running` jobs `interrupted`
    after 2min + UI re-sync on reconnect + cache-busting headers).
- CrateDeck dedupe/stream gotchas (regression-tested): the `setSnapshot`
  change-detector must recurse — `JSON.stringify(o, keys)` passes a replacer
  ARRAY, which filters keys at EVERY depth, so nested objects stringify as
  `{}` and same-length nested edits (track/playlist changes) looked
  "unchanged" and were dropped (`db.ts canon()`, test
  `db.test.ts "nested-only change"`); `jobs.ts drain()` must append only the
  new bytes of each stdout chunk — `out += carry + text` re-counted the
  previous chunk's tail every iteration, duplicating text through captured
  verify output (`test/jobs-drain.test.ts`); `deckctl coverage|redundancy`
  take an optional min-copies arg that must be forwarded from `main()`.
- More CrateDeck job-progress gotchas (round 2, regression-tested): ETA in
  `setJobProgress` is TRI-STATE — undefined = keep, null = clear — the log
  updater omits it and must not wipe the estimator's value (test
  `db.test.ts "keeps ETA…"`); usb_verify.py phase markers are INDENTED, so
  phase regexes must match untrimmed lines, and `tick(from, to)` means
  done/total — a phase span must be passed as `tick(progress, 1)` (pure
  `verifyPhase()` in `jobs.ts`, `test/verify-phases.test.ts`).
- CrateDeck round-3 gotchas (regression-tested): `inferRole` must compare
  against the CONFIGURED master/mirror volume names (`DB.masterName`/
  `mirrorName`, set from config in `index.ts`) — hardcoding DJMASTER/
  DJMIRROR made custom-named masters `role: unknown`, killing parity
  checks + sync badges; the DrivePage poll loop must self-heal a failed
  FIRST load (idle branch retries while `loadError` is set, else the
  "Loading failed" card sticks forever); SSE `job` events fire up to ~4/s
  per running job — App coalesces `refreshJobs` to ≤1/s and DrivePage
  throttles its drive-scoped fetch to ≤1/2s, or a long verify hammers the
  server with thousands of redundant fetches.
- **CrateDeck agent surface (Sep 5 2026):** `cratedeck/src/mcp.ts` is an MCP
  server (MCP 2025-06-18, stdio JSON-RPC) exposing the deckctl surface as
  21 tools (pass-3 audit Sep 5 2026; rev 6/6.2 added the archive
  `archive_grid_cross_check` + `archive_mood_profile` reads) — the
  original 10 (`deck_status/drives/report/coverage/
redundancy/diff/jobs/run/cancel/explain`) plus `deck_preflight` (B12),
  `deck_players` (N75/N78 hardware compat from measured dual-DB rows;
  matrix in `cratedeck/src/players.ts`, user-extendable via config.toml
  `[players.players]`), the O82b archive half
  (`archive_search_tracks/track_stats/ingest_status/lowq_queue/
source_diff/grid_cross_check/mood_profile` — readonly reads over megadj's
  archive DB via
  `cratedeck/src/archive.ts`, opened `readonly: true`, so a bug there
  cannot corrupt archive state; missing DB degrades to `available:false`),
  and the O88 pair `deck_note` (mutating, human-confirmed findings) /
  `deck_notes` (readonly active feed).
  `bun run mcp` from repo root; guide + registration snippet in
  `cratedeck/deckctl.md` §MCP; `plugin/` packages the whole surface as an
  installable Claude Code plugin (O85 — manifest + MCP + SessionStart hook

* the 3 skills; `claude plugin validate` passes). Readonly tools carry
  `readOnlyHint: true`
  annotations; `deck_run`/`deck_cancel`/`deck_note` are flagged
  `[MUTATES DRIVE STATE]` and the rekordbox interlock is enforced inside
  the tool layer
  (prompts are suggestions, exit codes are law). **O88 agent notes:**
  notes ARE timeline events (kind `agent-note`) — the 2000-per-drive event
  cap bounds growth automatically; engine `cratedeck/src/notes.ts`
  (validate/clamp, 600-char cap) + `db.addAgentNote/dismissAgentNote/
agentNotes`; API `GET/POST /api/drives/:id/notes` + `POST .../notes/:id/
dismiss`; dismissal flips `dismissed_at` (history kept) and the active
  feed skips it; TimelineTab renders severity-toned cards with a dismiss
  button. **O87 attribution:**
  `jobs.origin` ("web"/"deckctl"/"auto"/"mcp:<session>") rides on job
  rows + timeline events so agent actions are distinguishable in `deckctl
 jobs` and the UI timeline. ⌘K global search over all snapshots ships in
  the web topbar (`GET /api/search`, B9). B12 preflight
  (`cratedeck/src/preflight.ts` + `deckctl preflight` + `/api/preflight`)
  is the gig-night gate: worst-status-wins verdict per drive
  (not-ready/attention/unknown/ready), unknowns never fake ready, exit 1
  when not ready — cron/agents gate on the code; includes the N75 player
  compat check (fully blocked drive = not-ready) and N76 firmware
  advisories (`firmware_advisories` in the report, informational only).
  O83 weekly digest:
  `deckctl prep [--out FILE]` (`cratedeck/src/weekly_prep.ts`, pure
  renderer) → markdown over preflight + redundancy + archive reads. Doc
  alignment: ideas.md B9/B12/N75/N76/N78/O82/O83/O85/O86/O87/O88 are
  marked shipped.

- **Docs hygiene passes (Sep 5 2026):** docs go through `/docs-audit`
  rounds (SSOT-merge duplicates, kill stale claims, verify against code)
  before pushes; `knip.json` was added so knip flags real dead code instead
  of legitimate entry points (tests, web components, standalone CLIs); a
  repo-wide cleanup pass fixed hardcoded user-specific paths in
  `tools/fetch_lib.ts`/`fetch_all.ts`/`fix_years.ts`/`artwork.ts` —
  new tools take volume names/paths from config, never literals.

## Local-only files

- `(local ops log)` (operations log) and the previous private version of
  this file are **gitignored** — they contain personal library details and
  never get committed. Keep them local; back up copies outside the repo.
