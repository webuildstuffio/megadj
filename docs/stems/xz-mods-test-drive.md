# XZ Mods Setup — v0.5.0-preview.22

> Updated 2026-10-30. Status: **~905+ OverCue bundles on FIKWOK** (turbo pipeline running, targeting 1000+).

## Current State

| Item | Status |
|---|---|
| XZ Mods **v0.5.0-preview.22** Mac app | ✅ `/Applications/XZ Mods Beta.app` (re-signed, full beta) |
| XZ Mods repos cloned | ✅ `~/github/XZ-Mods` (origin=OpticMystic, fork=webuildstuffio) |
| xdj-xz-toolkit | ✅ `~/github/xdj-xz-toolkit` |
| XDJ-XZ firmware **1.26** | ✅ verify in Utility → System Info |
| `megadj stems` (demucs-mlx) | ✅ shipped — ~9x realtime on M4 Pro |
| Stem cache (GREY FIKWOK) | ✅ **2,272** tracks separated, 123 GB |
| OverCue bundles on FIKWOK | ✅ **905+** tracks (turbo batch running) |
| `megadj stem-overcue` CLI | ✅ shipped — turbo pipeline, 3.7x speedup |
| DJLIBRARYM USB | ✅ 930 stemmed tracks, autoexec.bin, 91 GB free |
| PDB fix needed | ⚠️ re-export from rekordbox (deleted tracks still in PDB) |

## megadj stem-overcue (Recommended)

The integrated CLI command handles scanning, mapping, and building:

```bash
# Check status
bun run megadj stem-overcue --status

# Process all available tracks (auto-scans stem cache + rekordbox DB)
bun run megadj stem-overcue

# Process with limits and custom worker count
bun run megadj stem-overcue --limit 100 --workers 4

# Dry run
bun run megadj stem-overcue --dry-run --json
```

### Turbo Pipeline Architecture

```
FIKWOK stems (Demucs FLAC, 44.1 kHz)
  → overcue-scan.py (scan stem dirs + resolve paths from rekordbox DB)
  → overcue-turbo.py (N parallel workers):
      → grouped_stems.py --mode combine (bass+other → harmonics, 7 role mixes)
      → overcue_flac_pack.py (96 kHz FLAC pages, OVPGZ003) ┐ parallel
      → stem_waveforms.py (per-stem waveform .2EX/.EXT)     ┘
      → fast_page_table_sha (header-only verify, ~0.1s vs 62s full)
      → bundle + index.json update (batch-flushed every 5 tracks)
  → FIKWOK/CDJMODS/stems/<bundle>/
```

### Performance

| Pipeline | Speed | Rate | Method |
|---|---|---|---|
| v1 (serial, full verify) | 120s/track | 0.5/min | Serial, full page decompression verify |
| v2 (fast verify) | 78s/track | 0.8/min | Skip verify, parallel flac+waveforms |
| **v3 turbo (3 workers)** | **32s/track eff** | **1.9/min** | 3 parallel tracks + all v2 optimizations |
| v3 turbo (4 workers) | ~28s/track eff | 2.1/min | For M4 Pro+ with thermal headroom |

### Source files

| File | Purpose |
|---|---|
| `src/fulltags/analysis/stem-overcue.ts` | CLI entry + orchestration |
| `src/fulltags/analysis/overcue-turbo.py` | Multi-threaded pipeline engine |
| `src/fulltags/analysis/overcue-scan.py` | Stem dir scanner + rekordbox mapping |

### Legacy scripts (in /tmp, pre-integration)

| Script | Purpose |
|---|---|
| `/tmp/xz_sync_to_usb.py` | Copy bundles from FIKWOK → USB + merge index |
| `/tmp/xz_build_playlists.py` | Generate rekordbox.xml with STEMS folder/playlists |
| `/tmp/xz_complete_usb_setup.sh` | One-command USB setup (sync + playlists + verify) |

### USB Sync (when USB returns)

```bash
cd /Users/nick/github/XZ-Mods && source .venv/bin/activate
python3 /tmp/xz_sync_to_usb.py          # copies bundles + updates index
python3 /tmp/xz_build_playlists.py       # regenerates playlists
# Or: bash /tmp/xz_complete_usb_setup.sh  # all-in-one
```

### Capacity Planning

| USB Size | Music Files | Max Stemmed Tracks | Notes |
|---|---|---|---|
| 128 GB (DJLIBRARYM) | ~18 GB (930 files) | ~340 | At 262–317 MB/bundle average |
| 256 GB | ~18 GB | ~700 | |
| 512 GB | ~18 GB | ~1,500+ | Full library fits |

## Two Paths to Stems on USB

### Path A: megadj CLI (Recommended — batch, offline)

1. Run `megadj stems` to separate tracks on FIKWOK (~9x realtime)
2. Run `megadj stem-overcue` to build OverCue bundles (1.9/min turbo)
3. Plug USB → run `/tmp/xz_sync_to_usb.py` to copy bundles (~1/sec)
4. Run `/tmp/xz_build_playlists.py` to create playlists

### Path B: XZ Mods App (Interactive, single track)

1. Open `/Applications/XZ Mods Beta.app`
2. Select USB volume → Stems → Import
3. Point at FIKWOK stems for each track

## Quick Start — First Test Drive

### 1. Fix the PDB (Required)

