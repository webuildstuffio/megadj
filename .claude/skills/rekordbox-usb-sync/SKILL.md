---
name: rekordbox-usb-sync
description: >-
  Sync megadj YTMusic downloads onto the DJ USB drives (DJMASTER master +
  DJMIRROR mirror) with full rekordbox integration: DB injection, BPM
  detection, beatgrid/waveform ANLZ generation, and verification. Use when
  asked to put new megadj/YTMusic music on the USBs, sync the drives, or
  analyze/beatgrid tracks for rekordbox.
---

# Rekordbox USB Sync

End-to-end pipeline: megadj download folder → both DJ USB drives running a
verified, fully analyzed rekordbox device library.

## Current library state (as of 2026-08-25)

| | DJMASTER | DJMIRROR |
|---|---|---|
| Role | MASTER | Mirror (kept identical) |
| DB | `PIONEER/rekordbox/exportLibrary.db` — SQLCipher, 3,054 tracks · 154 playlists · 30,435 entries | same file, MD5-identical |
| Music | `Contents/` — 3,794 files | superset, 0 diff |
| Analysis | `PIONEER/USBANLZ/` — device folders P000–P07F + P080 (YTMusic) | superset, 0 diff |
| New tracks device ID | `P080` | `P080` |

Recovery kit: `~/rekordbox-exports/` (STATUS-FINAL.md, XML).
Working scratch: `/tmp/usb-sync/` (work_master.db is the live master copy).

## Safety rules

- **QUIT rekordbox before touching DBs** — a running app rewrites
  export.pdb/exportLibrary.db and will corrupt concurrent edits.
- **Never write to the drives' DBs directly.** Always: copy DB to /tmp →
  edit → verify → copy back → delete stale `-wal`/`-shm` files.
- **Never delete source files.** FAT32 is case-insensitive; "missing" files
  are often case-variants — compare with NFC + casefold keys.
- Background `nohup` jobs on this machine get reaped unpredictably. Run
  long copies as foreground chunks with a timebox + resumable state file.

## Pipeline steps

### 0. Preflight

```bash
ls /Volumes/                      # both drives mounted?
ps aux | grep -i rekordbox        # must be empty
df -h /Volumes/DJMASTER /Volumes/DJMIRROR
```

### 1. Verify download integrity (megadj leaves junk)

megadj's tagging step can crash mid-run leaving zero-byte `.tagged.m4a` /
`.temp.m4a` files. Before anything else, probe every file:

```python
# ffprobe each file; "moov atom not found" or size 0 = broken.
# Good originals usually sit next to the junk in the same source folder.
```

Replace broken files from the megadj source dir (`~/Music/YTMusic-Liked`),
preserving the `NNN - ` rank prefix.

### 2. Metadata extraction (ffprobe)

For each new file: duration_ms, bitrate, sample rate, embedded title/artist
tags. Filenames are `NNN - Artist - Title.ext` (megadj convention,
NNN = newest→oldest order).

### 3. DB injection (pyrekordbox)

```python
uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" python ...
```

- Copy `exportLibrary.db` from DJMASTER to `/tmp/usb-sync/work_master.db`.
- Open with `DeviceLibraryPlus` (SQLCipher handled internally).
- `Content` rows: `title`, `length` (**SECONDS**, not ms), `artist_id_artist`, `path` =
  `/Contents/YTMusic Liked/<filename>`, `fileType=4` (m4a), `fileSize`,
  `bitrate`, `samplingRate`, `analysisDataFilePath` =
  `/PIONEER/USBANLZ/P080/<8-hex-uid>/ANLZ0000.DAT` (unique random uid).
- **Gotchas**: `releaseDate`/`dateCreated`/`dateAdded` must be set — the
  model serializer crashes on None datetime. Artist FK requires an Artist
  row (create with next free artist_id).
- Playlist: find-or-create `Playlist(name="YTMusic Liked", attribute=2)`,
  add `PlaylistContent(playlist_id, content_id, sequenceNo=i)` newest first.
- `db.commit()`, then re-open and count before deploying.

### 4. BPM detection

librosa cannot open these m4a files directly — pipe ffmpeg output:

```python
r = subprocess.run(["ffmpeg","-v","error","-t","120","-i",full,"-vn","-ac","1",
                    "-ar","11025","-f","f32le","-"], capture_output=True)
y = np.frombuffer(r.stdout, dtype=np.float32)
tempo, _ = librosa.beat.beat_track(y=y, sr=11025)
# range-correct: <60 ×2, >=200 ÷2 → bpmx100 = int(round(bpm*100))
```

### 5. ANLZ beatgrid + waveform generation

ANLZ0000.DAT is big-endian tagged sections. **Section = tag(4) +
u32 hdr_size + u32 total + header + payload**, where `total` counts from
the tag start. Layouts (verified against Pioneer-generated files):

