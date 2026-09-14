---
name: rekordbox-usb-sync
description: >-
  Prepare and verify the SHELF1 archive for a user-managed rekordbox USB
  export. Use when asked about USB sync, drive export, or rekordbox device
  readiness. Agents never write, mirror, sync, or export to the playing USB.
---

# Rekordbox USB Sync

This skill is a safety boundary and handoff guide. The playing USB
(`flip-master`, regardless of its mounted volume name) is user-managed.
Agents may inspect it read-only when explicitly needed, but must never write
its files, databases, playlists, analysis data, or sidecars.

## Ownership

| Surface                               | Owner  | Agent access                                                            |
| ------------------------------------- | ------ | ----------------------------------------------------------------------- |
| Shelf archive and collection DB       | SHELF1 | Normal repository commands, subject to the rekordbox interlock          |
| Playing USB and its Pioneer databases | User   | Read-only verification only; no sync, export, mirror, delete, or repair |
| Local scratch copies                  | Agent  | Allowed when created from SHELF1 and kept off the playing USB           |

Historical scripts under this skill can describe or verify old master/mirror
layouts, but they are **not authorized write paths**. Do not run `usb_sync.py`,
`usb_mirror.py`, `--rekordbox-only`, `--audio-parity`, or any command that
deploys a database or file tree to a mounted playing USB.

## Safe intake and handoff

1. Confirm the configured shelf volume (normally `SHELF1`) is mounted.
2. Quit rekordbox before any SHELF1 collection-DB mutation.
3. Run `megadj shelf-sync` to copy archive additions to the shelf. The command
   is additive and MD5-verifies its writes.
4. Open rekordbox and import the dated batch from
   `/Volumes/SHELF1/Contents/...`, never from local staging.
5. Stop. Tell the user the shelf batch is ready for their own rekordbox export
   to the playing USB.

The required playlist shape is one dated `YYYY-MM-DD intake` playlist under
`DJ-Imports`. Playlist rows and `masterPlaylists6.xml` are twins and must be
written together through the repository seam; never hand-edit either copy.

## Read-only verification

When the user asks for verification, prefer CrateDeck/deckctl reads. Report
unknown checks as unknown, not healthy. A mounted playing USB may be scanned,
hashed, or compared only when the operation is demonstrably read-only.

Do not infer that “mirror”, “master”, “byte-identical”, or an old default
volume name grants write authority. The current invariant is simpler:

- SHELF1 is the archive master and the only removable volume agents may
  mutate.
- The playing USB is staged by the user.
- Superset archive coverage is valid; name equality is not a sync contract.

## Pulling material from a USB

For additive intake into SHELF1, use `megadj shelf-archive`. It walks
`Contents/` and `PIONEER REC/` but never `PIONEER/`, filters AppleDouble junk,
MD5-verifies each copy, and preserves divergent same-name recordings. Use
`--deep` only when byte comparison is required and `--trashes --into F` for a
deliberate flat trash intake.

Run long ExFAT work in the foreground and in resumable, per-directory chunks.
Never use whole-volume rsync: macOS ExFAT can wedge and background processes
can be reaped.

## Hard stops

- rekordbox is running during a proposed SHELF1 database write;
- the target resolves to the playing USB rather than SHELF1;
- a command would delete source files, device sidecars, WAL/SHM files, or a
  Pioneer database;
- verification lacks a delayed re-read, row/file existence checks, or hashes
  appropriate to the operation.

On any hard stop, leave the drive untouched and return an executable,
user-owned next step.
