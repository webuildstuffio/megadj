# 0a — Evacuate the dying SSD (Extra) — runbook

**Status:** 🟡 BLOCKED — waiting on the Extra volume to mount; execute top
to bottom when it is plugged in.

The SSD ("Extra") is dying (STATUS-FINAL.md: "evacuate when convenient").
It is NOT mounted right now. This runbook is the whole job — when the drive
is plugged in, execute top to bottom, then close issue #1.

**Status:** 🟡 BLOCKED — the Extra volume is not currently mounted.

## 0. When the drive mounts

```sh
ls /Volumes/            # confirm the volume name below is "Extra"
diskutil info /Volumes/Extra | grep -E "SMART|Mounted|File System"
```

If it does not mount, or mounts read-only, STOP — the copy window may be
closed; do not run tools against a drive that is dropping off the bus. If it
unmounts mid-copy, remount and resume only the interrupted top-level item.

## 1. Copy first, triage later (the whole point of 0a)

Destination: a healthy disk with ≥ the Extra volume's used space. If a
spare USB drive is the destination, use a NEW volume name (e.g. `EXTRA-EVAC`)
so CrateDeck never registers it as the same drive.

Do not use whole-volume rsync on ExFAT; it can wedge and make the shrinking
copy window worse. Create a dedicated destination, then copy one directory
under `Contents/` at a time with a foreground tar-pipe. Record source and
destination file counts after every item so an interrupted run resumes at
that item rather than restarting the entire music tree.

```sh
mkdir -p /Volumes/EXTRA-EVAC
mkdir -p /Volumes/EXTRA-EVAC/Contents

# Inventory the immediate directories, then repeat the three commands below
# for one exact name at a time (the example name is illustrative).
fd --hidden --no-ignore --max-depth 1 --min-depth 1 -t d . /Volumes/Extra/Contents

fd --hidden --no-ignore -t f . "/Volumes/Extra/Contents/Artist Folder" | wc -l
(cd /Volumes/Extra/Contents && tar -cf - "Artist Folder") | \
  (cd /Volumes/EXTRA-EVAC/Contents && tar -xpf -)
fd --hidden --no-ignore -t f . "/Volumes/EXTRA-EVAC/Contents/Artist Folder" | wc -l
```

Repeat that exact-name pattern for every immediate directory under
`Contents/`. Copy loose files under `Contents/` and other top-level volume
items individually with `cp -p`; for another directory tree, use the same
one-directory tar-pipe pattern. Never combine the volume into one job. Keep
the process attached to the foreground; background jobs may be reaped.

## 2. Hash spot-check (usb_verify.py-style — do not skip)

The copy exit code and file counts are NOT enough on a dying source. Verify what matters
by content hash, in this order:

```sh
# Full-tree manifests catch silent corruption anywhere. Run each command from
# the volume root so both manifests contain the same relative path names.
cd /Volumes/Extra && fd --hidden --no-ignore -0 -t f . . | \
  sort -z | xargs -0 shasum -a 256 > /tmp/extra-src.sha
cd /Volumes/EXTRA-EVAC && fd --hidden --no-ignore -0 -t f . . | \
  sort -z | xargs -0 shasum -a 256 > /tmp/extra-dst.sha
diff /tmp/extra-src.sha /tmp/extra-dst.sha && echo EVAC-VERIFIED
```

`EVAC-VERIFIED` on the full diff = done. Any mismatch: re-copy that file
individually, re-hash it, and note it in the sync log. A file that will not
verify on a dying drive may already be gone.

## 3. Record the verdict

Append to `docs/usb-sync-log.md` (`## YYYY-MM-DD — Extra evacuated`,
what was copied where, verified/file counts, anything that failed to read).
Then close [issue #1](https://github.com/webuildstuffio/megadj/issues/1).

## 4. Only after EVAC-VERIFIED

Triage contents (what feeds §0c's orphan verdict). The dying drive itself
is then retired — wipe/repurpose only after the §0b cold backup exists
(0b is SHELVED — owner decision #2, the shelf is the backup; revisit
this gate with the owner before any wipe).
