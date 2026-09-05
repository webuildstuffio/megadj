# rekordbox WAV Artwork — Reference (Sep 2026)

**Status:** ✅ RESOLVED — all legacy WAVs got covers via Option A
(pilot + batch, verified in rekordbox); new WAVs convert to
AIFF at ingest so they never need this. This doc is kept as reference for the
research, the decision, and the tooling (`tools/rb_art.py`).

**Problem:** embedded artwork in WAV files never shows in rekordbox. MP3s
display covers; WAVs never do — in the browser, on the CDJs, anywhere.

**Root cause (verified):** rekordbox reads WAV metadata **only** from RIFF INFO — which has
*no artwork field*. The ID3 chunk our pipeline embeds in the WAVs is valid (Finder, Serato,
VirtualDJ, etc. all show it), but rekordbox's WAV parser ignores it by design. This is not
a bug in our files and no tag trick fixes it.

**Where rekordbox art actually lives:** in its own library, not the file:

```
~/Library/Pioneer/rekordbox/share/PIONEER/Artwork/<shard>/<uuid>/artwork.jpg
```

Each track row in `master.db` (`djmdContent` table) points there via its `ImagePath`
column. Dragging art into the Artwork tab writes exactly this. WAV rows in
`master.db` can have empty `ImagePath`; artwork files exist on disk in this
layout (from the MP3s).

---

## All options considered

| # | Option | Verdict | Why |
|---|--------|---------|-----|
| A | **Master DB write via pyrekordbox** | ✅ **CHOSEN** | Automated now + forever; identical storage to Pioneer's own manual workflow |
| B | Convert WAV → AIFF | Clean but disruptive | Lossless (`-c:a copy`), RB reads AIFF art natively — but RB sees new files: re-import the files, redo playlists, re-analyze. Tools exist (`rekordbox-bulk-edit`, `rekordbox-edit`, `rekordbox-relocator`) that automate convert + DB path update preserving cues. Best long-term, costs prep rework |
| C | Manual drag in RB | Safe, tedious | Pioneer's official workflow; a batch of drags one-time + every future WAV. Keep `cover.jpg` beside each WAV to make it easier |
| D | ID3v2.3 tag trick | ❌ Myth | Contradicted by the rekordbox 7.0.7 manual, Pioneer's metadata matrix, and Lexicon's docs ("Rekordbox does not support album art for WAV files, even reloading tags will not show them") |
| E | Sidecar cover.jpg files | ❌ Does nothing | RB never reads companion image files on import; only useful as hand-off for C |
| F | Raw SQLCipher UPDATE on master.db | ⚠️ Risky | Same result as A but skips pyrekordbox's USN bookkeeping + FK checks. One typo = corrupt library. A supersedes it |
| G | Ignore it | ❌ | Not solving the problem |

### Why A wins
It is the **only** option that is both fully automated *now* and automatable for **every
future ingest**, while using the identical storage mechanism as Pioneer's own Artwork tab.
B costs RB prep rework; C costs manual drags forever. The DB-write risk is managed with the
same rules the repo already uses for any rekordbox touching (see below).

### Key research facts
- **Official spec** (rekordbox 7.0.7 manual): displayable tags are ID3 (MP3/AIFF), M4A meta,
  RIFF INFO (WAV), Vorbis (FLAC). WAV artwork is absent from the spec entirely.
- **Pioneer metadata matrix** maps WAV → Title/Artist/Album/Genre/Comment only. No art.
- **Lexicon** (largest 3rd-party RB tool, writes master.db directly) documented that even
  their direct-write path can't make WAV-embedded art appear — it's a parser limitation,
  not a DB one. But setting the DB *pointer* to stored artwork files is exactly what RB's
  own Artwork tab does — automatable.
- **Reload Tag will never help** for WAV art — confirmed independently by Lexicon's manual.
- **CDJ art comes from the USB export**, which carries RB's DB artwork along — fixing the
  RB library fixes the CDJ screens too. One fix, both screens.
- **Why people fear master.db writes:** WAL-mode corruption (editing while RB runs) and
  USN breakage (cloud-sync sequence numbers). Neither applies when RB is closed, backups
  are taken, and cloud sync is unused — all true here.

---

## The chosen implementation — Option A

> **Sep 2026 update:** a second fix shipped alongside this — **ingest now
> converts every new WAV to AIFF on the way in** (`src/commands/wav-to-aiff.ts`),
> so anything ingested from now on has native AIFF covers and never needs
> Option A. Option A remains the one-time fix for legacy WAVs
> already in the archive.

**Tool:** `tools/rb_art.py` (see below). Modes:

```bash
# 0. inspect — read-only status: how many WAVs lack art in RB
uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
    --with mutagen --with Pillow python tools/rb_art.py status

# 1. dry-run — plan every write, touch nothing
uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
    --with mutagen --with Pillow python tools/rb_art.py dry-run

# 2. pilot — write 3 tracks only, then YOU open rekordbox and verify covers show
uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
    --with mutagen --with Pillow python tools/rb_art.py pilot

# 3. batch — all remaining WAVs
uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
    --with mutagen --with Pillow python tools/rb_art.py batch
```

### Safety rails (non-negotiable, enforced by the script)
1. **rekordbox must be closed** — script aborts if the process is running (WAL corruption).
2. **Triple backup** before any write: `master.db` + `master.db-shm` + `master.db-wal` →
   dated folder `~/Library/Pioneer/rekordbox/backups/<date>/`.
3. **Pilot before batch** — 3 tracks, human verifies in RB, then batch.
4. **USN care** — writes go through pyrekordbox's ORM commit (manages update-sequence
   numbers); cloud sync is unused here, `rb_local_synced` stays untouched.
5. **Idempotent** — re-running skips tracks that already have `ImagePath`; safe after crashes.

### What the script does per track
1. Extract the embedded JPEG from the WAV's ID3 APIC frame (already 100% present).
2. Write it to `share/PIONEER/Artwork/<shard>/<uuid>/` in RB's layout — **all three
   files**: `artwork.jpg` + `artwork_m.jpg` (250px) + `artwork_s.jpg` (125px) via
   Pillow. **RB renders covers from the thumbnails** — a dir with only the full-res
   `artwork.jpg` silently shows no art (pilot-verified 2026-09-04).
3. Set `djmdContent.ImagePath = "/PIONEER/Artwork/<shard>/<uuid>/artwork.jpg"` (relative,
   matching how existing MP3 rows store it).
4. Commit via pyrekordbox (USN-managed).

Gotcha: if covers still show blank after a successful write, quit + reopen
rekordbox — it caches the old blank state in memory.

### Status — ✅ COMPLETE (2026-09-04)
- [x] Root cause researched + documented
- [x] `master.db` unlock verified (pyrekordbox, key cached)
- [x] Artwork layout confirmed on disk
- [x] `tools/rb_art.py` built (status / dry-run / pilot / batch)
- [x] Pilot machinery validated against a **copy** of master.db
- [x] Pilot on live DB: 3 tracks, covers verified in rekordbox
- [x] Batch: all legacy WAVs have art (`status`: without-art = 0)
- [x] USB export carries RB artwork to the drives automatically (artwork files +
      device-DB rows are written by the export; CDJ/XDJ screens read the drive's
      `PIONEER/Artwork/`). Verified live: a USB export updated
      `exportLibrary.db` + artwork on the mirror drive.

### Future ingests
Not needed for WAVs anymore — `megadj ingest` converts them to AIFF (native
covers). `rb_art.py` remains for any future legacy-WAV edge cases; re-run
`batch` manually after ingesting one.
