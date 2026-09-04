# USB Sync Pipeline (DJMASTER ⇄ DJMIRROR)

megadj downloads music; this pipeline puts it on the DJ USB drives with full
rekordbox integration (DB rows, BPM, beatgrids, waveforms) and keeps the two
drives byte-identical.

The step-by-step runbook (including the ANLZ binary format reference and all
gotchas) lives in `.claude/skills/rekordbox-usb-sync/SKILL.md`. This page is
the what/why summary for humans.

## Topology

|          | DJMASTER                                                     | DJMIRROR                           |
| -------- | -------------------------------------------------------------- | ------------------------------------- |
| Role     | **MASTER** — source of truth                                   | Mirror — kept identical (superset OK) |
| DB       | `PIONEER/rekordbox/exportLibrary.db` (SQLCipher)               | same file, MD5-identical              |
| Library  | 3,054 core tracks + YTMusic Liked (294) + event playlists    | mirrors master                        |
| Analysis | `PIONEER/USBANLZ/` (P000–P07F + hash-path folders for YTMusic) | identical, hash-verified              |

Master audio lives in `Contents/` (~3,795 files); the mirror carries a few
more (legacy superset, +157) — that is normal and not a sync failure.

## The two databases (read this before touching anything)

| DB                              | Read by                        | Who writes it                        |
| ------------------------------- | ------------------------------ | ------------------------------------ |
| `exportLibrary.db` (OneLibrary) | rekordbox 7, OPUS-QUAD, XDJ-AZ | our pipeline (pyrekordbox injection) |
| `export.pdb` (legacy PDB)       | **XDJ-XZ, older CDJs**         | rekordbox only, via USB export       |

Injecting into OneLibrary alone leaves the XZ blind to new tracks. Once per
library generation, do the **legacy export**: generate full-library XML from
the working DB → import into rekordbox 7 → drag playlists onto both devices →
let rekordbox analyze (~1–2h for thousands of tracks) → export to the
devices. rekordbox then writes BOTH DBs and Pioneer-grade grids/waveforms.
XML schema rules that silently break the import are documented in the skill
(flat `Location` attribute, `encode_path`, NODE types — get any of them wrong
and playlists import empty).

## The two commands

```bash
# 1. New batch of megadj downloads -> master drive (probe, inject, BPM, ANLZ)
uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
    --with librosa --with numpy \
    python .claude/skills/rekordbox-usb-sync/scripts/usb_sync.py \
    --db /tmp/usb-sync/work_master.db --drive /Volumes/DJMASTER \
    --folder "/Contents/YTMusic Liked" --playlist "YTMusic Liked"

# 2. Replicate master -> mirror + verify
uv run python .claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py
uv run python .claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py --verify-only --hash-parity
```

Deep 10x verification (per-drive DB/grid/playlist checks + cross-drive hashes):

```bash
uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
    python .claude/skills/rekordbox-usb-sync/scripts/usb_verify.py
```

## What the pipeline does

1. **Integrity probe** — ffprobe every file; catches megadj's crashed-tagging
   zero-byte junk before it poisons the DB.
2. **DB injection** — `Content`/`Artist` rows + a `YTMusic Liked` playlist via
   pyrekordbox `DeviceLibraryPlus`, on a /tmp copy of the DB (never the live
   file; rekordbox must be quit).
3. **BPM** — ffmpeg→librosa (`beat_track`), 60–200 BPM range correction,
   stored as `bpmx100`.
4. **ANLZ generation** — builds `ANLZ0000.DAT` by hand (PMAI/PPTH/PVBR/PQTZ/
   PWAV/PWV2/PCOB, big-endian tagged sections). Constant-BPM grid from ~615ms,
   30s waveform preview.
5. **Mirror** — contents, analysis, DB, and rekordbox support files to
   DJMIRROR; resumable with progress bars.
6. **Verify** — manifest coverage, DB MD5 parity, full USBANLZ hash parity,
   audio spot-checks, per-track grid math, playlist FK integrity.

## Hard-won facts (don't relearn these)

- **rekordbox must be quit during DB/file surgery; a running app rewrites
  export.pdb/exportLibrary.db concurrently and corrupts them.** During its
  own export/analysis, though, hands OFF the drives entirely (FAT32 corrupts
  on concurrent writes).
- **`Content.length` is SECONDS**, not ms. A ms value looks like a 90-minute track.
- Datetime columns (`releaseDate`, `dateCreated`, `dateAdded`) must be non-None
  or the pyrekordbox serializer crashes on commit.
- **PQTZ beat entries** are `>4H`: (beat_in_bar, bpm100, ms_hi, ms_lo) — ms is
  a hi/lo u16 pair, not one u32.
- **PWAV/PWV2 peaks are u8** (0–255), one byte each — not u16.
- ANLZ `total` fields count **from the tag start**, including the 4 tag bytes.
- Pioneer's own ANLZ `PPTH` paths carry trailing NULs — strip before comparing.
- Pioneer's own grids legitimately drift from DB BPM values by up to ~2% on
  variable-tempo tracks; the verifier treats this as informational, not a failure.
- FAT32 is case-insensitive and NFC-ambiguous: compare paths with
  `NFC + casefold` keys or you'll see phantom missing files.
- **Rekordbox artwork is DB pointers + cached files, not tags**: covers live in
  `share/PIONEER/Artwork/<shard>/<uuid>/` (`artwork.jpg` + `_m`/`_s` thumbnails —
  RB renders from the thumbnails; missing `_m`/`_s` = silently blank) and
  `djmdContent.ImagePath` points there. USB export copies the artwork files into
  `PIONEER/Artwork/000xx/` on the drive and rewrites device-DB rows, so art set in
  the collection (incl. via `tools/rb_art.py`) rides to the hardware automatically.
- **WAVs never carry RB-readable art** — new ingests convert to AIFF
  (`src/commands/wav-to-aiff.ts`); the 73 legacy WAVs were pointer-fixed via
  `tools/rb_art.py` (see `docs/rekordbox-wav-artwork.md`).
- Long-running background jobs on this machine get reaped; the tools are
  resumable for that reason.

## Known limitations

- Generated grids (from `usb_sync.py`) are constant-BPM; tempo-drifting mixes
  deserve a rekordbox re-analysis pass for perfect grids — or just let the
  legacy XML export analyze everything (it re-grids properly).
- Synthetic waveform previews cover the first 30s; rekordbox analysis fills
  the rest.
- The XZ-visible legacy `export.pdb` only updates via the XML-import +
  USB-export flow above — plan for it after each library generation, don't
  discover it gig night.