The USB has 930 tracks but the PDB still references 3,926+ (including deleted ones).
XDJ-XZ shows "E error" when browsing.

**Fix options:**
1. **Rekordbox re-export** (cleanest): Open rekordbox → right-click USB → Update Collection
2. **Fresh export**: Create playlist of the 930 stemmed tracks → Export to USB
3. The `rekordbox.xml` on the USB has the correct STEMS playlists for reference

### 2. Prepare the USB

1. Plug DJLIBRARYM USB into Mac
2. Run: `bash /tmp/xz_complete_usb_setup.sh`
3. This syncs OverCue bundles + playlists
4. Open XZ Mods Beta app to verify the USB is recognized

### 3. Boot the XDJ-XZ

1. **Power off** the XDJ-XZ completely
2. Insert USB into **USB2 slot** (right USB-A port — for music)
3. For four-deck: connect USB-B → USB-A loopback cable to **USB1** slot
4. **Power on** — `autoexec.bin` loads XZ Mods into RAM
5. Wait for normal boot — stem controls appear automatically

⚠️ **Must cold boot** — hot-plugging USB won't load the mod.

### 4. Using Stems

- Navigate to a stemmed track in the browser
- Stem button appears when a track with OverCue data loads
- **Vocals** mute/solo, **Drums** mute/solo, **Harmonics** mute/solo
- **Bypass** returns to original mix
- Physical pad assignment: MODS → Controls → choose stem bank

### 5. Verify

- [ ] XDJ-XZ boots with XZ Mods active (check display theme)
- [ ] Track browser shows tracks from `Contents/`
- [ ] No E error when browsing
- [ ] Stem controls work on stemmed tracks
- [ ] Mute/solo each stem: Vocals, Drums, Harmonics
- [ ] Bypass returns to original mix
- [ ] Removing USB and rebooting restores stock firmware

## v0.5.0-preview.22 Features

- **Four-deck standalone** with animated USB-B cable guide and automatic loopback bridge
- **Two interfaces**: MODERN and CLASSIC (MODS → Appearance → Interface)
- **21 themes** including Flagship, Liquid Glass, Game Boy, Win95, Aurora
- **FLAC stem pages** (OVPGZ003/004) — lossless, smaller than 96 kHz zlib
- **Per-stem waveforms** on XDJ-XZ STEMS scrolling display
- **Live Streamer** — OBS Browser Source URL for screen capture
- **DJ Profile 1.0** — per-DJ profiles on USB
- **Beat Arcade** — Wave Rider, games
- **Import** Demucs/Suno/UVR stems directly
- **Library repair** utility

### Beta Limits (preview.22)

- XDJ-XZ firmware 1.26 only
- Music USB stays in USB2; USB1 for loopback after boot
- No music USB hot-swap during playback
- Software jog waveform/artwork incomplete
- No stem RAM carry between tracks
- No automatic half/double BPM matching (shown as LIMIT)

## Safety

- **RAM-only mod** — `autoexec.bin` runs in memory, no firmware writes
- **Zero brick risk** — remove USB + reboot = stock XDJ-XZ
- **Existing drives untouched** — GREY FIKWOK is read-only for stems

## File Layout

### FIKWOK (Master)

```
/Volumes/GREY FIKWOK/
  Contents/                     # 1,925 music files (master library)
  stems/                        # 2,272 Demucs stem folders, 123 GB
    rb-XXXXXXXX/
      vocals.flac drums.flac bass.flac other.flac
  CDJMODS/                      # OverCue bundles (built by megadj stem-overcue)
    index.json                  # 905+ track entries
    stems/<bundle-id>/
      overcue-manifest.json
      stems-sidecar-vocal.s16le.pgz
      stems-sidecar-drums.s16le.pgz
      stems-sidecar-harmonics.s16le.pgz
      stems-sidecar-instrumental.s16le.pgz
      stems-sidecar-vocals-drums.s16le.pgz
      stems-sidecar-vocals-harmonics.s16le.pgz
      stems-sidecar-full-mix.s16le.pgz
      stems-drums-waveform.2EX/.EXT
      stems-harmonics-waveform.2EX/.EXT
      stems-vocal-waveform.2EX/.EXT
  rekordbox.xml                 # STEMS playlists
```

### USB (DJLIBRARYM)

```
/Volumes/DJLIBRARYM/
  autoexec.bin                  # XZ Mods v0.5.0-p22 loader (31 MB)
  Contents/                     # 930 music files (stemmed subset)
  CDJMODS/                      # Synced from FIKWOK
    index.json
    stems/...
  PIONEER/rekordbox/export.pdb  # ⚠️ needs re-export (references deleted tracks)
  DJPROFILE/                    # DJ profile
  rekordbox.xml                 # STEMS playlists
```

## Related

- [Stems pipeline plan](stems-pipeline-plan-2026-10-29.md)
- [#555 — stem pipeline](https://github.com/webuildstuffio/megadj/issues/555)
- [#556 — unified Demucs](https://github.com/webuildstuffio/megadj/issues/556)
- [XZ Mods repo (fork)](https://github.com/webuildstuffio/XZ-Mods)
- [XZ Mods upstream](https://github.com/OpticMystic/XZ-Mods)
- [OverCue stems format](https://github.com/OverCue-gg/overcue-stems-format)
