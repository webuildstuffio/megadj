# megadj

**Make people dance.** 🪩

megadj handles the unglamorous half of DJing — the downloading, the tagging,
the artwork hunting, the USB wrangling — so you can spend your time on the
fun half. Music goes in from wherever you found it and comes out the other
side clean: properly tagged, artworked, beatgridded, on your drives, and
ready for the booth. No spreadsheets, no tag editors, no "I'll fix the
artwork later".

```
GetDat ──▶ FullTags ──▶ MegaSet ──▶ CrateDeck ──▶ 🔊 the booth
download    perfect       propose      sync &       play on
& archive   metadata      the mix      verify USBs   Pioneer
```

[Principles](docs/PRINCIPLES.md) · [Features & roadmap](docs/FEATURES.md) ·
[Current state](docs/product-state-2026-09-07.md) · [Docs index](docs/README.md)

---

## 🚀 The quick loop

```bash
megadj sync                        # 🎧 pull new music (YouTube Music + SoundCloud)
megadj fetch && megadj audit       # 🏷️ perfect the metadata, then verify it
megadj beats && megadj mood        # 🎼 BPM + mood/energy ledgers
megadj stems                       # 🎚️ Demucs stem separation (vocals/drums/bass/other)
megadj vocal-zones                 # 🎤 classify VOX/HOOK from stems
megadj catch-up                    # ⚡ one-pass gap fill: beats → mood → vocal-zones
megadj megaset --preset peak       # 🧭 propose a measured mix
megadj shelf-sync                  # 🗄️ new music out to the shelf master
bun run deck                       # 📼 dashboard: every drive, sync + verify
```

Or the **one-shot** for a single track or folder:

```bash
megadj drop <folder-or-url>        # 🎯 download → ingest → fetch → analyze → organize → audit
```

---

## 🏗️ The projects

### 🎧 GetDat — your downloads, handled

You hear a track. You want it in your library, at the best quality it
exists in, tonight.

- ⬇️ **`megadj sync`** — pulls from **YouTube Music** (liked songs, playlists)
  and **SoundCloud** (tracks, sets, user pages, likes). SoundCloud is
  **link-first**: an official purchase/free-download link is offered instead of
  ripping; `--force-rip` overrides. SC Plus sessions get 256k AAC, anonymous
  gets 160k.
- 🔁 **Nothing ever re-downloads.** SQLite tracks every video/track ID: status,
  format, bitrate, path, attempt history. Run it as often as you like.
- 🚩 **Quality only ratchets up.** Anything below the source's floor is flagged
  `LOWQ` — and `megadj upgrade` re-fetches at best quality, swapping
  only when the new file carries the _same acoustic fingerprint_.
- 📦 **`megadj ingest <folder>`** — for external folders: probe, score,
  quarantine, zip-expand, MusicBrainz fill, WAV→AIFF conversion. Distrusts
  the extension: MP4/AAC audio wearing a `.mp3` name gets renamed to its
  true container before any tag writer runs.
- 🤖 **`megadj drop <folder-or-url>`** — the whole chain in one command:
  download → ingest → fetch → years → beats → mood → cues → organize →
  tag-check → audit, hands-free. One bad file quarantines and reports; it
  never kills the batch.

```bash
megadj sync                        # bring in everything new since last time
megadj sync --limit 50 --dry-run   # peek before you commit
megadj drop <folder-or-url>        # one command, a gig-ready track
megadj status                      # archive summary + recent runs
megadj list                        # browse the archive
```

### 🏷️ FullTags — a library you'd show people

Nothing kills the vibe like "Unknown Artist", a 20-year-old release year on
a track that dropped last month, or a generic cover on a remix you love.

- ✅ **Every field, filled and correct** — title, artist, album, genre, and
  the year of _this version_ (the remix's year, not the original's).
- 🎨 **Art from where the track came from** — a SoundCloud remix keeps its
  SoundCloud cover; the art ladder escalates SC → Beatport → gateways →
  Deezer → iTunes → AI cover only as a last resort (queued + human-reviewable).
