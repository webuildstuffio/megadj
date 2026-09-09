# 0c — Orphan-drive verdict (BACKUP2) — runbook

BACKUP2 is the old backup drive whose DB (2025-08-14) saved the library
during the March 2025 NEVERMISSMI corruption. Its 1,910 unique files were
already copied to Extra (dying SSD) during the Aug recovery
(`backup2_only_paths.txt` in `~/Documents/rekordbox-recovery/`). One session
on a day BACKUP2 is plugged in decides: adopt or declare dead. Order matters:
**before 0b**, so the cloud backup captures the decision, not the ambiguity.

## 0. Prerequisite

0a done: Extra evacuated and EVAC-VERIFIED (its copy of the BACKUP2-only
files is the safety net while we decide).

## 1. Mount and inventory

```sh
ls /Volumes/   # confirm "BACKUP2"
# unique-to-BACKUP2 list is already known:
wc -l ~/Documents/rekordbox-recovery/backup2_only_paths.txt
```

## 2. Adopt — if any of those 1,910 files are still wanted

`megadj adopt` matches files into pending archive DB tracks by normalized
title; `megadj ingest` takes a folder and moves wins into the archive
(genre subfolders), quarantining dupes. MusicBrainz fill + artwork are
part of ingest.

```sh
# the copy on Extra (stable bus) rather than BACKUP2 itself — the dying/
# old drive stays read-only during the whole operation
bun src/cli.ts adopt --json            # match what's already named right
bun src/cli.ts ingest <folder-with-the-1910> --json
# re-run audit after:
bun src/cli.ts audit --json
```

Files that match nothing pending and fail ingest scoring stay where they
are — they become "declared dead" below.

## 3. Declare dead — everything not adopted

Append to `docs/usb-sync-log.md`: `## YYYY-MM-DD — BACKUP2 verdict` —
adopted count (with the ingest summary JSON pasted), declared-dead count,
and the explicit line "BACKUP2 is retired; nothing unique remains." Only
that sentence in the append-only log makes the death official.

## 4. Close and retire

Close [issue #3](https://github.com/webuildstuffio/megadj/issues/3) with
the adopted/dead counts. BACKUP2 then graduates from "keep until verdict"
to ordinary spare (wipe only after 0b's cold backup exists and verifies).
