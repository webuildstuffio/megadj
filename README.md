# megadj

**Make people dance.** A fleet of AI-powered tools that take electronic music
from any source to a verified, gig-ready Pioneer DJ USB library — with zero
manual labour.

```
GetDat ──▶ FullTags ──▶ CrateDeck ──▶ the booth
download    perfect       sync &       play on
& archive   metadata      verify USBs   Pioneer
```

macOS + Pioneer only, on purpose. CLI-first, agent-first. AI does the labour.
[Principles](docs/PRINCIPLES.md) · [Features & roadmap](docs/FEATURES.md)

## The projects

### 🎧 GetDat — pull every track from everywhere

One command pulls tracks from any source into the archive at the highest
quality available (256 kbps AAC first), with SQLite state so nothing ever
re-downloads — and permanent failures (terminated accounts, copyright
removals) are classified and never retried. YouTube Music today — SoundCloud,
Bandcamp and tracklist-mining next.

```bash
megadj sync [--limit N] [--dry-run] [--music-only] [--target-total N]
```

### 🏷️ FullTags — 100% accuracy, 100% coverage, zero manual labour

Every ID3 field filled and *correct*: genre, artist, album, and the remix's
year — not the 20-year-old original's. Artwork comes from the source the
track came from (SoundCloud page art at original res → gateways → Deezer →
iTunes), escalating to AI-generated covers only as a rare last resort. Cheap,
confidence-gated AI fills every gap. `megadj audit` is the ground-truth gate:
it reads the files, not the DB.

FullTags is also a standalone sub-project,
[`fulltags/`](fulltags/README.md): one schema, one atomic writer (mp3/m4a/
wav/flac/aiff with all the format gotchas in exactly one place),
ground-truth readers, the full art ladder, and its own CLI. megadj's
commands are thin wrappers over it.

```bash
megadj ingest <folder> [--dry-run]  # tag + art + dedupe downloads (zips expand)
megadj fetch                        # tags, genres, artwork, years (parallel)
megadj audit                        # completeness gate — exits 1 on any gap

bun run fulltags/cli.ts <file-or-folder>  # fill every missing field
bun run fulltags/cli.ts audit <folder>    # same gate, standalone (--json)
```

Roadmap (key detection, Essentia mood/genre models, beat_this BPM,
fingerprints): [docs/fulltags-roadmap.md](docs/fulltags-roadmap.md).

### 📼 CrateDeck — the Crate: organize, sync & verify every DJ USB

A local dashboard plus CLI for a fleet of rekordbox USB drives: every drive is
a card with a face; unplugged drives stay as ghosts that remember everything.
The sync injects tracks into the device DB (pyrekordbox), detects BPM, and
hand-builds ANLZ beatgrid/waveform files at the hash-computed paths hardware
actually reads. Verify then checks dual-DB agreement, grid math, audio
existence, and cross-drive hash parity. A hard interlock locks everything
while rekordbox is running.

Each drive carries **two databases** — `exportLibrary.db` for rekordbox 7,
plus the legacy `export.pdb` that XDJ-XZ and older CDJs read — so one
rekordbox legacy export per library generation keeps both in agreement. The
what/why lives in [docs/usb-sync.md](docs/usb-sync.md).

```bash
bun run deck                         # dashboard → http://localhost:7742
bun run cratedeck/src/deckctl.ts status | report | run | coverage | diff
```

**Coming next:** Gig mode & preflight, set intelligence from player history,
SoundCloud/Bandcamp sources, fingerprint dedupe, key detection, MCP server —
see [docs/FEATURES.md](docs/FEATURES.md) for the full roadmap.

## Principles

The short version of [docs/PRINCIPLES.md](docs/PRINCIPLES.md):

- **One user, one machine** — CLI-first, agent-first (`--json` everywhere);
  no accounts, no server, no team plan.
- **Mac only. Pioneer only.** — focus is what makes the deep hacks possible.
- **Super easy** — one command does one obvious, complete thing.
- **We never give up** — a dead end is a prompt to dig one layer deeper.
- **AI does the labour** — dedupe, web research, artwork, gap filling;
  humans do nothing.
