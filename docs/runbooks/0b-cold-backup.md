# 0b — Cold backup of the master library — runbook

**Status:** 🗄️ SHELVED — the backup decision is RECORDED (owner call,
Sep 19; issue #2 closed NOT_PLANNED Sep 20): the shelf IS the backup —
`shelf-sync` to SHELF1 gives every track two physical copies. No cloud
backup infra exists or runs, and none is planned. This procedure is
retained as the ready-to-execute plan if that decision is ever revisited
(a foreign-copy hazard like ransomware or a double-drive failure would
be the reason to).

The only protection against all local drives failing at once — the one
failure that ends the archive. B2 or R2 of `Contents/` + the archive DB
via rclone; read-only on the drives, versioned on the cloud side.

| option        | setup                                                 | current billing distinction                                                                   |
| ------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Backblaze B2  | `rclone config` → b2, app key from B2 console         | Storage is billed; free egress is capped at 3× average monthly storage, then egress is billed |
| Cloudflare R2 | `rclone config` → s3 type with R2 S3URL + access keys | Standard storage is $0.015/GB-month; Internet egress is free                                  |

Either can satisfy the backup. Do not infer a winner from one hypothetical
restore: verify current storage, request, and egress pricing against the
expected retention and restore pattern. Run `rclone config` interactively
(needs the account keys), then:

## The backup

```sh
# 1. contents — versioned: changed/deleted files move to backup-dir,
#    the bucket always holds the current tree
rclone sync /Volumes/SHELF1/Contents/ <remote>:megadj-cold/contents \
  --backup-dir <remote>:megadj-cold-archive/$(date +%Y-%m-%d) \
  --transfers 8 --checkers 16 --fast-list -P

# 2. the archive DB (small; bump a dated copy each run — cheap history)
rclone copy ~/.local/state/megadj/archive.db \
  <remote>:megadj-cold/db/ --backup-dir <remote>:megadj-cold/db-archive/$(date +%Y-%m-%d)

# 3. the recovery kit (tiny, irreplaceable)
rclone copy ~/Documents/rekordbox-recovery/ <remote>:megadj-cold/recovery-kit/
```

Never `--delete` on the main path (the `--backup-dir` IS the versioning);
never write to a drive DB in place; the whole pass is read-only on SHELF1.

## Verify (a backup that never restored is a hope, not a backup)

```sh
rclone check /Volumes/SHELF1/Contents/ <remote>:megadj-cold/contents --download
# spot-restore one random file to /tmp and shasum it against the source
```

## Schedule

One run right after each sync/rekordbox export session is enough while the
library churns; monthly once it settles. Add the run to
`docs/usb-sync-log.md` (`## YYYY-MM-DD — cold backup: N files, check clean`).

[Issue #2](https://github.com/webuildstuffio/megadj/issues/2) is CLOSED
(NOT_PLANNED, Sep 20) — the trigger condition for reopening is a
recorded owner decision, not this file.
