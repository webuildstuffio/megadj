# Changelog

All notable changes to megadj are documented here. Format:
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: semver.

## [Unreleased]

### Added

- **Structure cues slice v0 + audit-gate upgrade (Sep 5 2026, pass 3):**
  - **`megadj cues [--limit N] [--force] [--dry-run] [--json]`**
    (`src/commands/cues.ts`): derives DJ phrase markers (every 8 bars)
    from the beats ledger's downbeat arrays into the new `cues` table
    (`src/state.ts`: `setCueRecord`/`cueRecord`/`cueAnalyzedTracks`).
    Pure deterministic slicer (`phraseCues`), trailing partial phrases
    dropped, idempotent by video_id. **88/88 tracks cued, 1366 cues.**
    DB-side only — the rekordbox memory-cue WRITE pass is the deliberate
    next gate (interlock + gauntlet apply).
  - **Audit gate requires mood + energy** (`fulltags/src/schema.ts`
    `COMPLETENESS_FIELDS`, `fulltags/cli.ts` audit, `megadj audit`):
    the completeness gate now flags files missing the TXXX:MOOD /
    TXXX:ENERGY stamps. `groundTruth` now reads TXXX:ENERGY (it was
    hardcoded `null` — `readFullTag().energy` always lied). Archive:
    88/88 complete under the upgraded gate. Tests: phrase-slicer unit
    tests + cue-ledger round-trip + schema completeness pin.

- **Roadmap rev 6.2 — mood execution pass 3 + CrateDeck mood surface
  (Sep 5 2026):** finished the "then" block of the roadmap by executing
  and hardening what rev 6.1 shipped.
  - **Mood convergence verified on the real archive:** re-run of
    `fulltags --mood` = 0 changed (idempotent); `megadj mood` mirror
    re-synced 88/88 ledger rows (`--force` re-reads file stamps).
  - **CrateDeck readonly mood surface:** `ArchiveReader.moodProfile()`
    (ledger averages + per-axis high/low extremes with title/artist
    joins), `GET /api/archive/mood`, and MCP tool
    `archive_mood_profile` — "play me something dark/hyped/smooth"
    picker data for agents/UI, zero audio touched. Degrades cleanly on
    pre-mood DBs (no `mood` table) and empty ledgers (no NaN).
  - **Energy 2.0 verified end-to-end + measureRms bug fixed:** 84/88
    archive files already carried the `0.5·RMS + 0.3·dance +
0.2·arousal` blend (written by the mood pass); the 4 misses were
    art-embedded WAVs — the embedded cover decodes as a bogus video
    stream, ffmpeg's default stream selection fed it into the astats
    graph, the decode failed, and the whole command exited non-zero →
    `measureRms` returned null and the energy stage silently skipped
    (`fulltags/src/probes.ts`). Fixed with `-map 0:a`; regression test
    embeds an APIC cover on a WAV first; repaired pass = 88/88 stamped,
    re-run 0 changed.
  - **effnet genre ONNX confirmed absent upstream:** the
    `genre_discogs400` head dir ships 7 ONNX files, all maest variants;
    the effnet head is pb-only (its own `model_types` lists `onnx` but
    every ONNX URL 404s). Combined with the saturation gate failure,
    genre-head writes are **deferred indefinitely**.
  - Tests: `moodProfile` extremes/degradation tests in
    `cratedeck/test/archive.test.ts` (11 pass), art-embedded-WAV energy
    regression in `fulltags/test/pipeline.test.ts`.

- **Mood pass over the archive + label-order hotfix + `megadj mood`
  ledger (Sep 5 2026, late night):** the rev 6.1 mood suite executed for
  real, one bug caught and fixed in the process.
  - **Label-order hotfix** (`fulltags/src/models.ts`): the first archive
    pass stamped every track `dance=0.00 party=1.00` — the head softmax
    order was read as `[not_X, X]` but is **positive FIRST for every
    head except mood_party** (per each model's .json:
    `['danceable','not_danceable']`, `['aggressive','not_aggressive']`,
    `['happy','non_happy']`, `['electronic','non_electronic']`,
    `['non_party','party']`). Caught because saturated-constant output
    is never believable; direct ONNX probe on a real track confirmed
    sane values after the flip. All 88 MOOD+ENERGY stamps stripped and
    re-run; third pass = 0 changed (converged idempotent). Regression
    test pins the label order in `fulltags/test/models.test.ts`.
  - **`megadj mood [--limit N] [--jobs N] [--force] [--dry-run]
[--json]`** (`src/commands/mood.ts`): syncs `TXXX:MOOD` file stamps
    into the new `mood` table in the archive DB (`src/state.ts`:
    `setMoodRecord`/`moodRecord`/`moodSummary`) and analyzes unstamped
    tracks inline. 88/88 ledgered, avg dance 1.0 / party 0.99 /
    valence 4.34 / arousal 4.98; re-run is a no-op. P1 `--json` clean.
  - **Electronic genre-head gate FAILED (kept BLOCKED):** the effnet
    electronic head is saturated on this library — 0.87–1.0 across
    every genre including Ambient — so genre writes from it would
    destroy ladder-sourced genres (same verdict pattern as the TBPM
    gate). dance/happy/aggressive DO differentiate (happy 0.04–0.99,
    aggressive 0.01–0.98); mood fields stay, genre stays multi-vote.
  - Tests: label-order pin + 3 mood-ledger tests — suite at 94 (+3 in
    `src/mood-ledger.test.ts`).

