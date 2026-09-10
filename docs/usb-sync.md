# USB Sync Pipeline (shelf ⇄ master ⇄ mirror)

megadj downloads music; this pipeline puts it on the DJ USB drives with full
rekordbox integration (DB rows, BPM, beatgrids, waveforms) and keeps the two
drives byte-identical.

The step-by-step runbook (including the ANLZ binary format reference and all
gotchas) lives in `.claude/skills/rekordbox-usb-sync/SKILL.md`. This page is
the what/why summary for humans.

**The shelf tier (Sep 9 2026):** above both sticks sits the shelf master —
the archive-grade HDD (`library.shelf_drive`, default `SHELF1`) that holds
the strict byte-verified archive of every drive; rekordbox's master DB even
lives on it. Gig sticks sync FROM the shelf, never the other way. New music
reaches it via `megadj shelf-sync`; stray drives are swept in with
`megadj shelf-archive <volume>` (additive, MD5-verified, junk-filtered —
[usb-sync-log.md](usb-sync-log.md) Sep 9 entry is the worked example).
Every sweep records a verdict row in the archive DB's `shelf_sweeps`
ledger — `megadj shelf-sweeps` shows latest-per-drive — and the full
process lives in [shelf-intake](../.claude/skills/shelf-intake/SKILL.md).
Because players never read the shelf, its leftover `PIONEER/rekordbox/`
device tree (the migrated old stick's `DJLIBRARYM` library) is vestigial:
dual-db drift there is informational, never a failure (Sep 10).

Throughout this doc, **master** and **mirror** are your two drive volume
names (defaults `DJMASTER`/`DJMIRROR`; every script takes them as arguments).

## Topology

|          | Master                                           | Mirror                                |
| -------- | ------------------------------------------------ | ------------------------------------- |
| Role     | **MASTER** — source of truth                     | Mirror — kept identical (superset OK) |
| DB       | `PIONEER/rekordbox/exportLibrary.db` (SQLCipher) | same file, MD5-identical              |
| Library  | full core library + downloaded playlists         | mirrors master                        |
| Analysis | `PIONEER/USBANLZ/` (hash-path folders)           | identical, hash-verified              |

Master audio lives in `Contents/`; the mirror may carry a few extra files
(legacy superset) — that is normal and not a sync failure.

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
    --db /tmp/work_master.db --drive /Volumes/DJMASTER \
    --folder "/Contents/YTMusic Liked" --playlist "YTMusic Liked"

# 2. Replicate master -> mirror + verify
uv run python .claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py
uv run python .claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py --verify-only --hash-parity
```

Deep verification (per-drive DB/grid/playlist checks + cross-drive hashes):

```bash
uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
    python .claude/skills/rekordbox-usb-sync/scripts/usb_verify.py
```

## What the pipeline does

`usb_sync.py` runs the six-stage pass — integrity probe (ffprobe every
file) → DB injection (pyrekordbox `DeviceLibraryPlus`, /tmp DB copy) →
BPM (ffmpeg→librosa, 60–200 correction, `bpmx100`) → hand-built ANLZ
(`ANLZ0000.DAT`: PMAI/PPTH/PVBR/PQTZ/PWAV/PWV2/PCOB big-endian sections,
constant-BPM grid, 30s waveform) → mirror (resumable) → verify (manifest
coverage, DB MD5 + USBANLZ hash parity, per-track grid math, playlist FK
integrity). Stage details and the ANLZ binary reference live in the
skill's SKILL.md.

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
- **Rekordbox artwork is DB pointers + cached files, not tags** —
  `djmdContent.ImagePath` → `share/PIONEER/Artwork/<shard>/<uuid>/`;
  USB export carries the files + device-DB rows to the drive. Layout,
  thumbnail gotcha, and the legacy-WAV fix:
  [rekordbox-wav-artwork.md](rekordbox-wav-artwork.md).
- **WAVs never carry RB-readable art** — new ingests convert to AIFF
  (`src/commands/wav-to-aiff.ts`); see `docs/rekordbox-wav-artwork.md` for
  the legacy-WAV research.
- Long-running background jobs can get reaped; the tools are resumable for
  that reason.
- **CrateDeck automates the routine checks**: a fresh mount triggers a
  light scan automatically, and each drive gets a full verify weekly
  (`cratedeck/src/auto_schedule.ts`, config `[automation]`) — results feed
  the readiness badge, so "is this stick ok?" no longer requires opening
  anything.

## Known limitations

- Generated grids (from `usb_sync.py`) are constant-BPM; tempo-drifting mixes
  deserve a rekordbox re-analysis pass for perfect grids — or just let the
  legacy XML export analyze everything (it re-grids properly).
- Synthetic waveform previews cover the first 30s; rekordbox analysis fills
  the rest.
- The XZ-visible legacy `export.pdb` only updates via the XML-import +
  USB-export flow above — plan for it after each library generation, don't
  discover it gig night.
