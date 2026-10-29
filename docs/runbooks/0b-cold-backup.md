# 0b — Cold backup of the master library — runbook

**Status:** ✅ LOCAL COLD BACKUP ACTIVE (Oct 29, 2026) — SHELF1 migrated
from Toshiba 4 TB ExFAT HDD to Fikwok 2 TB NVMe (APFS). The old HDD is
now `SHELF1-COLD`, stored unpowered and synced monthly via rsync.

Cloud backup remains SHELVED (owner call, Sep 19; issue #2 closed
NOT_PLANNED Sep 20). The local cold backup gives two physical copies.

## Local cold backup — HDD (SHELF1-COLD)

The old Toshiba 4 TB ExFAT HDD was the shelf master until Oct 29, 2026.
After the NVMe migration it holds a verified 1:1 copy of the archive.
Its permanent label is `SHELF1-COLD` (renamed from `SHELF1` on Oct 29).

### Pre-flight (EVERY time you plug in the cold backup)

```sh
# 1. BEFORE plugging in: quit Rekordbox (it will see the drive mount)
# 2. Plug in the Toshiba HDD
# 3. Verify its label is SHELF1-COLD — NOT SHELF1
diskutil info /Volumes/SHELF1-COLD | grep "Volume Name"
# Expected: "Volume Name: SHELF1-COLD"
# If it mounted as "SHELF1 1" or "SHELF1 2" → name collision!
# Fix: diskutil rename diskXs2 "SHELF1-COLD"
```

**Why this matters:** two drives named `SHELF1` simultaneously causes
macOS to mount the second as `SHELF1 1`, and Rekordbox gets confused
about which drive owns the library paths (Oct 29 2026 incident).

### Sync

```sh
# Monthly incremental sync — NVMe → HDD
rsync -avH --delete --exclude='._*' --exclude='.Trashes' \
  /Volumes/SHELF1/ /Volumes/SHELF1-COLD/

# Spot-check: 10 random files, MD5 comparison
find /Volumes/SHELF1/Contents -type f | sort -R | head -10 | while read src; do
  rel="${src#/Volumes/SHELF1/}"
  echo "$(md5 -q "$src") $(md5 -q "/Volumes/SHELF1-COLD/$rel") $rel"
done

# Eject when done — never leave it plugged in
diskutil eject /Volumes/SHELF1-COLD
```

Schedule: monthly, or after any major import batch. Log each run in
`docs/usb-sync-log.md`.

---

## Cloud cold backup (shelved — retained as ready-to-execute plan)

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
