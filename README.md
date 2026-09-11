# megadj

**Make people dance.** 🪩

megadj handles the unglamorous half of DJing — the downloading, the tagging,
the artwork hunting, the USB wrangling — so you can spend your time on the
fun half. Music goes in from wherever you found it and comes out the other
side clean: properly tagged, artworked, beatgridded, on your drives, and
ready for the booth. No spreadsheets, no tag editors, no "I'll fix the
artwork later".

```
GetDat ──▶ FullTags ──▶ CrateDeck ──▶ the booth
download    perfect       sync &       play on
& archive   metadata      verify USBs   Pioneer
```

[Principles](docs/PRINCIPLES.md) · [Features & roadmap](docs/FEATURES.md) ·
[Current state](docs/product-state-2026-09-07.md)

---

## 🚀 The quick loop

```bash
megadj sync                    # 🎧 pull new music
megadj fetch && megadj audit   # 🏷️ perfect the metadata, then verify it
megadj beats && megadj mood    # 🎼 beats + mood ledgers
megadj shelf-sync              # 🗄️ new music out to the shelf master
bun run deck                   # 📼 dashboard: every drive, sync + verify
```

---

## The projects

### 🎧 GetDat — your downloads, handled

You hear a track. You want it in your library, at the best quality it
exists in, tonight.

- ⬇️ **`megadj sync`** pulls from YouTube Music (SoundCloud and Bandcamp are
  next) at the best audio available — 256 kbps first, graceful fallback.
- 🔁 **Nothing ever re-downloads.** SQLite tracks every video ID: status,
  format, bitrate, path, attempt history. Run it as often as you like.
- 🚩 **Quality only ratchets up.** Anything below 250 kbps is flagged
  `LOWQ` — and `megadj upgrade` re-fetches it at best quality, swapping
  only when the new file carries the _same acoustic fingerprint_.
- 📦 **`megadj ingest <folder>`** for external folders — probe, score,
  quarantine, zip expand, MusicBrainz fill, WAV→AIFF conversion.
- 🤖 **`megadj drop <folder-or-url>`** — the whole chain in one command:
  download → ingest → beats → mood → cues → organize, hands-free.

```bash
megadj sync                        # bring in everything new since last time
megadj sync --limit 50 --dry-run   # peek before you commit
megadj drop <folder-or-url>        # one command, a gig-ready track
```

### 🏷️ FullTags — a library you'd show people

Nothing kills the vibe like "Unknown Artist", a 20-year-old release year on
a track that dropped last month, or a generic cover on a remix you love.

- ✅ **Every field, filled and correct** — title, artist, album, genre, and
  the year of _this version_ (the remix's year, not the original's).
- 🎨 **Art from where the track came from** — a SoundCloud remix keeps its
  SoundCloud cover; the art ladder escalates SC → gateways → Deezer →
  iTunes → AI cover only as a last resort (queued + human-reviewable).
- 🧠 **AI fills only the gaps** — cheap flash-class models, confidence-gated
  (≥ 0.7), stamped `TXXX:AI-GENRE|0.92` into the file so an AI-filled field
  is always identifiable.
- 🎼 **Offline analysis, gated honestly** — acoustic fingerprint (88→131
  ledgered), real BPM, harmonic key (OpenKeyScan, gate-passed 80.7%),
  mood/dance/energy (Essentia ONNX), 8-bar phrase cues. Fields only reach
  tags when they pass a measured accuracy gate — the rest live in DB
  ledgers, by design.
- 🕹️ **Booth-safe by construction** — `megadj audit` enforces the codec/text
  floor of your actual player fleet (XDJ-XZ + CDJ-3000 + 2000NXS2 default);
  `megadj booth-fix` proposes (never auto-applies) the safe fixes.
- 📖 **The file is the truth** — ground-truth readers, one atomic writer
  (tmp + rename, audio never re-encoded), idempotent passes. Also ships
  standalone in [`fulltags/`](fulltags/README.md).

```bash
megadj ingest <folder>   # a messy downloads folder in, a clean one back
megadj fetch             # top up tags, genres, artwork and years
megadj years             # verify years against the SC page (not the AI's 2023 guess)
megadj audit             # the completeness check across the whole library
```

### 🗄️ The shelf master — the archive that never leaves the desk

Above the USB sticks sits the shelf: an archive-grade HDD holding a strict,
byte-verified copy of every drive. rekordbox's master DB even lives on it.

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
- 🤖 **Agent-first** — `deckctl --json` one-shot, and `bun run mcp` speaks
  MCP: **37 tools** (22 `deck_*` + 15 readonly `archive_*`).
- ⏱️ **Automation** — mount triggers a light scan; each drive gets a weekly
  auto-verify; `deckctl prep` writes the weekly digest.

