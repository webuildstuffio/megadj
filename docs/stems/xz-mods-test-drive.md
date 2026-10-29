# XZ Mods Test-Drive Plan — 32 GB FAT32 USB

> Created 2026-10-29. Status: **ready to execute**.

## Overview

Boot XZ Mods on the XDJ-XZ using a dedicated 32 GB test USB.
Existing drives (SHELF1, FLIP-MASTER) stay untouched.

## Prerequisites

| Item | Status |
|---|---|
| XDJ-XZ firmware **1.26** | ✅ verify in Utility → System Info |
| XZ Mods repos cloned | ✅ `~/github/XZ-Mods` (origin=OpticMystic, fork=webuildstuffio) |
| XZ Mods Mac app | ✅ `~/github/XZ-Mods/releases/XZ-Mods-Mac-Apple-Silicon.dmg` v0.2.1 |
| xdj-xz-toolkit | ✅ `~/github/xdj-xz-toolkit` (side-by-side) |
| `megadj stems` | ✅ shipped (#555, #556) |
| `megadj stem-export` | ✅ shipped (#555) |
| `megadj stem-status` | ✅ shipped |
| 32 GB USB drive | 🔲 plug in |
| Demucs + PyTorch (uv) | ✅ auto-installed by `megadj stems` via `uv run` |

## Capacity Budget (32 GB FAT32 ≈ 29.8 GB usable)

| Slice | Estimate |
|---|---|
| Tracks (MP3/FLAC ~8 MB avg) | ~200–400 tracks ≈ 1.5–3 GB |
| OverCue stems (7 mixes/track, ~20–40 MB compressed per track) | ~4–12 GB for 200 tracks |
| PIONEER/ (rekordbox export) | ~50 MB |
| autoexec.bin + CDJMODS metadata | < 1 MB |
| **Headroom** | comfortable at 200 tracks |

Start with **--limit 50** to validate, then scale to 200.

## Step-by-Step

### 1. Format the 32 GB USB as FAT32

```bash
# Plug in, find its disk identifier
diskutil list external

# ⚠️  TRIPLE-CHECK the disk number — this erases the drive
diskutil eraseDisk FAT32 XZTEST MBRFormat /dev/diskN
```

### 2. Export a test set of tracks to the USB

The simplest path: manually copy ~50 tracks from SHELF1 into
`/Volumes/XZTEST/Contents/` (any subfolder structure works, Rekordbox
will see them).

Or Rekordbox → Export to Device: select ~50 tracks, export to XZTEST.
This creates `PIONEER/rekordbox/export.pdb` which XZ Mods needs.

> **Important:** The USB must have a valid `PIONEER/rekordbox/export.pdb`
> for XZ Mods to discover tracks. Either Rekordbox-export or use
> `megadj rb-import` to create one.

### 3. Run Demucs stem separation

```bash
cd ~/github/megadj

# First: check current stem cache coverage
bun run cli stem-status

# Separate 50 tracks (~25 min on MPS)
bun run cli stems --limit 50

# Verify
bun run cli stem-status
```

Stems cache at `~/.local/state/megadj/stems/` — shared by all consumers.
Override with `MEGADJ_STEM_DIR`.

### 4. Export OverCue stems to the USB

```bash
# Dry run first — see what would be written
bun run cli stem-export /Volumes/XZTEST --limit 50 --dry-run

# Real export
bun run cli stem-export /Volumes/XZTEST --limit 50
```

This writes:
- `CDJMODS/stems/<bundle-id>/` — 7 PGZ mixes per track (96 kHz s16le zlib)
- `CDJMODS/index.json` — maps file paths to bundles
- Warns if `autoexec.bin` is missing

### 5. Prepare the XZ Mods loader

Open the XZ Mods Mac app (from DMG → Applications).

1. **System Preferences → Privacy & Security → Open Anyway** (ad-hoc signed)
2. In the app: select the XZTEST volume
3. Click **Prepare USB** — writes `autoexec.bin` to the root
4. Optionally verify stems show as "Prepared" in the track list

### 6. Boot the XDJ-XZ with XZ Mods

1. **Power off** the XDJ-XZ
2. Insert XZTEST into **USB-A slot 1** (left side)
3. Power on — `autoexec.bin` loads into RAM automatically
4. XZ Mods controls appear on the display:
   - **Vocals** mute/solo
   - **Drums** mute/solo
   - **Harmonics** (bass+other) mute/solo
   - **Bypass** (original mix)

### 7. Verify

- [ ] XDJ-XZ boots normally with XZ Mods active
- [ ] Track browser shows tracks from `Contents/`
- [ ] Stem controls (mute/solo) work on at least one track
- [ ] Removing USB and rebooting restores stock firmware (RAM-only, no flash)

## Safety

- **RAM-only mod** — `autoexec.bin` runs in memory, no firmware changes
- **Zero brick risk** — remove USB + reboot = stock XDJ-XZ
- **All open issues reviewed**: 3 open, none safety-related
- **No reports** of bricking or hardware damage across all issues/forums
- **Existing drives untouched**: SHELF1 (APFS NVMe, archive), FLIP-MASTER (playing)

## Scale-Up Path

Once the 50-track test passes:

```bash
# Separate more tracks (overnight, ~4-5h for 500)
bun run cli stems --limit 500

# Export to XZTEST
bun run cli stem-export /Volumes/XZTEST --limit 200

# Coverage report
bun run cli stem-status
```

The 32 GB USB comfortably fits ~200 tracks with stems. For larger
sets, use a bigger FAT32 USB (≤2 TB, FAT32 limit).

## Related

- [FEATURES.md § Stems](../FEATURES.md)
- [#555 — stem pipeline](https://github.com/webuildstuffio/megadj/issues/555)
- [#556 — unified Demucs](https://github.com/webuildstuffio/megadj/issues/556)
- [XZ Mods repo (fork)](https://github.com/webuildstuffio/XZ-Mods)
- [XZ Mods upstream](https://github.com/OpticMystic/XZ-Mods)
- [OverCue stems format](https://github.com/OverCue-gg/overcue-stems-format)