- **Not pros — pro results** — every build is judged by minutes saved per gig.

## Requirements

- [Bun](https://bun.sh) runtime · macOS
- `yt-dlp` with EJS solver (`uv tool install 'yt-dlp[default]'`)
- `ffmpeg` (`brew install ffmpeg`) · Node.js on PATH (yt-dlp JS solver)
- Chrome logged into YouTube Music (cookie source)
- For the USB pipeline: `uv`, plus `pyrekordbox`/`librosa`/`numpy` (pulled in
  automatically via `uv run --with ...`)
- `OPENROUTER_API_KEY` for AI genre/year/artwork fallback (keychain, never
  hardcoded)

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/megadj.git
cd megadj
bun install
```

yt-dlp config at `~/.config/yt-dlp/config`:

```
--js-runtimes node
--cookies-from-browser chrome
--extractor-args youtube:formats=missing_pot
```

For headless runs (browser closed), export a cookie jar first:
`scripts/export-cookies.sh` (writes a chmod-600 netscape jar outside the
repo — never commit it).

### Environment

| Variable             | Default                            | Purpose                                                            |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `MEGADJ_MUSIC_DIR`   | `~/Music/DJ-Imports`               | where audio lands                                                  |
| `MEGADJ_DB`          | `~/.local/state/megadj/archive.db` | state database                                                     |
| `MEGADJ_COOKIES`     | `chrome`                           | browser for yt-dlp cookies; empty disables                         |
| `OPENROUTER_API_KEY` | —                                  | AI genre/year fallback + `megadj artwork`                          |
| `IMAGE_MAKER_CLIENT` | —                                  | ES module exporting an `ImageClient` class, for AI covers          |

Full command reference: run `megadj --help` or see
[docs/FEATURES.md](docs/FEATURES.md).

## Docs index

| Doc                                                                                      | Purpose                                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| [docs/PRINCIPLES.md](docs/PRINCIPLES.md)                                                 | product principles — how we decide          |
| [docs/FEATURES.md](docs/FEATURES.md)                                                     | feature/project sections + roadmap          |
| [docs/usb-sync.md](docs/usb-sync.md)                                                     | USB pipeline what/why                       |
| [fulltags/README.md](fulltags/README.md)                                                 | FullTags enrichment engine                  |
| [docs/fulltags-roadmap.md](docs/fulltags-roadmap.md)                                     | FullTags prioritized AI/tagging roadmap     |
| [docs/rekordbox-wav-artwork.md](docs/rekordbox-wav-artwork.md)                           | WAV artwork research + fix (resolved)       |
| [docs/cratedeck/01-product-brief.md](docs/cratedeck/01-product-brief.md)                 | CrateDeck brief                             |
| [docs/cratedeck/02-prd.md](docs/cratedeck/02-prd.md)                                     | feature PRD (F1–F10)                        |
| [docs/cratedeck/03-architecture.md](docs/cratedeck/03-architecture.md)                   | architecture                                |
| [docs/cratedeck/04-build-plan.md](docs/cratedeck/04-build-plan.md)                       | milestones M0–M6                            |
| [docs/cratedeck/acceptance.md](docs/cratedeck/acceptance.md)                             | acceptance status per PRD feature           |
| [docs/ideas.md](docs/ideas.md)                                                           | ideas & future backlog (§0 do-now gate)     |
| [cratedeck/deckctl.md](cratedeck/deckctl.md)                                             | deckctl CLI guide (exit codes, flags)       |
| [.claude/skills/rekordbox-usb-sync/SKILL.md](.claude/skills/rekordbox-usb-sync/SKILL.md) | full USB sync runbook                       |
| [.claude/skills/new-music-intake/SKILL.md](.claude/skills/new-music-intake/SKILL.md)     | ingest/intake guide                         |
| [.claude/skills/cratedeck-deckctl/SKILL.md](.claude/skills/cratedeck-deckctl/SKILL.md)   | agent-facing dashboard skill                |

## License

MIT — see [LICENSE](LICENSE).
