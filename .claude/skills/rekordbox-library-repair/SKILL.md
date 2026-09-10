# rekordbox Library Repair — missing tracks + device DB sync

Fixes the two failure modes that follow any shelf/folder reorganization:
(1) rekordbox "Missing tracks" (stale `djmdContent.FolderPath` rows) and
(2) device-DB drift (`export.pdb` row count ≠ OneLibrary count, so CDJs/XDJ
show a stale library). One DB tool, one export, one verify. Works on the
shelf master or any drive whose master DB rekordbox manages.

## When to use

- Missing File Manager shows a pile of missing tracks (tens/hundreds)
- `deckctl verify <drive>` fails `audio-files` (DB tracks with no file)
- `deckctl verify <drive>` fails `dual-db` (OneLibrary vs pdb drift)
- Auto Relocate is too slow (hours) or keeps "not finding" files that exist

## Rules (read first)

- **rekordbox must be fully quit** before any DB read/write (it holds a
  live WAL; writes while open are lost or corrupt).
- **Never write without a dated backup** of the DB (+ `-wal`/`-shm`).
- **Prove which DB you're fixing.** `lsof -p $(pgrep -x rekordbox)` shows
  the DB the app actually holds. `pyrekordbox Rekordbox6Database()` with
  no args opens whatever its config points at — pass the path explicitly
  and confirm `db.session.bind.url` before any UPDATE.
- **Verify every row after any rewrite** — full-library scan, not
  prefix-scoped. A prefix check hides whole failure classes.
- **Before calling a row "dead", hunt for twins.** Auto-relocate renumbers
  (`-1`, `-2`) and scatters YTMusic dump files into artist dirs; files
  renamed during merges still exist. Only truly-absent files get deleted.
- Quarantine/staging dirs live at the DRIVE ROOT, never inside `Contents/`
  (auto-relocate scans `Contents/` and chases quarantined files).

## The tool: `megadj rb-fix-paths`

Single reusable command (no one-off scripts). Dry-run by default. Shipped
Sep 10 2026 (`src/commands/rb_fix_paths.ts`; reads the real encrypted
master DB via pyrekordbox — the examples below are exactly what runs).

```bash
# 1) See what's broken and what's fixable (no writes; safe any time)
megadj rb-fix-paths SHELF1 --json
# → {"command":"rb-fix-paths","total":3050,"broken":0,"fixable":0,"dead":0,...}

# 2) Apply rewrites (backs up the DB first, refuses while rekordbox runs)
megadj rb-fix-paths SHELF1 --apply --yes

# 3) Confirm zero broken rows — the post-check is the WHOLE table,
#    every row, every time
megadj rb-fix-paths SHELF1 --json   # broken: 0
```

Matching ladder (per broken row): exact path → NFC+casefold path →
basename (must be unique) → strip repeated `-N` copy suffixes → 20-char
prefix (exFAT truncation) → largest twin when ambiguous (quality bias).
Truly-dead rows are listed in `deadList` — they are Missing File
Manager's job (Delete from Library), never this tool's.
Rows with no live match are reported, never touched.

## The flow, end to end

1. `deckctl run <drive> verify` — see `audio-files` + `dual-db` state.
2. `megadj rb-fix-paths <mount> --json` — review the fix map.
3. Quit rekordbox. `megadj rb-fix-paths <mount> --apply --yes`.
4. Reopen rekordbox → Missing File Manager. Expect only truly-dead rows
   (files you deleted on purpose). Select → Delete from Library.
5. **File → Export → <drive>** — GIG STICKS ONLY. This rebuilds
   `export.pdb` for hardware players. On a SHELF drive it is NOT needed:
   no player reads the shelf, the empty device tree is the shelf's
   correct state, and CrateDeck's checks are role-aware (player-facing
   checks are omitted for shelf-role drives — Sep 10).
   Verify in app: File → Library size should
   match the DB row count.
   **Nuclear option (proven Sep 10):** if a drive's device tree is a
   half-migrated ghost (mangled identity, wrong-era counts), quit
   rekordbox, back up the master DB, move `PIONEER/rekordbox/` to a
   quarantine dir at the DRIVE ROOT (never inside `Contents/`), sweep
   `._*` strays, reopen rekordbox and Export — it lays down a FRESH
   device library from the current master. Keep `USBANLZ/` + `Artwork/`:
   they are hash-keyed caches a fresh export reuses, saving hours of
   re-analysis. (On a shelf this export is optional — the master DB is
   what matters, and it stays put.)
6. Analyze any un-analyzed tracks (verify's `anlz` check counts them).
7. `deckctl run <drive> verify` → all green (shelf drives: dual-db shows
   the informational archive-tier note). Then `deckctl run <drive>
   checksum` once to seed bitrot tracking.

## Gotchas (each one cost hours — don't relearn them)

- **Shelf/archive drives: pdb drift is EXPECTED, never a failure.** The
  shelf hosts the master library itself (`PIONEER/Master/master.db` via
  Database Management). Its `PIONEER/rekordbox/` tree is a vestigial copy
  of whatever stick was migrated over — no player ever reads the shelf.
  Verify and preflight treat shelf-role drives accordingly (informational
  pass). Don't chase "Synchronize" on a shelf device entry: the Devices
  panel shows the legacy tree's old identity (e.g. `DJLIBRARYM` with a
  stale count) because that tree CARRIED the old stick's library, not
  because your data is wrong.
- **Missing File Manager builds its list once.** After out-of-band DB
  edits it shows stale counts — close and reopen the dialog, or restart
  rekordbox, before believing any number it shows.
- **Auto Relocate walks the whole volume per unresolved row** (hours on
  exFAT with thousands of dirs). Manual per-folder relocate or a DB path
  fix is minutes. Check USB port/link too — a bad hub turns USB3 into 2.0
  (`/bin/dd` a big file: expect ~60+ MB/s on spinning rust).
- **`//Volumes/OLDNAME/...` rows** mean the library predates a drive
  rename/migration — prefix-swap onto the new mount, then re-match.
- **fpcalc** prints `DURATION=`/`FINGERPRINT=` lines, not JSON. Use
  `fpcalc -length 0` for full-track fingerprints when comparing mixes.
- **exFAT + `shutil.move` of a whole directory can drop files.** Move
  per-file and MD5-verify at the destination, always.
- Keep quarantine/holding dirs OUT of `Contents/` (see Rules).

## Related

- `.claude/skills/rekordbox-usb-sync/SKILL.md` — the sync pipeline this
  repair feeds (fix library → re-export → sticks).
- `deckctl help verify` / `deckctl help dual-db` — check semantics.
- Ops history: `docs/usb-sync-log.md` (2026-09-09/10 entries — the 423-row
  saga that produced this skill).
