# megadj

Rate-limited YouTube Music library archiver for rekordbox. Tracks every liked song in a SQLite database, downloads the highest available audio quality (Premium 256kbps AAC when the account has access), enriches metadata, and tags files so rekordbox imports cleanly.

## Requirements

- [Bun](https://bun.sh) runtime
- `yt-dlp` with EJS solver (`uv tool install 'yt-dlp[default]'`)
- `ffmpeg` (`brew install ffmpeg`)
- Node.js on PATH (yt-dlp JS challenge solver)
- Chrome logged into YouTube Music (cookie source)

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

## Usage

```bash
bun run src/cli.ts sync              # incremental: fetch playlist, download new tracks
bun run src/cli.ts sync --limit 5    # only 5 tracks this run
bun run src/cli.ts sync --dry-run    # playlist refresh only, no downloads
bun run src/cli.ts status            # archive summary + recent run history
bun run src/cli.ts list              # all tracks with status flags
bun run src/cli.ts list gone         # filter by status or free text
bun run src/cli.ts retry             # reset failed tracks for the next sync
```

Recommended alias:

```bash
alias megadj='bun run ~/github/megadj/src/cli.ts'
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
- **Metadata** — yt-dlp's `web_music` client metadata (label feed: artist, album, release date, credits) is cleaned of "(Official Audio)" noise, genre is inferred from title/description, producer credits are parsed into the composer tag, and tags are applied via ffmpeg stream-copy (no re-encode, artwork preserved).
- **Quality** — format selection is `141/bestaudio[m4a]/bestaudio` (256kbps AAC first, falls back gracefully). The `list` output flags tracks below 250kbps as `LOWQ`.

## Rekordbox import

Two supported flows:

### A. Regular rekordbox library (Mac)

1. rekordbox → File → Import → Import Folder → select `~/Music/YTMusic-Liked`
2. Let auto-analysis finish (BPM/grid/waveform)
3. Optional: drag into a playlist for gig organization

Don't move the folder after import — rekordbox references paths. If you relocate, use Preferences → Database → Auto Relocate.

### B. DJ USB drives (DJMASTER + DJMIRROR)

The `.claude/skills/rekordbox-usb-sync/` skill injects downloads directly
into the drives' device DB, generates beatgrids/waveforms, mirrors both
drives byte-identical, and verifies everything:

```bash
# new batch of downloads -> master drive
uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
    --with librosa --with numpy \
    python .claude/skills/rekordbox-usb-sync/scripts/usb_sync.py \
    --db /tmp/usb-sync/work_master.db --drive /Volumes/DJMASTER

# replicate master -> mirror, then verify
uv run python .claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py
uv run python .claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py --verify-only --hash-parity
```

See [docs/usb-sync.md](docs/usb-sync.md) for the pipeline overview and
[(local ops log)]((local ops log)) for the operations log.

## License

Private. internal.