```bash
bun run deck                    # the dashboard: every drive, its health, its playlists
bun run deckctl status | report | run | coverage | diff
megadj shelf-archive <volume>   # archive a stray drive into the shelf, verified
```

---

## 🧭 Coming next

- 🎛️ Gig mode + the assisted legacy-export runbook (C18a) + differential
  mirror (C21/C22)
- 🗣️ Vocal density (demucs) and structure labels — same gate discipline
- 🎚️ rekordbox memory-cue writes from the phrase-cue ledger (behind the
  interlock)
- ☁️ SoundCloud / Bandcamp sources (yt-dlp already covers SoundCloud)
- 🔮 The dream: hit predictor & set-builder copilot, calibrated on what
  actually got played

Full roadmap: [docs/FEATURES.md](docs/FEATURES.md) ·
live queue: [docs/product-state-2026-09-07.md](docs/product-state-2026-09-07.md).
Agents already talk to the whole thing over MCP: `bun run mcp`.

---

## 🛠️ Dev loop

The whole gate before any push — typecheck, lint (warnings deny), format,
knip, tests (16 workers), type coverage — one command, parallel lanes:

```bash
bun run check        # fast trio (typecheck ∥ lint ∥ format), ~2s warm
bun run check:full   # everything above + knip + tests + 100% typecov
bun run check:watch  # tsc + oxlint watch modes while you edit
bun run test:fast    # tests minus the e2e browser suite
bun run test:watch   # bun test --watch
```

The dashboard UI is a separate Vite workspace: after web changes run
`bun run web:build` (from `cratedeck/`; its deps install via
`cd cratedeck/web && bun install --frozen-lockfile`).

First run of the dashboard? Build the UI once: `cd cratedeck/web && bun
install && bun run build`. Drives are matched by volume name — `megadj
init` auto-detects mounted volumes and writes them into
`cratedeck/config.toml` (copied from `cratedeck/config.sample.toml`); edit
that file to change the names later. Each drive also carries a second,
legacy database that older players like the XDJ-XZ read; a one-time
rekordbox export per library generation keeps it current —
[docs/usb-sync.md](docs/usb-sync.md) explains when and why.

---

## 💡 What we believe

- **It should just work.** One command, one obvious outcome. If a flow needs
  a wiki to explain, the flow is wrong.
- **Built for your booth, not everyone's.** macOS and Pioneer only — that
  focus is exactly what lets it go deep enough to actually work everywhere
  _you_ play.
- **AI does the boring parts.** Hunting artwork, fixing years, spotting
  duplicates — that's computer work, not your evening.
- **Pro results, normal-person hours.** You have evenings, not engineers.
  Every decision is judged by minutes saved before a gig.
- **We don't give up.** When a file format fights back, we dig in until it
  gives in — a spec quirk shouldn't cost you tracks.
- **Yours, fully.** It runs on your machine against your library. No
  accounts, no cloud, no subscription, nothing to cancel.

The long version: [docs/PRINCIPLES.md](docs/PRINCIPLES.md).

---

## 📦 Getting started

