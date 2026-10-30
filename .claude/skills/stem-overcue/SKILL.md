# Stem OverCue — XZ Mods OverCue Bundle Builder

## What this does
Build OverCue stem bundles on GREY FIKWOK for XDJ-XZ stem playback via XZ Mods. Converts Demucs FLAC stems (4-stem @ 44.1 kHz) into OverCue format (7 role mixes @ 96 kHz FLAC pages, OVPGZ003) using the XZ Mods backend. 3.7x faster than v1 via multi-track parallelism.

## Quick start

```bash
# Check current status
bun run megadj stem-overcue --status

# Process all available tracks (auto-scans stem cache + rekordbox DB)
bun run megadj stem-overcue

# Process with limits
bun run megadj stem-overcue --limit 100 --workers 3

# Dry run (see what would be processed)
bun run megadj stem-overcue --dry-run --json

# Custom volume
bun run megadj stem-overcue /Volumes/OTHER --limit 50
```

## Architecture

- **Pipeline:** `grouped_stems.py` (combine 4→7 role mixes) → `overcue_flac_pack.py` (96 kHz FLAC pages) → `stem_waveforms.py` (per-stem waveform .2EX/.EXT)
- **Speed:** ~32s effective/track with 3 workers (~1.9 tracks/min). v1 baseline was 120s/track.
- **Parallelism:** ThreadPoolExecutor processes N tracks concurrently (default 3 workers). Within each track, FLAC packing and waveform generation run as parallel subprocesses.
- **Verification:** Uses fast_page_table_sha (reads only FLAC page header+table, ~0.1s) instead of full verify_role (which decompresses every page, ~62s). Full verify can be done on USB sync.
- **Index:** `CDJMODS/index.json` tracks all bundles. Read once at start, batch-written every 5 tracks for atomicity.
- **Idempotent:** Tracks already in the index are skipped. Safe to re-run.
- **Output:** `<volume>/CDJMODS/stems/<16-hex-bundle>/` — each bundle has 7 OVPGZ003 role files + overcue-manifest.json + waveform .2EX/.EXT files.

## File layout

```
<volume>/
├── stems/                          # Demucs stem cache
│   └── rb-<desktop_id>/            # One dir per track (keyed by rekordbox desktop ID)
│       ├── vocals.flac
│       ├── drums.flac
│       ├── bass.flac
│       └── other.flac
└── CDJMODS/                        # OverCue output
    ├── index.json                  # Track→bundle mapping
    └── stems/
        └── <bundle_id>/            # 16-hex bundle ID
            ├── overcue-manifest.json
            ├── drums.ovpg           # 7 role FLAC pages
            ├── harmonics.ovpg
            ├── vocal.ovpg
            ├── full-mix.ovpg
            ├── instrumental.ovpg
            ├── vocals-drums.ovpg
            ├── vocals-harmonics.ovpg
            ├── drums.2ex            # Waveform files
            ├── harmonics.2ex
            └── ...
```

## OverCue format details

- **Container:** OVPGZ003 — FLAC-compressed pages of 96 kHz stereo s16le PCM
- **Page size:** 131,072 bytes (32,768 frames × 4 bytes/frame)
- **Roles:** 7 mixes from 3 stem groups:
  - `drums` (mask 1), `harmonics` (mask 2: bass+other), `vocal` (mask 4)
  - `full-mix` (mask 7), `instrumental` (mask 3), `vocals-drums` (mask 5), `vocals-harmonics` (mask 6)
- **Bundle ID:** SHA256 of role PCM + page table hashes, truncated to 16 hex chars

## Dependencies

| Component | Path | Purpose |
|---|---|---|
| XZ Mods Beta app | `/Applications/XZ Mods Beta.app` | grouped_stems.py, overcue_flac_pack.py, stem_waveforms.py, xz-audio-helper |
| XZ Mods toolkit | `~/github/XZ-Mods/source/xdj-xz-toolkit` | overcue_writer, cache modules |
| Import Python | `~/.local/share/XZ Mods/import-python/bin/python` | Python 3.11 env with numpy/scipy/soundfile |
| XZ Mods venv | `~/github/XZ-Mods/.venv` | pyrekordbox for mapping scan |
| rekordbox DB | `~/Library/Pioneer/rekordbox/master.db` | Track path resolution |

## Source files

- `src/fulltags/analysis/stem-overcue.ts` — CLI entry point and orchestration
- `src/fulltags/analysis/overcue-turbo.py` — Multi-threaded pipeline engine
- `src/fulltags/analysis/overcue-scan.py` — Stem dir scanner + rekordbox mapping builder
- `src/fulltags/cli/cli-commands.ts` — CLI flag parsing + dispatch (stemOvercueCommand)

## Traps

- **AIFF inspect failures:** `xz-audio-helper inspect` fails on some .aiff files ("Invalid, truncated, unsupported or oversized audio"). These are skipped — format limitation in the XZ Mods helper binary.
- **Index race:** Never run two turbo instances against the same CDJMODS simultaneously — index.json writes will race. Use one instance with higher `--workers` instead.
- **USB sync is separate:** This command writes to FIKWOK only. USB sync requires `xz_sync_to_usb.py` or manual copy + index merge. Agents never write the playing USB directly.
- **PDB fix after USB sync:** After syncing bundles to USB, a rekordbox re-export is needed if tracks were added/removed from the USB's export.pdb.
- **pyrekordbox API:** Uses `MasterDatabase` (not deprecated `Rekordbox6Database`). `get_content()` returns a Query — wrap with `list()`.
- **Capacity:** Each OverCue bundle is 262–317 MB. A 128 GB USB fits ~340 stemmed tracks alongside the music files.

## Performance tuning

| Workers | Eff avg/track | Rate | CPU util | Recommended for |
|---|---|---|---|---|
| 1 | ~78s | 0.8/min | ~25% | Background, low priority |
| 2 | ~45s | 1.3/min | ~50% | Normal batch |
| 3 | ~32s | 1.9/min | ~75% | Default, best throughput |
| 4 | ~28s | 2.1/min | ~90% | Maximum speed, M4 Pro+ |

## USB sync workflow (after OverCue build)

```bash
# 1. Connect USB
# 2. Sync bundles from FIKWOK → USB
cd ~/github/XZ-Mods && source .venv/bin/activate
python3 /tmp/xz_sync_to_usb.py

# 3. Build playlists
python3 /tmp/xz_build_playlists.py

# 4. Fix PDB (re-export from rekordbox desktop to USB)
```