- 📚 **Genres from real stores, not tag soup.** A weighted multi-source vote
  from SoundCloud, Beatport, and Bandcamp (hard artist gate on every search
  hit) elects genres; numeric junk IDs and placeholder genres are refused at
  both write points. Umbrella genres (EDM/Electronic/Dance) are demoted at
  every ingress — they never win elections. A missing genre stays an honest
  gap, never a guess.
- 🧠 **AI fills only the gaps** — cheap flash-class models, confidence-gated
  (≥ 0.7), with provenance in `TXXX:AI-GENRE`/`TXXX:AI-YEAR` so an AI-filled
  field is always identifiable. Opt-in via `--ai-fallback`.
- 🎼 **Offline analysis** — acoustic fingerprint (chromaprint), real BPM
  (beat_this, half/double folded into the 70–180 DJ window), harmonic key
  (OpenKeyScan → TKEY + TXXX:CAMELOT), mood/dance/energy (Essentia ONNX),
  8-bar phrase cues from the beats ledger.
- 🎚️ **Demucs stems** — `megadj stems` runs htdemucs_ft (demucs-mlx, Metal-
  accelerated, ~9× realtime on M4 Pro) and caches four FLAC stems per track
  (vocals/drums/bass/other). `megadj vocal-zones` classifies VOX/HOOK for
  booth comments. `megadj stem-export` writes OverCue PGZ to USB for
  XDJ-XZ live stem control.
- 🕹️ **Booth-safe by construction** — `megadj audit` enforces the codec/text
  floor of your actual player fleet (XDJ-XZ + CDJ-3000 + 2000NXS2 default);
  `megadj booth-fix` proposes (never auto-applies) the safe fixes. ASCII + `·`
  only in booth text — no emoji, no arrows.
- 🔍 **Genre inference from audio** — `megadj genre` uses kNN over the
  embeddings ledger to infer genres from what the music actually sounds like.
  Leave-one-out eval target: gated ≥65%. `megadj genre-why` replays the exact
  vote ladder breakdown for any track.
- ⌗ **Tags comparison surface** — the FullTags product shows FullTags ↔
  rekordbox ↔ live-file tag sources side by side per track, read-only, so a
  drift is visible instead of discovered mid-gig.
- 📖 **The file is the truth** — ground-truth readers, one format-specific
  atomic writer, and idempotent passes. Writes use a unique same-directory
  copy, verify tags/art and the container header, fsync, then rename. Also
  ships standalone in [`src/fulltags/`](src/fulltags/README.md).

```bash
megadj ingest <folder>     # messy downloads folder in, clean one back
megadj fetch               # top up tags, genres, artwork and years
megadj years               # verify years against the SC page
megadj beats               # BPM + downbeats → DB ledger
megadj mood                # ONNX mood/dance/VA → DB ledger
megadj stems               # Demucs htdemucs_ft → FLAC stems cache
megadj vocal-zones         # classify VOX/HOOK from vocals stem
megadj catch-up            # one analysis gap pass: beats → mood → vocal-zones
megadj audit               # completeness check across the whole library
megadj genre               # kNN genre inference from audio embeddings
megadj similar <id>        # "sounds like" — cosine kNN over embeddings
```

### 🎚️ MegaSet — propose the mix, keep the taste

MegaSet turns FullTags' measured BPM, key, mood, energy, and phrase data
into an ordered mix proposal. It is deterministic and explainable: every
exclusion is counted, every transition is scored, and nothing writes to
rekordbox unless you explicitly cross the dry-run-first `rb-playlist` gate.

- 🧭 **Three energy journeys** — warmup, peak, and after-hours presets share
  one registry across CLI, web, and MCP.
- 🎼 **Musically bounded** — Camelot compatibility, tempo gates, and an
  energy arc choose the chain from the whole analyzed pool (no silent
  caps); a tempo-neighborhood warmup guard keeps the opener honest.