You'll need a Mac with [Bun](https://bun.sh), plus:
`yt-dlp` (`uv tool install 'yt-dlp[default]'`), `ffmpeg`
(`brew install ffmpeg`), Node.js on PATH, and Chrome logged into YouTube
Music (that's the cookie source — no API keys needed). The USB tools pull
in their Python dependencies automatically. AI fallbacks (genre, year,
artwork) use an `OPENROUTER_API_KEY` — keep it in your keychain.

```bash
git clone https://github.com/YOUR_USERNAME/megadj.git
cd megadj
bun install
megadj doctor   # check everything above in one shot — tells you exactly what's missing
megadj init     # first run: scaffold cratedeck/config.toml + doctor
```

`megadj doctor` exits non-zero if something required is broken, so you can
also use it as a gate in scripts. `--json` for machines.

yt-dlp config at `~/.config/yt-dlp/config`:

```
--js-runtimes node
--cookies-from-browser chrome
--extractor-args youtube:formats=missing_pot
```

Running from a headless session (browser closed)? Export a cookie jar first
with `scripts/export-cookies.sh` — it writes a private jar outside the
repo, and it should never be committed.

### ⚙️ Configuration

One file and a set of env vars — that's the whole story:

- 📄 **`cratedeck/config.toml`** — drive names, dashboard port, jobs, image
  provider. `megadj init` scaffolds it (and auto-fills drive names from
  mounted volumes). Read by CrateDeck + `megadj doctor`; env vars override
  per CrateDeck's precedence.
- 🔧 **Env vars** (below) — per-invocation knobs for the megadj CLI and
  FullTags; nothing else is file-based.
- 🔌 **`USB_SYNC_MASTER` / `USB_SYNC_MIRROR`** — drive names for the
  `scripts/sync-usb.sh` one-shot, independent of config.toml.

### 🌍 Environment

| Variable                   | Default                                     | Purpose                                                            |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| `MEGADJ_MUSIC_DIR`         | `~/Music/DJ-Imports`                        | where downloaded audio lands                                       |
| `MEGADJ_DB`                | `~/.local/state/megadj/archive.db`          | the archive's memory                                               |
| `MEGADJ_COOKIES`           | `chrome`                                    | browser for yt-dlp cookies; empty disables                         |
| `MEGADJ_COOKIES_FILE`      | —                                           | netscape cookie jar for headless runs (overrides `MEGADJ_COOKIES`) |
| `OPENROUTER_API_KEY`       | —                                           | AI genre/year fallback + `megadj artwork`                          |
| `IMAGE_MAKER_CLIENT`       | —                                           | ES module exporting an `ImageClient`, for AI covers                |
| `MEGADJ_ART_MAX`           | `20`                                        | max AI covers per `megadj artwork` pass                            |
| `MEGADJ_ART_QUEUE`         | `~/.local/state/megadj/artwork-queue.jsonl` | where misses are queued for AI covers                              |
| `FULLTAGS_ARTWORK_QUEUE`   | `~/.local/state/megadj/artwork-queue.jsonl` | same queue, FullTags-side name (`megadj artwork` consumes both)    |
| `CRATEDECK_DATA`           | `~/.local/state/cratedeck`                  | dashboard state (DB, snapshots, images)                            |
| `CRATEDECK_PORT`           | `7742`                                      | dashboard port (`bun run deck`)                                    |
| `CRATEDECK_VOLUMES`        | autodetect                                  | extra volumes to watch beyond `/Volumes`                           |
| `CRATEDECK_IMAGE_PROVIDER` | `brave`                                     | drive-photo search provider (`brave` or `exa`)                     |
| `CRATEDECK_IMAGE_KEY`      | —                                           | API key for the image provider (optional)                          |

Full command reference: `megadj --help`, or
[docs/FEATURES.md](docs/FEATURES.md).

Machines and agents: every `megadj` command takes `--json` (one summary
object on stdout, exit code still meaningful)
([PRINCIPLES.md](docs/PRINCIPLES.md) §1: if a command can't be consumed by
an agent, it doesn't exist), and CrateDeck speaks MCP — see
[cratedeck/deckctl.md](cratedeck/deckctl.md) for the tool list.

---

## 📚 Docs index

- **Start here:** [docs/PRINCIPLES.md](docs/PRINCIPLES.md) ·
  [docs/FEATURES.md](docs/FEATURES.md) ·
  [docs/usb-sync.md](docs/usb-sync.md) ·
  [docs/surface-parity.md](docs/surface-parity.md) ·
  [fulltags/README.md](fulltags/README.md) ·
  [cratedeck/deckctl.md](cratedeck/deckctl.md)
- **Product briefs:** [docs/cratedeck/](docs/cratedeck/) —
  [02 PRD](docs/cratedeck/02-prd.md) (brief merged in),
  [03 architecture](docs/cratedeck/03-architecture.md),
  [acceptance](docs/cratedeck/acceptance.md)
- **Reference:** [docs/fulltags-roadmap.md](docs/fulltags-roadmap.md),
  [docs/archive/roadmap-proposal.md](docs/archive/roadmap-proposal.md)
  (executed Sep 6–8),
  [docs/rekordbox-wav-artwork.md](docs/rekordbox-wav-artwork.md),
  [docs/ideas.md](docs/ideas.md)
- **Writeups:** [docs/product-state-2026-09-07.md](docs/product-state-2026-09-07.md)
  (current state, queue, scorecard) ·
  [docs/agent-playbook.md](docs/agent-playbook.md)
  (invariant war-stories + durable meta-lessons) ·
  [docs/shelf-hygiene-2026-09-09.md](docs/shelf-hygiene-2026-09-09.md)
  (Sep 9 hygiene session: dupescan data + the findings-ledger spec) ·
  [docs/usb-sync-log.md](docs/usb-sync-log.md) (ops/incident log) ·
  [docs/runbooks/](docs/runbooks/) (§0 survival runbooks)
- **Runbooks:** [rekordbox-usb-sync](.claude/skills/rekordbox-usb-sync/SKILL.md),
  [new-music-intake](.claude/skills/new-music-intake/SKILL.md),
  [shelf-intake](.claude/skills/shelf-intake/SKILL.md),
  [cratedeck-deckctl](.claude/skills/cratedeck-deckctl/SKILL.md),
  [rekordbox-library-repair](.claude/skills/rekordbox-library-repair/SKILL.md),
  [booth-check](.claude/skills/booth-check/SKILL.md)
- **Plugin:** [plugin/README.md](plugin/README.md) — the whole surface as an
  installable Claude Code plugin

## License

MIT — see [LICENSE](LICENSE).
