# Runbook 0d — Write-path spike (GA-07)

**Status:** 🟡 BLOCKED — harness shipped (incl. Q4's `set-grid` writer,
2026-09-18); four rekordbox/hardware observations remain before the
repair route can be selected.

Settle where rekordbox grids truly live and which write route repairs
them. This decides `GA-06`'s implementation — nothing in Part A repairs
anything until this verdict exists.

**Read this whole doc before touching rekordbox.** Total hands-on time:
~30 minutes. Every command is copy-paste; the only manual steps are the
rekordbox UI actions called out per question.

## Before you start

1. rekordbox **closed** unless a step says otherwise.
2. Shelf mounted (`/Volumes/SHELF1`; override with `MEGADJ_SHELF_VOLUME`).
3. **Full backup, timestamped, before any write** — grid data has no undo:

```sh
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p ~/Music/rekordbox/spike-bak-$STAMP
cp -R /Volumes/SHELF1/PIONEER/Master ~/Music/rekordbox/spike-bak-$STAMP/Master
megadj shelf-sync --dry-run   # confirm nothing in flight
```

4. Pick **five sacrificial tracks** you don't care about (re-addable from
   the archive), note their titles.

The harness (`megadj rb-anlz-spike`) hashes every sidecar under
`PIONEER/Master/share/ANLZ/` and `PIONEER/USBANLZ/` and records a
per-section byte inventory (PPTH path, PVBR, PQTZ grid, PWAV/PCOB …).
Baselines live in `~/.local/state/megadj/spike/` — never on the drive.

## Q1 — Are drive ANLZ byte-identical across an unchanged re-export?

GA-03's foundation. If yes, byte-hashing is a valid triage base.

```sh
megadj rb-anlz-spike snapshot --tag q1
# rekordbox: open (shelf DB), select ONE unchanged playlist with the 5
# tracks, right-click → "Synchronize" (or export it again unchanged), quit.
megadj rb-anlz-spike compare --tag q1
```

- **Verdict YES** (0 changed): ANLZ hashing is stable → GA-03 triage can
  rely on byte compares. Record in the execution log below.
- **Verdict NO**: record which sections moved. If only PPTH/PVBR changed
  but PQTZ is byte-stable, GA-03 needs a PQTZ-level compare (structural,
  not hash) — bigger build, say so in the log.

## Q2 — A hand grid nudge changes exactly what?

Maps the TRUE storage of grids.

```sh
megadj rb-anlz-spike snapshot --tag q2
# rekordbox: open, pick ONE of the 5 tracks, open its GRID EDIT panel,
# nudge the grid ±1 beat, close. Quit rekordbox.
megadj rb-anlz-spike compare --tag q2
```

Expected `CHANGED` lines tell you which files moved. Then check the DB
side ( rekordbox MUST be quit — live WAL):

```sh
megadj rb-grid-triage --limit 20 --json | head -40
# and the master DB flag:
uv run --with pyrekordbox python -c "
from pyrekordbox import Rekordbox6Database as R
import sys
db = R(sys.argv[1])
for c in db.get_content():
    print(c.ID, c.Title, getattr(c, 'Analysed', None), c.AnalysisDataPath)
    break
db.close()" "/Volumes/SHELF1/PIONEER/Master/master.db"
```

Record: master.db row changed? collection ANLZ changed? which sections
(PQTZ = grid, PWAV = waveform → the nudge re-renders the waveform)?

## Q3 — Does the XML TEMPO route overwrite an existing track's grid?

```sh
# rekordbox: File → Export → Collection XML (note the path).
# Edit ONE track's <TEMPO Inizio="..." Bpm="..."/> element (±1 BPM).
# rekordbox: File → Import → Library → Import the SAME xml
#   → select-all → "Import to Collection" (the two-step overwrite
#   workaround, RB 5.6.1 → 7 documented behavior).
megadj rb-anlz-spike compare --tag q2   # did anything change?
```

- **Verdict YES** (track's grid changed + ANLZ regenerated): XML is the
  GA-06 write route. Simplest, sanctioned, reversible via backup.
- **Verdict NO**: the XML route is dead for repairs of EXISTING tracks —
  it only adds new rows. Go to Q4.

## Q4 — Direct ANLZ grid edit (only if Q3 failed)

**Armament shipped (2026-09-18): `rb-anlz-spike set-grid`** — the direct
PQTZ rewrite, built on `src/fulltags/analysis/anlz.ts`'s `rewriteAnlzGrid`
(container walk stays byte-exact; only the grid span differs). Safety
pattern = rb-fix-paths: **dry-run by default**, pre-edit backup kept
automatically, whole-file re-verify after write (decode-back must equal
the requested beats AND non-PQTZ section sizes must survive, or the
file is restored from the backup). Works on the compare-style key
(`collection/ANLZ0000.DAT`, `usb/P001/<hash>/ANLZ0000.DAT`), a
mount-relative path, or an absolute path inside the mount.

```sh
# 1. pick the track's sidecar from the Q2 diff (that's the one whose
#    PQTZ moved) and read its current grid:
megadj rb-grid-triage --limit 20 --json
# 2. DRY RUN — prints the planned edit, writes nothing:
megadj rb-anlz-spike /Volumes/SHELF1 set-grid --tag q4 \
  --file 'collection/ANLZ0000.DAT' \
  --beats '[{"num":1,"bpmx100":12800,"timeMs":0},{"num":2,"bpmx100":12800,"timeMs":469}]'
# 3. WRITE — automatic pre-edit backup + whole-file re-verify:
megadj rb-anlz-spike /Volumes/SHELF1 set-grid --tag q4 --apply --yes \
  --file 'collection/ANLZ0000.DAT' --beats '...'
#    (beats rows: num 1..4 = beat index in the bar, bpmx100 = BPM×100,
#     timeMs = absolute time in ms; generate rows from a fitted grid
#     with jq or the beat-this ledger export)
# 4. verify from the OTHER side — the spike sees the edit as a hash change:
megadj rb-anlz-spike /Volumes/SHELF1 compare --tag q4
# rekordbox: reopen, load the track — does the corrected grid show?
# CDJ: export to a stick, load — does the corrected grid show?
```

- **Verdict YES**: direct ANLZ edit is the GA-06 route — the writer is
  already behind the safety pattern (backup, dry-run, `--apply --yes`,
  re-verify EVERY file).
- **Verdict NO**: grids are write-protected end-to-end; GA-06 collapses
  to "re-anchor via rekordbox UI + scripted verification only". Document
  and stop.

## Execution log

| Date | Question            | Verdict                                    | Evidence                                 |
| ---- | ------------------- | ------------------------------------------ | ---------------------------------------- |
| —    | Q1 re-export stable | open                                       | run the commands above, write the row    |
| —    | Q2 nudge storage    | open                                       |                                          |
| —    | Q3 XML overwrite    | open                                       |                                          |
| —    | Q4 direct ANLZ edit | armed (`set-grid` built, unrun vs live RB) | docs/runbooks/0d-write-path-spike.md §Q4 |

Write the verdict into `docs/fulltags/grid-audit-plan.md` §GA-07 and GA-06's
route line in the same edit. "Open but armed" is a valid state when the
hardware isn't at hand — the commands above ARE the armament.
