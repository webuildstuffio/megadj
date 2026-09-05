# megadj

**Make people dance.**

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

[Principles](docs/PRINCIPLES.md) · [Features & roadmap](docs/FEATURES.md)

## The projects

### 🎧 GetDat — your downloads, handled

You hear a track. You want it in your library, at the best quality it
exists in, tonight.

`megadj sync` pulls from YouTube Music (SoundCloud and Bandcamp are next),
grabs the best audio available, and remembers everything it has already
downloaded — so you can run it as often as you like and nothing ever
re-downloads.

```bash
megadj sync          # bring in everything new since last time
```

### 🏷️ FullTags — a library you'd actually show people

Nothing kills the vibe like "Unknown Artist", a 20-year-old's release year
on a track that dropped last month, or a generic cover on a remix you love.

FullTags fills in every field and gets it **right**: the genre, the artist,
the album — and the year of *this version*, not the original. Artwork comes
from where the track actually came from (a SoundCloud remix keeps its
SoundCloud cover), and AI only steps in for the gaps normal sources can't
fill — and only when it's confident. When it's done, `megadj audit` reads
your actual files and tells you honestly what's still missing.

FullTags also lives as a standalone tool in
[`fulltags/`](fulltags/README.md) — megadj's commands are thin wrappers
around it.

```bash
megadj ingest <folder>   # point it at a messy downloads folder, get a clean one back
megadj fetch             # top up tags, genres, artwork and years
megadj audit             # the completeness check across the whole library
```

### 📼 CrateDeck — know your drives are gig-ready

Every USB drive you own shows up in the dashboard as a card, with its
playlists and its health. Unplug it and it stays in the sidebar — a quiet
reminder of what's on it and when you last verified it.

Sync puts new tracks onto your master drive, mirrors them to the backup,
then verifies both down to the details players care about: the databases
agree, every audio file is present, and the beatgrids and waveforms exist
where the hardware actually looks for them. If rekordbox is open, everything
waits safely until you quit it — no corrupt databases, ever.

So the question CrateDeck exists to answer — *can I play this stick
tonight?* — is one glance at the dashboard, or one `report`, away.

```bash
bun run deck    # the dashboard: every drive, its health, its playlists
bun run cratedeck/src/deckctl.ts status | report | run | coverage | diff
```

Drives are matched by volume name. The defaults are `DJMASTER` and
`DJMIRROR` — rename your drives to match, or set your own names in
`cratedeck/config.toml` (see `cratedeck/config.sample.toml`). Each drive
also carries a second, legacy database that older players like the XDJ-XZ
read; a one-time rekordbox export per library generation keeps it current —
[docs/usb-sync.md](docs/usb-sync.md) explains when and why.

**Coming next:** Gig mode & preflight, set intelligence from player history,
SoundCloud/Bandcamp sources, fingerprint dedupe, key detection, MCP server —
see [docs/FEATURES.md](docs/FEATURES.md) for the full roadmap.

## What we believe

- **It should just work.** One command, one obvious outcome. If a flow needs
  a wiki to explain, the flow is wrong.
- **Built for your booth, not everyone's.** macOS and Pioneer only — that
  focus is exactly what lets it go deep enough to actually work everywhere
  *you* play.
- **AI does the boring parts.** Hunting artwork, fixing years, spotting
  duplicates — that's computer work, not your evening.
- **Pro results, normal-person hours.** You have evenings, not engineers.
  Every decision is judged by minutes saved before a gig.
- **We don't give up.** When a file format fights back, we dig in until it
  gives in — your library shouldn't have boundaries just because a spec was
  rude.
- **Yours, fully.** It runs on your machine against your library. No
  accounts, no cloud, no subscription, nothing to cancel.

The long version: [docs/PRINCIPLES.md](docs/PRINCIPLES.md).

## Getting started

You'll need a Mac with [Bun](https://bun.sh), plus:
`yt-dlp` (`uv tool install 'yt-dlp[default]'`), `ffmpeg`
(`brew install ffmpeg`), Node.js on PATH, and Chrome logged into YouTube
Music (that's the cookie source — no API keys needed). The USB tools pull in
their Python dependencies automatically. AI fallbacks (genre, year, artwork)
use an `OPENROUTER_API_KEY` — keep it in your keychain.

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

Running from a headless session (browser closed)? Export a cookie jar first
with `scripts/export-cookies.sh` — it writes a private jar outside the repo,
and it should never be committed.

### Environment

| Variable             | Default                            | Purpose                                     |
| -------------------- | ---------------------------------- | ------------------------------------------- |
| `MEGADJ_MUSIC_DIR`   | `~/Music/DJ-Imports`               | where downloaded audio lands                |
| `MEGADJ_DB`          | `~/.local/state/megadj/archive.db` | the archive's memory                        |
| `MEGADJ_COOKIES`     | `chrome`                           | browser for yt-dlp cookies; empty disables  |
| `OPENROUTER_API_KEY` | —                                  | AI genre/year fallback + `megadj artwork`   |
| `IMAGE_MAKER_CLIENT` | —                                  | ES module exporting an `ImageClient`, for AI covers |

Full command reference: `megadj --help`, or
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