| Tag | Layout |
|---|---|
| PMAI | total=28: `tag + (28, 0x18FA, 1, 0x10000, 1, 0)` — six u32s |
| PPTH | `tag + (16, 16+len(path_bytes), len(path_bytes)) + path` UTF-16BE, no pad |
| PVBR | `tag + (16, 24, 1620, 0) + 4 zero bytes` |
| PQTZ | hdr `tag + (24, 32+n*8) + (0, 0x80000, n, bpm100, 147)`; entries `>4H`: (beat_in_bar 1-4, bpm100, ms_hi, ms_lo) |
| PWAV | `tag + (20, 20+n, n, 0x10000) + n u8 peaks` |
| PWV2 | same shape as PWAV, n u8 color peaks |
| PCOB | empty cues: `tag + (24, 24, 0, 0, 0)` |

Beat grid entries: first beat at ~615ms, beat_in_bar cycles 2→3→4→1,
ms stored as hi/lo u16 pair (full_ms = hi*65536 + lo).

Waveform peaks: ffmpeg-decode first 30s mono 8kHz, abs-max per bucket,
200 buckets for PWAV / 100 for PWV2, scaled to 0-255 u8.

**Validate every generated file** by re-walking sections and asserting the
final offset equals file length exactly.

### 6. Deploy

```bash
cp /tmp/usb-sync/work_master.db /Volumes/DJMASTER/PIONEER/rekordbox/exportLibrary.db
rm -f /Volumes/DJMASTER/PIONEER/rekordbox/exportLibrary.db-{wal,shm}
# same for DJMIRROR (+ exportLibrary.db.backup copy)
```

Sync `export.pdb`, `exportExt.pdb`, `playlists3.sync`, `playlists3Plus.sync`,
`RBFLTR.DAT` from master to mirror.

### 7. Mirror files to DJMIRROR

Use the skill's CLI — it has progress bars, ETA, byte counts, and resumes
after interruptions:

```bash
cd ~/github/megadj
uv run python .claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py            # everything
uv run python .claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py --anlz-only
uv run python .claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py --verify-only --hash-parity
```

Output looks like:

```
=== [2] Mirror Contents/ (music files)  (t+00:41) ===
    Contents copy: 293 missing, 0 already done in prior runs
[Contents copy] [############--------] 1450/3794 files · 1.4/4.5 GB · 38% · 27.9 MB/s · ETA 02:11
```

- Progress bar + rate + ETA on a TTY; plain 5%-milestone lines when piped to
  a log (`tail -f` friendly).
- State file `/tmp/usb-sync/usb_mirror_state.json` records copied paths —
  rerun after a reaped/interrupted job picks up where it left off.
- `--rekordbox-only` deploys DB + export.pdb/playlists syncs and drops
  stale WAL/SHM files.
- `--verify-only` compares manifests, DB MD5, and runs hash spot-checks.

### 8. Verify (all must pass)

```bash
uv run python .claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py --verify-only
```

- DB decrypts; track/playlist/entry counts match on both drives
- DB files MD5-identical across drives
- Every DB track path exists on disk (both drives)
- Every `analysisDataFilePath` exists (both drives)
- 0 tracks without BPM
- Manifests: mirror ⊇ master, 0 diff
- Random hash spot-checks across drives: 0 mismatches

Update `~/rekordbox-exports/STATUS-FINAL.md` with new counts.

## Scripts in this skill

- `scripts/progress.py` — zero-dep progress bar (bar + rate + ETA on TTY,
  5%-milestone lines when piped) + numbered stage banners. Import into any
  future sync script.
- `scripts/usb_sync.py` — new-download pipeline: ffprobe → DB injection →
  BPM detection → ANLZ generation. CLI args replace the old /tmp one-shots:

  ```bash
  uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
      --with librosa --with numpy \
      python .claude/skills/rekordbox-usb-sync/scripts/usb_sync.py \
      --db /tmp/usb-sync/work_master.db --drive /Volumes/DJMASTER \
      --folder "/Contents/YTMusic Liked" --playlist "YTMusic Liked" [--meta ytmusic_meta.json]
  ```

- `scripts/usb_mirror.py` — the mirror/verify CLI described above. Also:
  `--hash-parity` (full byte-level hash comparison) and `--audio-parity`
  (make mirror audio byte-identical to master, backing up replaced variants
  to `/tmp/usb-sync/nm_replaced_variants/` first — needed after multi-drive
  merges leave different rips of the same track on each drive).
- `scripts/usb_verify.py` — deep 10x verification: per-drive DB/disk/grid/
  playlist checks + cross-drive DB MD5, full USBANLZ hash parity, audio
  spot-checks. Distinguishes real failures from Pioneer-native variance
  (factory sample loops, variable-tempo grid drift ≤2%).

  ```bash
  uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
      python .claude/skills/rekordbox-usb-sync/scripts/usb_verify.py [--drives DJMASTER DJMIRROR]
  ```

## Known limitations

- Generated grids are constant-BPM; live sets / tempo-drifting mixes need a
  rekordbox re-analysis pass for perfect grids.
- PWAV/PWV2 waveforms cover the first 30s only; rekordbox re-analysis fills
  the rest.
- `export.pdb` is NOT regenerated (old-format export). Device-library-plus
  players (CDJ-3000/XDJ-RX3 etc.) read `exportLibrary.db`; if a target needs
  the legacy pdb, do a rekordbox export instead of this pipeline.
- Multi-origin merges can leave different rips of the same track on each
  drive. `usb_mirror.py --audio-parity` reconciles (master wins, mirror
  variants backed up first).
