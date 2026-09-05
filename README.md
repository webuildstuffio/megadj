# megadj

**Make people dance.** A fleet of AI-powered tools that take electronic music
from any source to a verified, gig-ready Pioneer DJ USB library — with zero
manual labour.

Rate-limited YouTube Music archiver · 100%-coverage metadata engine ·
rekordbox USB drive dashboard with deep verification. macOS + Pioneer only,
on purpose.

```
GetDat ──▶ FullTags ──▶ CrateDeck ──▶ the booth
download    perfect       sync &       play on
& archive   metadata      verify USBs   Pioneer
```

## The projects

### 🎧 GetDat — pull every track from everywhere
One command pulls tracks from any source into the archive at the highest
quality available (256 kbps AAC first), rate-limited and polite, with SQLite
state so nothing ever re-downloads. YouTube Music today — SoundCloud, Bandcamp
and tracklist-mining next.

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

```bash
megadj ingest <folder> [--dry-run]  # tag + art + dedupe downloads (zips expand)
megadj fetch                        # tags, genres, artwork, years (parallel)
megadj audit                        # completeness gate — exits 1 on any gap
```

### 📼 CrateDeck — the Crate: organize, sync & verify every DJ USB
A local dashboard plus CLI for a fleet of rekordbox USB drives: every drive is
a card with a face; unplugged drives stay as ghosts that remember everything.
The pipeline injects tracks into the device DB (pyrekordbox), detects BPM, and
hand-builds ANLZ beatgrid/waveform files at the hash-computed paths hardware
actually reads — then verifies down to dual-DB agreement, grid math, and
cross-drive hash parity. A hard interlock locks everything while rekordbox is
running.

```bash
bun run deck                         # dashboard → http://localhost:7742
bun run cratedeck/src/deckctl.ts status | report | run | coverage | diff
```

**Coming next:** Gig mode & preflight, set intelligence from player history,
SoundCloud/Bandcamp sources, fingerprint dedupe, key detection, MCP server —
see [docs/FEATURES.md](docs/FEATURES.md) for the full roadmap.

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

## Design

- **Rate limiting** — token-bucket spacing (2.5s floor) with ±25% jitter, exponential backoff (5s base, 2x, 10min cap) on transient errors. Permanent failures (terminated accounts, copyright removals) are classified and never retried.
- **State** — SQLite tracks every video ID with status, format, bitrate, file path, size, duration, and attempt history. Runs are logged; nothing re-downloads.
- **Metadata** — yt-dlp's `web_music` client metadata (label feed: artist, album, release date, credits) is cleaned of "(Official Audio)" noise, genre is inferred from title/description then enriched via MusicBrainz (`enrich`), producer credits are parsed into the composer tag, and tags are applied via ffmpeg stream-copy (no re-encode, artwork preserved).
- **Quality** — format selection is `141/bestaudio[m4a]/bestaudio` (256kbps AAC first, falls back gracefully). The `list` output flags tracks below 250kbps as `LOWQ`.
- **Artwork & genre completion** — `tools/fetch_all.ts` is the one-shot enrichment pipeline (idempotent, parallel, ground-truth verified): tags → genre (SoundCloud tags via yt-dlp, canonicalized, then OpenRouter classifier at conf ≥ 0.7) → artwork (SoundCloud page `-original`/`t1080` → hypeddit gateways → mp3-twin → Deezer → iTunes → AI cover queue last).

## DJ USB pipeline

The `rekordbox-usb-sync` skill (`.claude/skills/rekordbox-usb-sync/`) is the
full runbook: DB injection, BPM detection, hand-built ANLZ beatgrid/waveform
files, byte-identical mirroring, and deep verification. See
[docs/usb-sync.md](docs/usb-sync.md) for the what/why.

```bash
# new batch of downloads -> master drive (rekordbox MUST be quit)
uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
    --with librosa --with numpy \
    python .claude/skills/rekordbox-usb-sync/scripts/usb_sync.py \
    --db /tmp/usb-sync/work_master.db --drive /Volumes/DJMASTER \
    --folder "/Contents/YTMusic Liked" --playlist "YTMusic Liked"

# replicate master -> mirror, then verify
uv run python .claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py
uv run python .claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py --verify-only --hash-parity

# deep verification (both drives, hardware gate included)
uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
    python .claude/skills/rekordbox-usb-sync/scripts/usb_verify.py --drives MASTER MIRROR
```

> The sync scripts take your drive names as arguments. Defaults are generic
> (`DJMASTER`/`DJMIRROR`); either rename your volumes to match or pass
> `--drive`/`--drives` explicitly, or set `USB_SYNC_MASTER`/`USB_SYNC_MIRROR`.
> CrateDeck's `config.toml` (see `cratedeck/config.sample.toml`) also needs
> your volume names.

### Two databases on each drive (why the XML/export dance exists)

| DB                              | Read by                        | How it updates                                         |
| ------------------------------- | ------------------------------ | ------------------------------------------------------ |
| `exportLibrary.db` (OneLibrary) | rekordbox 7, OPUS-QUAD, XDJ-AZ | our pipeline injects directly                          |
| `export.pdb` (legacy PDB)       | **XDJ-XZ**, older CDJs         | only rekordbox writes it — via XML import + USB export |

After a big library change, do the once-per-generation legacy export
(described in the skill): generate full-library XML → import into rekordbox 7
→ drag playlists onto both devices → let analysis finish → export. Then
mirror + verify.

## Docs index

| Doc                                                                                      | Purpose                                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| [docs/PRINCIPLES.md](docs/PRINCIPLES.md)                                                 | product principles — how we decide          |
| [docs/FEATURES.md](docs/FEATURES.md)                                                     | feature/project sections + roadmap          |
| [docs/usb-sync.md](docs/usb-sync.md)                                                     | USB pipeline what/why                       |
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
