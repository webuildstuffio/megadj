# Playing USB export boundary

**Status:** ✅ CURRENT — SHELF1 preparation is agent-operated; export to the
playing USB is user-managed.

This page owns the operational boundary between the shelf collection and the
playing USB. Historical master/mirror tooling does not override it.

## Current topology

| Surface                     | Role                                                                    | Write owner                                                           |
| --------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| SHELF1                      | Archive master, collection source of truth, intake source for rekordbox | Repository commands and the user, with rekordbox closed for DB writes |
| Playing USB (`flip-master`) | Performance media staged from rekordbox                                 | User only                                                             |
| `archive.db`                | Pipeline and analysis ledger, not a collection copy                     | megadj commands                                                       |

Agents never sync, export, mirror, repair, or write playlists/databases to the
playing USB. They may run an explicitly read-only verification when requested.
Configured volume roles win over old example names such as `DJMASTER` and
`DJMIRROR`.

## Intake-to-export handoff

1. `megadj shelf-sync` copies archive additions to SHELF1 additively and
   verifies them by MD5.
2. The user imports the dated batch into rekordbox from
   `/Volumes/SHELF1/Contents/...`, never from local staging.
3. Rekordbox analyzes the tracks and the user exports them to the playing USB.
4. CrateDeck may then verify the mounted USB through read-only checks.

The playlist convention is one `YYYY-MM-DD intake` playlist under
`DJ-Imports`. The database playlist rows and `masterPlaylists6.xml` are twins:
write both or neither through the repository seam.

## Archive intake from a USB

Use `megadj shelf-archive` to add material from a USB to SHELF1. It ignores
the device database tree, walks `Contents/` and `PIONEER REC/`, filters junk,
and MD5-verifies individual copies. The shelf is a superset: divergent
same-name files are preserved rather than overwritten.

For raw ExFAT evacuation work, use foreground, resumable per-directory
tar-pipes with file-count checkpoints. Never use a whole-volume rsync. See
[the Extra evacuation runbook](runbooks/0a-evacuate-extra.md).

The agent-facing procedure is
[`rekordbox-usb-sync`](../.claude/skills/rekordbox-usb-sync/SKILL.md). Its
remaining historical scripts are reference material, not authorization to
write a playing USB.
