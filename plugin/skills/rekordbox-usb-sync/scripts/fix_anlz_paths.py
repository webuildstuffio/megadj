#!/usr/bin/env python3
"""Relocate the 294 generated ANLZ files to hash-computed USBANLZ folders and
update the OneLibrary DB to match — players ignore the DB's analysisDataFilePath
and compute the folder from the audio path.

Two modes:
  --fix      rewrite files with Pioneer-spec fixes and place at hash paths,
             update DB analysisDataFilePath (in the /tmp working copy)
  --check    report-only: what's where, what the hardware expects

Run against the /tmp working DB, never the drive's live file.
"""
import argparse
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from anlz_paths import compute_anlz_folder, folder_key, next_free_suffix


def walk_sections(data: bytes):
    if data[:4] != b"PMAI":
        return None
    out, off = [], 28
    while off < len(data) - 8:
        tag = data[off : off + 4]
        hdr, total = struct.unpack_from(">II", data, off + 4)
        if total < 12:
            return None
        out.append((tag.decode("ascii", "replace"), off, hdr, total))
        off += total
    return out if off == len(data) else None


def get_path_of_dat(data: bytes):
    off = data.find(b"PPTH", 4)
    if off < 0:
        return None
    _, _, plen = struct.unpack_from(">III", data, off + 4)
    raw = data[off + 16 : off + 16 + plen]
    return raw.decode("utf-16-be", errors="replace").rstrip("\x00")


def fix_dat_bytes(data: bytes, verbose: bool = True) -> bytes:
    """Rewrite a generated ANLZ0000.DAT with Pioneer-spec corrections."""
    path = get_path_of_dat(data)
    if path is None:
        raise RuntimeError("no PPTH section")
    sections = walk_sections(data)
    if sections is None:
        raise RuntimeError("malformed section walk")

    parts = []
    for tag, off, hdr, total in sections:
        raw = data[off : off + total]
        if tag == "PPTH":
            p = (path + "\x00").encode("utf-16-be")
            parts.append(b"PPTH" + struct.pack(">III", 16, 16 + len(p), len(p)) + p)
        elif tag == "PWAV":
            cnt = struct.unpack_from(">I", raw, 12)[0]
            payload = raw[20 : 20 + cnt]
            payload = (payload + b"\x00" * 400)[:400]
            parts.append(b"PWAV" + struct.pack(">IIII", 20, 20 + len(payload), 400, 0x10000) + payload)
        elif tag == "PCOB":
            parts.append(b"PCOB" + struct.pack(">IIIII", 24, 24, 0, 0, 0xFFFFFFFF))
        else:
            parts.append(raw)
    body = b"".join(parts)
    dat = b"PMAI" + struct.pack(">IIIIII", 28, 28 + len(body), 1, 0x10000, 0x10000, 0) + body

    # self-checks: exact walk + PMAI size + terminator + entry counts
    secs = walk_sections(dat)
    assert secs is not None and sum(s[3] for s in secs) + 28 == len(dat)
    assert struct.unpack_from(">I", dat, 8)[0] == len(dat)
    pth = get_path_of_dat(dat)
    assert pth == path and dat[dat.find(b"PPTH", 4):].find(b"\x00\x00") >= 0
    for tag, off, hdr, total in secs:
        if tag == "PWAV":
            assert struct.unpack_from(">I", dat, off + 12)[0] == 400
    return dat


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--drive", default="/Volumes/DJMIRROR")
    ap.add_argument("--db", default="/tmp/usb-sync/nm_current.db")
    ap.add_argument("--folder", default="/Contents/YTMusic Liked")
    ap.add_argument("--fix", action="store_true")
    ap.add_argument("--tmp-out", default="/tmp/usb-sync/fixed_anlz")
    args = ap.parse_args()

    from pyrekordbox.devicelib_plus.database import DeviceLibraryPlus
    from pyrekordbox.devicelib_plus.models import Content

    db = DeviceLibraryPlus(args.db)
    rows = [c for c in db.query(Content).all() if c.path.startswith(args.folder + "/")]
    print(f"{len(rows)} YTMusic tracks in DB")

    existing_hash_folders = set()
    usb_root = os.path.join(args.drive, "PIONEER/USBANLZ")
    for name in os.listdir(usb_root):
        if name.startswith("P") and len(name) == 4 and name[1:].isalnum():
            existing_hash_folders.add(name)

    coll_fixed = 0
    plan = []
    for c in rows:
        p, hr = compute_anlz_folder(c.path)
        target = os.path.join(usb_root, f"P{p:03X}", f"{hr:08X}")
        src = args.drive + c.analysisDataFilePath
        plan.append((c, folder_key(p, hr), target, src))

    collisions = []
    used_folders = set()
    # occupy all folders existing tracks hash to (originals resolve exactly)
    for c in db.query(Content).all():
        if c.path.startswith(args.folder + "/"):
            continue
        if c.analysisDataFilePath:
            parts = c.analysisDataFilePath.split("/")
            used_folders.add("/".join(parts[3:5]))
    free_plan = []
    for c, hash_dir, target, src in plan:
        if os.path.exists(os.path.join(target, "ANLZ0000.DAT")) or hash_dir in used_folders:
            collisions.append((c.path, hash_dir))
            # open addressing: bump hash until free (players re-analyze on miss)
            p0, hr0 = compute_anlz_folder(c.path)
            hr = next_free_suffix(p0, hr0, used_folders)
            bumped = folder_key(p0, hr)
            free_plan.append((c, bumped, hr, hr0))
            used_folders.add(bumped)
        else:
            used_folders.add(hash_dir)
    print(f"hash collisions resolved by next-free-slot: {len(collisions)}")
    for path, hd in collisions[:5]:
        print(f"  {hd} <- {path[:60]}")
    for c, bumped, hr, hr0 in free_plan[:5]:
        print(f"  bumped {hr0:08X} -> {hr:08X} for {c.fileName[:50]}")

    if not args.fix:
        print("\nCHECK ONLY — run with --fix to apply")
        return 0

    final = []
    bump_map = {c.content_id: hd for c, hd, hr, hr0 in free_plan}
    for c, hash_dir, target, src in plan:
        final_dir = bump_map.get(c.content_id, hash_dir)
        final.append((c, final_dir, src))

    os.makedirs(args.tmp_out, exist_ok=True)
    for c, final_dir, src in final:
        with open(src, "rb") as f:
            data = f.read()
        fixed = fix_dat_bytes(data)
        out = os.path.join(args.tmp_out, final_dir.replace("/", os.sep))
        os.makedirs(out, exist_ok=True)
        outpath = os.path.join(out, "ANLZ0000.DAT")
        assert not os.path.exists(outpath), f"duplicate output {outpath}"
        with open(outpath, "wb") as f:
            f.write(fixed)
        c.analysisDataFilePath = f"/PIONEER/USBANLZ/{final_dir}/ANLZ0000.DAT"
        coll_fixed += 1
    db.commit()
    print(f"rewrote+relocated {coll_fixed} files into {args.tmp_out}")
    print("DB updated (working copy). Next: deploy DB + files to drive.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