- 🧵 **Beam search for sparse pools** — when candidates are thin, beam
  search (width 8) keeps chains alive where greedy loses ~59% of chain
  length.
- 🎛️ **Phrase handoff windows** — mix-in/mix-out cue windows computed from
  the phrases ledger, shown on the CLI step lines and the product,
  so the proposal says _where_ to blend, not just what's next.
- 🎵 **Genre-scoped sets** — `--genre house` narrows the pool to a family;
  `--landmark` pins must-play tracks into the chain; `--candidates N` builds
  N seeded variants sorted by quality.
- 🧾 **Reviewable handoff** — inspect the proposal in the MegaSet product
  or export M3U8; `megadj rb-playlist` is the separately gated write-off.

```bash
megadj megaset --preset peak --minutes 60 --json
megadj megaset-cohorts                            # warmup + peak per genre family
megadj megaset-calibrate                          # scoring calibration digest
megadj rb-playlist <drive> --preset peak          # dry-run by default
```

Product contract and measured roadmap:
[MegaSet docs](docs/megaset/01-prd.md).

### 🗄️ The shelf master — the archive that never leaves the desk

Above the USB sticks sits the shelf: an archive-grade NVMe (HFS+) holding a
strict, byte-verified copy of every drive. Rekordbox's master DB lives on it.

- 🧲 **`megadj shelf-archive [volume …]`** sweeps any drive into the shelf —
  additive, junk-filtered, MD5-verified, with divergent same-name rips
  preserved as `<name> [<volume>]` twins (never overwritten).
- 🔬 **`--deep`** MD5s same-size pairs (one stick had 291 same-size,
  different-bytes files — size alone is not coverage).
- 🗑️ **`--trashes --into F`** rescues files a drive's trash still holds.
- 🧾 **Every sweep records a verdict row** in the archive DB — `megadj
  shelf-sweeps` shows the latest per drive, so coverage state is queryable,
  not just markdown.
- 🧹 **Dedupe with a human in the loop** — `megadj shelf-dedupe` and
  `shelf-dupescan` use MD5 + acoustic fingerprints; quality upgrades swap
  in at the canonical path, different fingerprints keep both.
- 🩺 **Hygiene engine** — `megadj shelf-hygiene` runs quality-diff, oddball,
  truncated-name, stale-pointer, orphan-audio, and re-download detectors.
  Applied findings keep a recoverable ledger copy; `megadj shelf-restore`
  recovers quarantined files (MD5-verified).
- 📼 **Archive tier ≠ gig tier** — the shelf's empty `PIONEER/rekordbox/`
  tree is its _correct_ state; CrateDeck's checks are role-aware and never
  ask the shelf to do a stick's job.

### 📼 CrateDeck — know your drives are gig-ready

Every USB drive you own shows up in the dashboard as a card, with its
playlists and its health. Unplug it and it stays in the sidebar — a quiet
reminder of what's on it and when you last verified it.

- 👻 **The registry** — every drive ever seen is a card with a photo and a
  name; unplugged drives become **ghosts** that remember everything.
- 🛡️ **The verify gate** — dual-DB agreement, audio-file existence, ANLZ
  grids/waveforms at the hash paths hardware actually reads, playlist
  integrity, cross-drive hash parity.
- 🚦 **The interlock** — rekordbox open? Everything locks (exit code 3, red
  banner). Never bypassed, enforced client _and_ server side.
- 🌙 **The gig-night answer** — `deckctl preflight` is the pass/fail gate
  before you leave: worst-status-wins, exit 1 when not ready, so cron and
  agents can gate on the code alone.
- 🧮 **Fleet superpowers** — coverage matrix (what dies with a drive?),
  per-playlist redundancy audit, drive-vs-drive diff, global search (⌘K).
- 🔊 **Player compatibility** — `deckctl players` shows which CDJs/XDJs can
  read each stick; `deckctl booth` configures the fleet's codec/text floor.
