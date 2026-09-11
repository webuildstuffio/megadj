---
name: shelf-intake
description: >-
  Archive any drive (USB stick, HDD) into the shelf master (SHELF1) with
  full verification and a DB-recorded verdict: scan, classify, copy
  additively, prove 100% coverage. Use when a new/stray drive is plugged in
  and asked to "get everything onto the shelf/archive", when asked whether a
  drive's content is fully archived, or for the shelf dedupe pass afterward.
---

# Shelf Intake — drive → shelf archive sweep

Every drive that ever touched a DJ setup ends up on the shelf master
(`library.shelf_drive`, default `SHELF1`). The rule: **the shelf is a strict
superset of every drive, byte-verified, and nothing on it is ever
overwritten or deleted.** This skill is the loop for one drive (or a batch)
— it is one command plus verification, not a hand-rolled script.

## The one command

```bash
cd ~/github/megadj

# 1. Peek (cheap, fast, size-only):
bun src/cli.ts shelf-archive VOLUME --dry-run --json

# 2. The real sweep (MD5-verifies every copy):
bun src/cli.ts shelf-archive VOLUME --json

# 3. With trash rescue + deep same-size checking (old/neglected drives):
bun src/cli.ts shelf-archive VOLUME --deep --trashes --into "DJ Sets & Mixes" --json
```

`VOLUME` is the volume name (`BACKUP2`) or mount path; `--json` prints one
verdict object and exits 1 if anything failed. Multiple volumes in one run:
`shelf-archive A B C` (unmounted ones are skipped harmlessly).

## What the command handles (so you never hand-roll it)

| Trap                                                        | Handled how                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| AppleDouble/`.DS_Store`/fseventsd junk counted as "missing" | filtered before diffing (one stick: 1,446 of 1,449 false-missing were junk)                       |
| exFAT case-insensitivity                                    | NFC + casefold name keys                                                                          |
| Same name, different rip                                    | drive version preserved as `<stem> [<volume>]<ext>` beside the shelf original — never overwrite   |
| Same size, different bytes (tag rewrites, bitrot)           | `--deep` MD5s every same-size pair (one 2019 stick: 291 files)                                    |
| Deleted mixes in `.Trashes`                                 | `--trashes --into F` lands them flat in `Contents/F/`                                             |
| Stick device DBs (`PIONEER/`)                               | NEVER walked — copying a stick's export.pdb toward the shelf's DB tree destroys libraries         |
| Silent partial copies                                       | post-copy MD5 verify; failure = `failed` count + exit 1                                           |
| Where the record lives                                      | every sweep auto-inserts into the archive DB `shelf_sweeps` table (verdict, counters, timestamps) |

## The verification step (mandatory after any real sweep)

```bash
# Re-run dry: everything must read covered/preserved, copied must be 0.
bun src/cli.ts shelf-archive VOLUME --deep --dry-run --json
```

The dry-run-after-real-run pattern is the proof: the second pass
reclassifies every file with the same logic that did the copying. Expect
`copied: 0` and `stillMissing: []`. For very old drives, also spot-check
10 random files with `md5` source-vs-shelf by hand.

**Reading the verdict:**

- `files` — real files on the drive (junk already excluded)
- `coveredExact` — shelf already has this exact path+size
- `preserved` — drive's divergent rip saved as a `[volume]` twin
- `copied` — fresh files that landed (bytes on the shelf)
- `failed` — anything > 0 means NOT done; the file is in `stillMissing`
- `ok: true` + `copied: 0` on the re-run = **100% coverage**

## The DB record (queryable state, not markdown)

Every sweep writes a row to `shelf_sweeps` in the archive DB
(`~/.local/state/megadj/archive.db`):

```bash
bun src/cli.ts shelf-sweeps           # latest verdict per drive, one line each
bun src/cli.ts shelf-sweeps --json    # full history for agents/UI
sqlite3 ~/.local/state/megadj/archive.db \
  "SELECT drive, verdict, files_seen, copied, datetime(started_at) FROM shelf_sweeps ORDER BY id DESC LIMIT 5"
```

The human log (`docs/usb-sync-log.md`) gets the story; the DB gets the
state. Both, always — markdown for why, DB for what.

## Post-archive hygiene scan (mandatory after a real sweep)

Once the archive sweep proves 100% coverage, run the hygiene scanner to
surface byte-twins, acoustic-twins, and folder-variants that may have
landed alongside the new files:

```bash
# 1. Dry-run scan — populates the findings ledger, changes nothing:
bun src/cli.ts shelf-hygiene --json

# 2. Review the findings (CrateDeck Hygiene tab or --json output).
#    NEVER bulk-apply unreviewed — each finding needs a human eye.

# 3. Apply confirmed fixes only (one by one or in a confirmed batch):
bun src/cli.ts shelf-hygiene --apply --yes --json
```

The discipline is the same two-step pattern as the archive sweep itself:
**dry-run → review → apply**. Findings live in the archive DB (the SSOT
every surface reads — CrateDeck Hygiene tab, `deckctl`, the MCP server).
See `.claude/skills/` for the full hygiene skill flow and
`docs/agent-playbook.md` for the war stories behind the byte-twin and
acoustic-twin detection.

## After every sweep — the follow-ups

1. **Log it**: one dated entry in `docs/usb-sync-log.md` (drive, census,
   verdict, surprises).
2. **Variant twins**: every `[volume]`-suffixed file is a dedupe candidate.
   They wait for the human-gated dedupe pass (fingerprint/quality compare,
   never delete without explicit OK).
3. **Old device DBs**: a stick whose `PIONEER/rekordbox` is older than the
   shelf's live DB has nothing to offer — say so in the log and move on.
4. **Empty sticks count**: sweep an empty stick anyway (it records a
   `complete` verdict with 0 files — the negative result is the point).

## Batch pattern (multiple drives in one session)

```bash
ls /Volumes/                                   # what's mounted?
# Survey each: file count, size, PIONEER DB dates
for v in A B C; do echo "== $v"; du -sk "/Volumes/$v"; ls "/Volumes/$v"; done
bun src/cli.ts shelf-archive A B C --dry-run --json     # all verdicts, no writes
bun src/cli.ts shelf-archive A B C --json              # the real thing
bun src/cli.ts shelf-archive A B C --deep --dry-run --json  # prove
```

Long drives (100+ GB) can outlive one tool call — run the command in the
background and poll, or run per-volume. The sweep is resumable by nature
(already-copied files classify as covered on the next run).
