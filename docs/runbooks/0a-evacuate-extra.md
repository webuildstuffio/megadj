# 0a — Evacuate the dying SSD (Extra) — runbook

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
closed; do not run tools against a drive that is dropping off the bus.
(If it unmounts mid-copy: the rsync below is resumable — remount, re-run,
it picks up where it left off.)

## 1. Copy first, triage later (the whole point of 0a)

Destination: a healthy disk with ≥ the Extra volume's used space. If a
spare USB drive is the destination, use a NEW volume name (e.g. `EXTRA-EVAC`)
so CrateDeck never registers it as the same drive.

```sh
# —dry-run first, then run for real. Never --delete. Archive mode keeps
# everything (this is an evidence-preserving evacuation, not a sync).
rsync -av --progress /Volumes/Extra/ /Volumes/<DEST>/
```

If the destination is a folder on the Mac instead:

```sh
rsync -av --progress /Volumes/Extra/ ~/Documents/extra-evac/
```

## 2. Hash spot-check (usb_verify.py-style — do not skip)

The rsync exit code is NOT enough on a dying source. Verify what matters
by content hash, in this order:

```sh
# 1. the rekordbox libraries (the irreplaceable DBs)
shasum -a 256 /Volumes/Extra/PIONEER/* /Volumes/Extra/Contents/library/* 2>/dev/null
shasum -a 256 /Volumes/<DEST>/PIONEER/* /Volumes/<DEST>/Contents/library/* 2>/dev/null
# → compare by hand; every line must match

# 2. full-tree manifest diff (catches silent corruption anywhere)
cd /Volumes/Extra    && find . -type f -exec shasum -a 256 {} + | sort -k 2 > /tmp/extra-src.sha
cd /Volumes/<DEST>   && find . -type f -exec shasum -a 256 {} + | sort -k 2 > /tmp/extra-dst.sha
diff /tmp/extra-src.sha /tmp/extra-dst.sha && echo EVAC-VERIFIED
```

`EVAC-VERIFIED` on the full diff = done. Any mismatch: re-copy that file
(`rsync` again — it re-transfers mismatches), and note the file in the
sync log — a file that will not verify on a dying drive may be already gone.

## 3. Record the verdict

Append to `docs/usb-sync-log.md` (`## YYYY-MM-DD — Extra evacuated`,
what was copied where, verified/file counts, anything that failed to read).
Then close [issue #1](https://github.com/webuildstuffio/megadj/issues/1).

## 4. Only after EVAC-VERIFIED

Triage contents (what feeds §0c's orphan verdict). The dying drive itself
is then retired — wipe/repurpose only after the §0b cold backup exists.