### Added

- **FullTags roadmap rev 6.1 — #4 + #5 SHIPPED (Sep 5 2026, late night):**
  the ONNX mood suite and the MB genre harvest are live.
  - `fulltags <folder> --mood` (`fulltags/src/models.ts`): Essentia ONNX
    heads on onnxruntime — discogs-effnet embeddings feed danceability +
    aggressive/happy/electronic/party heads; audioset-vggish embeddings
    feed the emomusic valence-arousal head. Writes `TXXX:MOOD`
    (`dance=…; aggressive=…; …; valence=…; arousal=…`), idempotent by
    stamp presence. `fulltags ensure-models` pre-downloads the ~320 MB
    model set to `~/.local/share/fulltags-models` (CC BY-NC-SA, personal
    use); first `--mood` run auto-downloads with an explicit notice.
  - **Energy 2.0:** when a MOOD stamp exists the energy stage blends
    `0.5·RMS + 0.3·dance + 0.2·arousal` (0–10 scaled) instead of raw RMS;
    verified 1.0 → 1.9 on a test tone, idempotent. No stamp → pure RMS
    (old behavior preserved exactly).
  - **MB genre harvest** (`fulltags/src/mb.ts`): artist folksonomy tags →
    canonical map, 1 rps bucket, in-process cache. `megadj enrich` is now
    a thin shim over it + the shared FullTags writer — **the last
    duplicate writer is deleted** (the old in-file ffmpeg remux dropped
    AIFF art on failure paths; every genre write now goes through
    `writePatch`). Genre ladder: SC tag → canonical map → MB folksonomy →
    AI (conf ≥ 0.7).
  - Tests: 8 new in `fulltags/test/models.test.ts` (stamp round-trip,
    malformed-stamp guards, full ONNX pipeline E2E, enrichTrack mood
    idempotency, wav writer surface, MB smoke) — suite at 93.
  - Env gotchas recorded (roadmap §2/#4): effnet melspec = essentia
    `TensorflowInputMusiCNN` in 128-frame chunks (fixed batch on the ONNX
    export); head softmax order is `[not_X, X]` (positive LAST);
    emomusic = (valence, arousal) on a 1–9 scale; vggish = 400/200 frames
    → 96-frame patches transposed (64, 96).

- **FullTags roadmap rev 6 — the #2 pivot SHIPPED (Sep 5 2026, night):**
  the failed BPM gate resolved into a beats ledger, exactly as the
  roadmap's opinionated call predicted — the beat ARRAY is the valuable
  output, not TBPM.
  - `megadj beats [--limit N] [--jobs N] [--force] [--dry-run] [--json]`
    (`src/commands/beats.ts`): beat_this over every downloaded track →
    the new `beats` table in the archive DB (`src/state.ts`:
    `bpm_raw`, `bpm_folded`, `beats_json`, `downbeats_json`, `model`,
    `analyzed_at`). No tags are touched, ever. Idempotent (ledgered
    tracks skipped unless `--force`), P1-clean `--json`, corrupt-JSON
    rows degrade to re-analyze.
  - Re-gate with the new bar-grid tempo readout
    (`tempoFromBeatGrid` in `fulltags/src/analysis.ts` — bar-lag mean
    over the beat array instead of median inter-beat interval):
    **16/24 within 2% vs rekordbox — still under the 80% gate, so TBPM
    writes stay blocked.** Strictly better than the median (12/24); the
    remaining 8 failures are genuine half/double phase-locks.
  - CrateDeck independent grid cross-check:
    `ArchiveReader.gridCrossCheck` + `GET /api/archive/grid-cross-check`
    - MCP tool `archive_grid_cross_check` (readonly) — beat_this's grid
      vs RB's BPM×duration per track, classified ok / off (>2%) / octave
      (half-double lock). The verify pipeline's own grid check compares
      duration×BPM against a beat count from the SAME analysis
      (self-referential); this one pits two analyzers against each other.
  - Tests: beats-ledger round-trip/idempotency/corrupt-row +
    command-contract tests (`src/state.test.ts`,
    `src/commands/beats.test.ts`) and ok/off/octave verdict tests
    (`cratedeck/test/archive.test.ts`).

- **FullTags roadmap rev 5 — gates EXECUTED against the real archive
  (Sep 5 2026, evening):** fingerprint ledger done (88/88 stamped,
  double re-run 0 changed); key gate PASSED at **80.7% exact** on all 88
  tracks vs rekordbox-analyzed references (71 exact + 8 near + 9
  mismatch, Camelot-aware) → key writes UNLOCKED and executed (TKEY +
  TXXX:CAMELOT now in all 88 files, re-run no-op); BPM gate FAILED
  (beat_this locks 2.2–2.6% off rekordbox on 12/24 of the pilot) →
  **TBPM tag writes blocked**, roadmap #2 pivoted to a DB-side
  beats/downbeats ledger. `verify-key.ts` gains `--refs map.json`
  (external reference keys — rekordbox master.db `DjmdKey.ScaleName`
  via pyrekordbox; `DjmdContent.BPM` is x100 fixed-point). New
  execution env: openkeyscan-analyzer cloned to `~/.local/share`
  (MPS, 88 tracks ≈ 31 s). Full numbers + opinionated decisions in
  `docs/fulltags-roadmap.md` (rev 5).
- Two latent FullTags bugs found by the rev 5 execution, both fixed with
  regression tests in `fulltags/test/pipeline.test.ts`:
  (1) `readTxxx`'s WAV/AIFF branches opened files but never read the ID3
  TXXX frames — every stamp probe (ACOUSTID/CAMELOT/ENERGY/AI-\*) was
  null on WAVs, so the "idempotent" fingerprint stage re-fingerprinted
  and rewrote all 73 archive WAVs on every re-run, forever; one shared
  ID3-TXXX read loop now covers WAV/AIFF/MP3. Lesson: idempotency is
  per-container-format, not per-stage. (2) Scoped runs (`--fingerprint`)
  also wrote remix credits — remix detection is now stage-gated behind
  `want("tags")`.
- **CrateDeck O88 — findings-from-agents feed:** `deck_note {drive, note,
severity?}` MCP tool (flagged mutating, human-confirmed) lands an agent
  finding on the drive timeline as a dismissable card; `deck_notes` reads
  the active feed. Notes are timeline events (kind `agent-note`), so the
  per-drive event cap bounds growth; engine `cratedeck/src/notes.ts`
  (validate/clamp, 600-char cap) + `db.addAgentNote/dismissAgentNote/
agentNotes`; API `GET/POST /api/drives/:id/notes` +
  `POST .../notes/:id/dismiss`; the UI timeline renders severity-toned
  note cards with dismiss (history kept via `dismissed_at`).
- **CrateDeck N76 — firmware advisories in preflight:** the player matrix
  (`players.ts`) carries known firmware advisories (CDJ-3000 v3.30 pull);
  `preflight.firmware_advisories` renders informational lines in
  `deckctl preflight` — never gates.
- **CrateDeck O85 — plugin packaging:** `plugin/` is an installable
  Claude Code plugin (`claude plugin validate` passes): the 19-tool MCP
  server, a SessionStart hook posting `deckctl status --json`, and the 3
  DJ skills. Dev-install: `claude --plugin-dir $PWD/plugin`.
- FullTags analysis stages (roadmap rev 4 #1–#3, Sep 5 2026): `--fingerprint`
  (chromaprint → `TXXX:ACOUSTID`), `--bpm` (beat_this → `TBPM`, half/double
  folded into 70–180), `--key` (OpenKeyScan analyzer → `TKEY` +
  `TXXX:CAMELOT`); all offline, idempotent via existing-stamp detection,
  missing-env → skip note. Schema grows `fingerprint`/`label`/`mixName`
  (+`camelot` patch field); writers/readers updated for every format
  (m4a freeform `initialkey`/`CAMELOT`/`ACOUSTID`/`LABEL`/`MIXNAME`).
  New `fulltags/verify-key.ts` gauntlet gate (≥80% Camelot-aware agreement)
  and `fulltags/test/analysis.test.ts` (17 env-gated tests). Verification
  hardening after a super-sure pass: compressed containers (mp3/m4a/aac)
  are ffmpeg-decoded to a temp wav for the bpm+key analyzers (their
  loaders can't demux them — result ids remap to the original path,
  temps cleaned up); missing fpcalc degrades to null instead of throwing
  ENOENT; `verify-key.ts` uses note→Camelot maps extracted from the
  analyzer's own `camelot_output()` (a generic circle-of-fifths table
  mislabels every key).
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
  additions; 85 after the analysis stages + verification hardening.

### Removed

- CI workflow: the repo is one author on one Mac — the gate is local
  (`bun run check && bun test`). Recorded in `docs/PRINCIPLES.md` §1.

### Fixed

- FullTags: five bugs found in a same-day audit, fixed with regression
  tests (`fulltags/test/m4a-stamps.test.ts`, suite 56 → 68 at the time,
  85 after the analysis stages):
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
  - `tools/fetch_all.ts` matched DB rows by _basename_ against a top-level
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

## [0.1.0] — initial public release

- GetDat: YouTube/SoundCloud archiver feeding the archive DB.
- FullTags: one-pass enrichment (tags, genre, year, art, remixer, energy)
  with format-gotcha-safe atomic writes.
- CrateDeck: drive dashboard + verify/mirror/checksum jobs + fleet views.
- megadj CLI: ingest, sync, audit, artwork, doctor, init.