- 🤖 **Agent-first** — `deckctl --json` is the one-shot surface and
  `bun run mcp` exposes the same product over MCP. The exact census is derived
  from source and pinned in [surface parity](docs/surface-parity.md).
- ⏱️ **Automation** — mount triggers a light scan; each drive gets a weekly
  auto-verify; `deckctl prep` writes the weekly digest.

```bash
bun run deck                       # the dashboard: every drive, its health, its playlists
deckctl status                     # rekordbox lock + all drives + active jobs
deckctl preflight                  # gig-night pass/fail
deckctl report <drive>             # health-check dossier
deckctl coverage                   # which tracks live on which drives
deckctl diff <driveA> <driveB>     # what's different between two drives
deckctl search <query>             # global search across all drive snapshots
```

### 🎹 Rekordbox integration

megadj talks directly to rekordbox's SQLite database — importing tracks,
writing playlists, syncing comments, fixing titles, and auditing beatgrids.
Every write gates on rekordbox being **closed**, takes a dated backup, and
verifies every row after the write.

```bash
megadj rb-import <drive> <folder>          # headless master-DB import + playlist
megadj rb-comment-sync <drive>             # backfill Comment from tags + DB ledger
megadj rb-title-repair <drive>             # fix truncated/contaminated titles
megadj rb-dedup <drive>                    # fingerprint duplicate sweep
megadj rb-cues <drive>                     # hot-cue write seam (Kind=1 fix)
megadj rb-adopt <drive>                    # mirror every Content row into archive.db
megadj rb-unmatched <drive>                # disk→DB reconcile: files with no RB row
megadj rb-fix-paths <drive>                # relocate after volume renames
megadj rb-grid-triage <drive>              # grid audit vs ANLZ data
megadj rb-play-history <drive>             # mine transition pairs for MegaSet training
megadj rb-playlist <drive> reconcile       # XML-twin healer for missing playlist nodes
```

All rekordbox commands default to **dry-run** — add `--apply --yes` to write.

---

## 📦 Getting started

### ✅ Prerequisites

You'll need a **Mac** with:

