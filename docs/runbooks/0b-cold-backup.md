# 0b — Cold backup of the master library — runbook

The only protection against all local drives failing at once — the one
failure that ends the archive. B2 or R2 of `Contents/` + the archive DB
via rclone; read-only on the drives, versioned on the cloud side.

**Status:** 🟡 BLOCKED — one user decision remains: the cloud target. `rclone` is
installed (`/opt/homebrew/bin/rclone`) but has zero remotes configured
(`rclone listremotes` is empty). Pick one:

| option | setup | cost (123 GB class library) |
| --- | --- | --- |
| Backblaze B2 | `rclone config` → b2, app key from B2 console | ~$0.74/mo stored, pennies egress |
| Cloudflare R2 | `rclone config` → s3 type with R2 S3URL + access keys | $0.015/GB/mo ≈ $1.85/mo, zero egress |

Either works; R2's zero egress wins if a full restore is ever pulled.
Run `rclone config` interactively (needs the account keys), then:

## The backup

```sh
# 1. contents — versioned: changed/deleted files move to backup-dir,
#    the bucket always holds the current tree
rclone sync /Volumes/DJLIBRARYM/Contents/ <remote>:megadj-cold/contents \
  --backup-dir <remote>:megadj-cold-archive/$(date +%Y-%m-%d) \
  --transfers 8 --checkers 16 --fast-list -P

# 2. the archive DB (small; bump a dated copy each run — cheap history)
rclone copy ~/.local/state/megadj/archive.db \
  <remote>:megadj-cold/db/ --backup-dir <remote>:megadj-cold/db-archive/$(date +%Y-%m-%d)

# 3. the recovery kit (tiny, irreplaceable)
rclone copy ~/Documents/rekordbox-recovery/ <remote>:megadj-cold/recovery-kit/
```

Never `--delete` on the main path (the `--backup-dir` IS the versioning);
never write to a drive DB in place; the whole pass is read-only on
DJLIBRARYM.

## Verify (a backup that never restored is a hope, not a backup)

```sh
rclone check /Volumes/DJLIBRARYM/Contents/ <remote>:megadj-cold/contents --download
# spot-restore one random file to /tmp and shasum it against the source
```

## Schedule

One run right after each sync/rekordbox export session is enough while the
library churns; monthly once it settles. Add the run to
`docs/usb-sync-log.md` (`## YYYY-MM-DD — cold backup: N files, check clean`).

Close [issue #2](https://github.com/webuildstuffio/megadj/issues/2) after
the first verified `rclone check --download`.
