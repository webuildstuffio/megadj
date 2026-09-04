# megadj

Rate-limited YouTube Music library archiver for rekordbox, with an end-to-end
pipeline onto the DJ USB drives (DJMASTER master + DJMIRROR mirror).
Tracks every liked song in a SQLite database, downloads the highest available
audio quality (Premium 256kbps AAC when the account has access), enriches
metadata, tags files so rekordbox imports cleanly, and syncs everything to
hardware with full verification.

## Requirements

- [Bun](https://bun.sh) runtime
- `yt-dlp` with EJS solver (`uv tool install 'yt-dlp[default]'`)
- `ffmpeg` (`brew install ffmpeg`)
- Node.js on PATH (yt-dlp JS challenge solver)
- Chrome logged into YouTube Music (cookie source)
- For the USB pipeline: `uv`, plus `pyrekordbox`/`librosa`/`numpy` (pulled in
  automatically via `uv run --with ...`)

## Setup

```bash
git clone git@github.com:megadj/megadj.git
cd megadj
bun install
```

yt-dlp config at `~/.config/yt-dlp/config` should contain:

```
--js-runtimes node
--cookies-from-browser chrome
--extractor-args youtube:formats=missing_pot
```

For headless runs (browser closed), export a cookie jar first:
`scripts/export-cookies.sh` (writes a chmod-600 netscape jar outside the
repo — never commit it).

## Usage

```bash
alias megadj='bun run ~/github/megadj/src/cli.ts'

megadj sync                       # incremental: fetch likes, download new tracks
megadj sync --limit 5             # small test batch
megadj sync --dry-run             # playlist refresh only, no downloads
megadj sync --music-only          # skip non-audio (videos/sets)
megadj sync --sources LM,LL,PLxxx # multi-source: liked music + liked + playlists
megadj enrich [--dry-run]         # fill weak genres via MusicBrainz
megadj organize [--dry-run]       # move downloads into genre folders
megadj status                     # archive summary + recent run history
megadj list [filter]              # all tracks, by status or free text (LOWQ flagged)
megadj retry                      # reset failed tracks for the next sync
megadj adopt                      # register existing files in the DB
```

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `MEGADJ_MUSIC_DIR` | `~/Music/YTMusic-Liked` | where audio lands |
| `MEGADJ_DB` | `~/.local/state/megadj/archive.db` | state database |
| `MEGADJ_COOKIES` | `chrome` | browser for yt-dlp cookies; empty disables |

## Design

- **Rate limiting** — token-bucket spacing (2.5s floor) with ±25% jitter, exponential backoff (5s base, 2x, 10min cap) on transient errors. Permanent failures (terminated accounts, copyright removals) are classified and never retried.
- **State** — SQLite tracks every video ID with status, format, bitrate, file path, size, duration, and attempt history. Runs are logged; nothing re-downloads.
- **Metadata** — yt-dlp's `web_music` client metadata (label feed: artist, album, release date, credits) is cleaned of "(Official Audio)" noise, genre is inferred from title/description then enriched via MusicBrainz (`enrich`), producer credits are parsed into the composer tag, and tags are applied via ffmpeg stream-copy (no re-encode, artwork preserved).
- **Quality** — format selection is `141/bestaudio[m4a]/bestaudio` (256kbps AAC first, falls back gracefully). The `list` output flags tracks below 250kbps as `LOWQ`.

## DJ USB pipeline (DJMASTER + DJMIRROR)

The `rekordbox-usb-sync` skill (`.claude/skills/rekordbox-usb-sync/`) is the
full runbook: DB injection, BPM detection, hand-built ANLZ beatgrid/waveform
files, byte-identical mirroring, and deep verification. See
[docs/usb-sync.md](docs/usb-sync.md) for the what/why and
[(local ops log)]((local ops log)) for the operations log.

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

# deep 10x verification (both drives, hardware gate included)
uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
    python .claude/skills/rekordbox-usb-sync/scripts/usb_verify.py --drives DJMASTER DJMIRROR
```

### Two databases on each drive (why the XML/export dance exists)

| DB | Read by | How it updates |
|---|---|---|
| `exportLibrary.db` (OneLibrary) | rekordbox 7, OPUS-QUAD, XDJ-AZ | our pipeline injects directly |
| `export.pdb` (legacy PDB) | **XDJ-XZ**, older CDJs | only rekordbox writes it — via XML import + USB export |

After a big library change, do the once-per-generation legacy export
(described in the skill): generate full-library XML → import into rekordbox 7
→ drag playlists onto both devices → let analysis finish → export. Then
mirror + verify.

## Current library state (2026-09-03)

- 3,054-track core library + YTMusic Liked (294) injected; Wed 2026-09-03 the
  full-library XML was imported into rekordbox 7 and exported to both drives
  (legacy export.pdb), with event playlists added and rekordbox re-analysis
  running.
- Verify after the export finishes: `usb_verify.py` hardware gate —
  `export.pdb` live rows == OneLibrary count on both drives.

## License

Private. internal.