| Tool | Install | Purpose |
|------|---------|---------|
| 🧁 [Bun](https://bun.sh) | `curl -fsSL https://bun.sh/install \| bash` | Runtime + package manager |
| 📼 [yt-dlp](https://github.com/yt-dlp/yt-dlp) | `uv tool install 'yt-dlp[default]'` | YouTube/SC downloads |
| 🎬 [ffmpeg](https://ffmpeg.org/) | `brew install ffmpeg` | Audio processing |
| 🟢 [Node.js](https://nodejs.org/) | on PATH | yt-dlp JS runtime |
| 🌐 Chrome | logged into YouTube Music | Cookie source (no API keys) |

**Optional:**
- `OPENROUTER_API_KEY` — AI genre/year fallback + `megadj artwork` (keep it in
  your keychain, never hardcode)
- `HF_TOKEN` — Hugging Face token for Demucs weight downloads (unauthenticated
  pulls rate-limit)

### 🏁 First run

```bash
git clone https://github.com/webuildstuffio/megadj.git
cd megadj
bun install
megadj doctor     # ✅ check everything — tells you exactly what's missing
megadj init       # 🏗️ scaffold config + auto-detect mounted volumes
```

`megadj doctor` exits non-zero if something required is broken, so you can
also use it as a gate in scripts. `--json` for machines.

### ⚙️ Configuration

One file and a set of env vars — that's the whole story:

- 📄 **`src/deck/config.toml`** — drive names, dashboard port, jobs, image
  provider. `megadj init` scaffolds it (and auto-fills drive names from
  mounted volumes). Read by CrateDeck + `megadj doctor`; env vars override
  per CrateDeck's precedence.
- 🔌 **`USB_SYNC_MASTER` / `USB_SYNC_MIRROR`** — drive names for the
  `usb_sync.py` one-shot, independent of config.toml.

#### yt-dlp config (`~/.config/yt-dlp/config`)

```
--js-runtimes node
--cookies-from-browser chrome
--extractor-args youtube:formats=missing_pot
```

Running headless (browser closed)? Export a cookie jar first with
`tools/export-cookies.sh` — it writes a private jar outside the repo,
and it should **never** be committed.

### 🌍 Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MEGADJ_MUSIC_DIR` | `~/Music/DJ-Imports` | Where downloaded audio lands |
| `MEGADJ_DB` | `~/.local/state/megadj/archive.db` | The archive's memory (SQLite) |
| `MEGADJ_COOKIES` | `chrome` | Browser for yt-dlp cookies; empty disables |
| `MEGADJ_COOKIES_FILE` | — | Netscape cookie jar for headless runs (overrides `MEGADJ_COOKIES`) |
| `MEGADJ_STEM_DIR` | `~/.local/state/megadj/stems/` | Demucs stem cache directory |
| `MEGADJ_FLEET` | — | Override booth player fleet (e.g. `xdj-xz,cdj-3000`) |
| `OPENROUTER_API_KEY` | — | AI genre/year fallback + `megadj artwork` |
| `HF_TOKEN` | — | Hugging Face token for Demucs model weights |
| `IMAGE_MAKER_CLIENT` | — | ES module exporting an `ImageClient`, for AI covers |
| `MEGADJ_ART_MAX` | `20` | Max AI covers per `megadj artwork` pass |
| `MEGADJ_ART_QUEUE` | `~/.local/state/megadj/artwork-queue.jsonl` | Where misses are queued for AI covers |
| `FULLTAGS_ARTWORK_QUEUE` | `~/.local/state/megadj/artwork-queue.jsonl` | Same queue, FullTags-side name |
| `CRATEDECK_DATA` | `src/deck/data` | Dashboard state (DB, snapshots, images) |
| `CRATEDECK_PORT` | `7742` | Dashboard port (`bun run deck`) |
| `CRATEDECK_VOLUMES` | autodetect | Extra volumes to watch beyond `/Volumes` |
| `CRATEDECK_IMAGE_PROVIDER` | `brave` | Drive-photo search provider (`brave` or `exa`) |
| `CRATEDECK_IMAGE_KEY` | — | API key for the image provider (optional) |

Every variable has a sane default; all are **optional**. `megadj doctor`
reports which ones matter for the features you use.

---

## 🤖 Agent & MCP surface

Every `megadj` command takes `--json` (one summary object on stdout, exit
code still meaningful). CrateDeck speaks MCP:

```bash
bun run mcp                        # MCP server for AI agents
deckctl --json                     # one-shot CLI for agents
deckctl help                       # glossary + job/surface tour (works server-down)
```

Full tool list: [deckctl.md](src/deck/deckctl.md) ·
[Surface parity](docs/surface-parity.md)

---

## 🛠️ Dev loop

The standard pre-push gate is `bun run check && bun test`. `check` runs
TypeScript, lint, formatting, knip, and the web build in parallel;
`check:full` adds the full test suite, 100% type coverage, and strict Python
lint/type gates:

```bash
bun run check        # ⚡ TS + oxlint + format + knip + web build
bun test             # 🧪 full suite, 16 workers
bun run check:full   # 🔒 check + tests + 100% typecov + Python gates (ruff + mypy)
bun run check:watch  # 👀 tsc + oxlint watch modes while you edit
bun run test:fast    # 🏃 tests minus the e2e browser suite
bun run test:watch   # 🔄 bun test --watch
```

The dashboard UI is a separate Vite workspace:

```bash
cd src/deck/web && bun install --frozen-lockfile   # first time only
bun run web:build                                   # build the UI
```

---

## 📋 Full command reference

### 📥 GetDat (intake & archive)

| Command | What it does |
|---------|-------------|
| `megadj sync` | Pull new music from YouTube Music + SoundCloud |
| `megadj drop <folder-or-url>` | One-shot: download → ingest → analyze → audit |
| `megadj ingest <folder>` | Tag + art + dedupe a downloads folder |
| `megadj convert` | Archive-wide WAV → AIFF conversion |
| `megadj status` | Archive summary + recent runs |
| `megadj list [filter]` | Browse tracks (by status or text) |
| `megadj adopt` | Register existing files in the DB |
| `megadj retry` | Reset failure counters for retries |
| `megadj skip <id…>` | Mark IDs as not-music |
| `megadj surfaced-note <id…>` | Check off a surfaced download link |
| `megadj intake-status [drive]` | Reconciled census: files ↔ archive.db |
| `megadj upgrade` | Re-fetch below-floor tracks (fingerprint-gated) |
| `megadj organize` | Enforce folder structure (dated batches) |

### 🏷️ FullTags (enrichment & analysis)

| Command | What it does |
|---------|-------------|
| `megadj fetch` | Enrich tags/genres/art/years from SC/Beatport/gateways |
| `megadj audit` | Ground-truth tag/art completeness gate |
| `megadj tag-check` | Scan tag structure + booth text health |
| `megadj booth-fix` | Fix what the booth can't read (propose by default) |
| `megadj years` | Verify years against SC page / yt-dlp |
| `megadj beats` | beat_this → BPM + downbeats → DB ledger |
| `megadj mood` | ONNX mood/dance/VA → DB ledger |
| `megadj stems` | Demucs htdemucs_ft → FLAC stems cache |
| `megadj vocal-zones` | Classify VOX/HOOK from vocals stem |
| `megadj stem-export <volume>` | Write OverCue PGZ stems to USB for XDJ-XZ |
| `megadj stem-status` | Stem cache coverage vs downloaded tracks |
| `megadj catch-up` | One analysis gap pass: beats → mood → vocal-zones |
| `megadj cues` | 8-bar phrase cues from beats ledger → DB |
| `megadj energy` | Compute energy blend from mood + analysis |
| `megadj energy-why <id>` | Energy breakdown for one track |
| `megadj genre` | kNN genre inference from audio embeddings |
| `megadj genre-why <id>` | Vote ladder breakdown for one track |
| `megadj similar <id>` | Cosine kNN "sounds like" over embeddings |
| `megadj enrich` | Combined fetch + analysis pass |
| `megadj artwork` | AI cover generation from the queued misses |
| `megadj gold-report` | Score ledgers vs gold annotations |
| `megadj bench` | Benchmark analysis stages with answer keys |

### 🎚️ MegaSet (set building)

| Command | What it does |
|---------|-------------|
| `megadj megaset` | Propose an ordered mix chain |
| `megadj megaset-cohorts` | Warmup + peak chain per genre family |
| `megadj megaset-calibrate` | Scoring calibration digest |

### 🗄️ Shelf (archive management)

| Command | What it does |
|---------|-------------|
| `megadj shelf-archive [volume…]` | Sweep drives into the shelf (MD5-verified) |
| `megadj shelf-sync` | Sync archive → shelf master |
| `megadj shelf-dedupe` | Fingerprint-based duplicate resolution |
| `megadj shelf-dupescan` | Scan for fingerprint duplicates |
| `megadj shelf-hygiene` | Quality/orphan/stale detectors |
| `megadj shelf-quarantine` | View quarantined files |
| `megadj shelf-quarantine-empty` | Empty quarantine (requires `{confirm:"DELETE"}`) |
| `megadj shelf-restore` | Recover quarantined files (MD5-verified) |
| `megadj shelf-restore-all` | Restore all quarantined files |
| `megadj shelf-sweeps` | View sweep verdict history |
| `megadj dedupe-archive` | Archive-level dedup pass |

### 🎹 Rekordbox (database integration)

| Command | What it does |
|---------|-------------|
| `megadj rb-import <drive> <folder>` | Headless master-DB import + playlist |
| `megadj rb-comment-sync <drive>` | Backfill Comment from tags + DB |
| `megadj rb-title-repair <drive>` | Fix truncated/contaminated titles |
| `megadj rb-dedup <drive>` | Fingerprint duplicate sweep |
| `megadj rb-cues <drive>` | Hot-cue write seam |
| `megadj rb-adopt <drive>` | Mirror Content rows into archive.db |
| `megadj rb-unmatched <drive>` | Disk→DB reconcile |
| `megadj rb-fix-paths <drive>` | Relocate after volume renames |
| `megadj rb-grid-triage <drive>` | Grid audit vs ANLZ data |
| `megadj rb-anlz-spike <drive>` | ANLZ sidecar experiments |
| `megadj rb-play-history <drive>` | Mine transition pairs |
| `megadj rb-playlist <drive>` | Write MegaSet chain → playlist |
| `megadj rb-playlist <drive> reconcile` | XML-twin healer |

### 📼 CrateDeck (drive management)

| Command | What it does |
|---------|-------------|
| `bun run deck` | Dashboard UI |
| `deckctl status` | All drives + active jobs |
| `deckctl drives` | List drives with badge verdicts |
| `deckctl report <drive>` | Health-check dossier |
| `deckctl run <drive> <kind>` | Enqueue a job (scan, verify, mirror, benchmark…) |
| `deckctl preflight` | Gig-night pass/fail (exit 1 if not ready) |
| `deckctl coverage` | Which tracks live on which drives |
| `deckctl redundancy` | Per-playlist audit: every track on ≥N drives? |
| `deckctl radar [drive]` | New-music radar: archived tracks not on drive |
| `deckctl players [drive]` | Which CDJs/XDJs can read each stick |
| `deckctl booth` | Configure/show booth player fleet |
| `deckctl diff <A> <B>` | Added/removed/changed between two drives |
| `deckctl search <query>` | Global search across all snapshots |
| `deckctl prep` | Weekly digest |
| `deckctl fixes` | Booth-fix queue |
| `deckctl hygiene` | Shelf hygiene queue + decisions |

### 🔧 Utilities

| Command | What it does |
|---------|-------------|
| `megadj doctor` | One-shot dependency/env/config diagnostics |
| `megadj init` | First-run bootstrap |
| `megadj tmp-purge` | Sweep stale test/backup dirs from tmpdir |

---

## 💡 What we believe

- 🎯 **It should just work.** One command, one obvious outcome. If a flow needs
  a wiki to explain, the flow is wrong.
- 🎧 **Built for your booth, not everyone's.** macOS and Pioneer only — that
  focus is exactly what lets it go deep enough to actually work everywhere
  _you_ play.
- 🤖 **AI does the boring parts.** Hunting artwork, fixing years, spotting
  duplicates — that's computer work, not your evening.
- ⏱️ **Pro results, normal-person hours.** You have evenings, not engineers.
  Every decision is judged by minutes saved before a gig.
- 💪 **We don't give up.** When a file format fights back, we dig in until it
  gives in — a spec quirk shouldn't cost you tracks.
- 🔒 **Yours, fully.** It runs on your machine against your library. No
  accounts, no cloud, no subscription, nothing to cancel.

The long version: [docs/PRINCIPLES.md](docs/PRINCIPLES.md).

---

## 📚 Docs index

The [documentation index](docs/README.md) is the canonical map. Start with:

| Doc | What it covers |
|-----|---------------|
| 📐 [Principles](docs/PRINCIPLES.md) | Product decision authority |
| 📊 [Current state](docs/product-state-2026-09-07.md) | Qualitative shipped/active/blocked summary |
| 🗃️ [Data stores](docs/getdat/data-model.md) | Schema navigation + state-dir map |
| 🛠️ [Agent playbook](docs/agent-playbook.md) | Durable failure mechanics |
| 📋 [Features](docs/FEATURES.md) | Complete product map |
| 📡 [Surface parity](docs/surface-parity.md) | CLI / HTTP / MCP / UI census |

---

## 📄 License

MIT — see [LICENSE](LICENSE).
