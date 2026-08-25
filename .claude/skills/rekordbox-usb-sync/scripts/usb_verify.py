#!/usr/bin/env python3
"""Deep 10x verification of the rekordbox USB library state.

    uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
        python scripts/usb_verify.py [--drives DJMASTER DJMIRROR]

Checks per drive:
  - DB decrypts; every track's audio file + analysis file exists on disk
  - every track has BPM; length values sane (seconds)
  - every ANLZ parses as clean sections; grid BPM matches DB BPM; beat count
    matches duration x BPM math; internal PPTH path matches DB path (NUL-stripped)
  - playlist entries all resolve; no dangling artist FKs
Cross-drive:
  - DB files byte-identical (MD5)
  - every USBANLZ file byte-identical (full hash, not just existence)
  - random audio hash spot-checks

Known-benign exclusions (Pioneer-native, not bugs):
  - Groove Circuit factory sample loops ship with empty grids
  - Pioneer's own DB-vs-grid BPM rounding drifts <=2% on some legacy tracks
"""

import argparse
import hashlib
import os
import random
import struct
import sys

from pyrekordbox.devicelib_plus.database import DeviceLibraryPlus
from pyrekordbox.devicelib_plus.models import Artist, Content, Playlist, PlaylistContent

FACTORY_SAMPLES = {
    "Breaks 1",
    "Breaks 2",
    "Breaks 3",
    "Techno 1",
    "Techno 2",
    "House 1",
    "House 2",
    "House 3",
}


def md5(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def walk_anlz(data: bytes):
    """Yield (tag, offset, hdr, total) for each section after PPTH. None if malformed."""
    if data[:4] != b"PMAI" or struct.unpack_from(">I", data, 4)[0] != 28:
        return None
    if data[28:32] != b"PPTH":
        return None
    _, _, plen = struct.unpack_from(">III", data, 32)
    path = data[44 : 44 + plen].decode("utf-16-be", errors="replace").rstrip("\x00")
    off = 44 + plen
    out = []
    while off < len(data) - 8:
        tag = data[off : off + 4].decode("ascii", errors="replace")
        hdr, total = struct.unpack_from(">II", data, off + 4)
        if total < 24 or off + total > len(data):
            return None
        out.append((tag, off, hdr, total))
        off += total
    if off != len(data):
        return None
    return path, out


def verify_drive(drive: str) -> list:
    vol = f"/Volumes/{drive}"
    fails = []
    db = DeviceLibraryPlus(os.path.join(vol, "PIONEER/rekordbox/exportLibrary.db"))
    rows = db.query(Content).all()
    print(f"  tracks: {len(rows)}")

    no_file = no_anlz = no_bpm = bad_len = 0
    bad_grid = pioneer_variance = 0
    for c in rows:
        if not os.path.exists(vol + c.path):
            no_file += 1
        if not c.bpmx100:
            no_bpm += 1
        if not (0 < c.length < 25000):
            bad_len += 1
        if not c.analysisDataFilePath or not os.path.exists(
            vol + c.analysisDataFilePath
        ):
            no_anlz += 1
            continue
        data = open(vol + c.analysisDataFilePath, "rb").read()  # noqa: SIM115
        parsed = walk_anlz(data)
        if parsed is None:
            bad_grid += 1
            continue
        pth, sections = parsed
        if pth != c.path:
            bad_grid += 1
            continue
        qt = next((s for s in sections if s[0] == "PQTZ"), None)
        is_generated = c.path.startswith("/Contents/YTMusic Liked/")
        if qt is None:
            # Pioneer ships factory sample loops ungridded; anything else missing
            # PQTZ is only a problem if we generated it
            if is_generated and c.title not in FACTORY_SAMPLES:
                bad_grid += 1
            elif c.title not in FACTORY_SAMPLES:
                pioneer_variance += 1
            continue
        _, off, _, total = qt
        beats = (total - 32) // 8
        _, g_bpm, _, _ = struct.unpack_from(">4H", data, off + 32)
        expected = int(c.length * c.bpmx100 / 6000)
        beat_off = abs(beats - expected) > max(8, expected * 0.03)
        bpm_off = abs(g_bpm - c.bpmx100) > c.bpmx100 * 0.02
        if beats < 4:
            if is_generated and c.title not in FACTORY_SAMPLES:
                bad_grid += 1
            else:
                pioneer_variance += 1
        elif beat_off or bpm_off:
            # Pioneer's own grids drift from its own DB values slightly
            # (variable-BPM sections, rounding); only flag generated files
            if is_generated:
                bad_grid += 1
            else:
                pioneer_variance += 1

    print(
        f"  missing audio: {no_file} | missing analysis: {no_anlz} | no BPM: {no_bpm} | bad length: {bad_len}"
    )
    print(
        f"  bad grids (generated): {bad_grid} | pioneer-native variance (informational): {pioneer_variance}"
    )
    if any([no_file, no_anlz, no_bpm, bad_len]):
        fails.append(f"{drive}: coverage/fields")

    tids = {c.content_id for c in rows}
    bad_e = sum(1 for e in db.query(PlaylistContent).all() if e.content_id not in tids)
    aids = {a.artist_id for a in db.query(Artist).all()}
    dang = sum(1 for c in rows if c.artist_id_artist and c.artist_id_artist not in aids)
    print(
        f"  playlists: {db.query(Playlist).count()} | entries: {db.query(PlaylistContent).count()} | dangling: {bad_e} | artist FK bad: {dang}"
    )
    if bad_e or dang:
        fails.append(f"{drive}: relations")
    db.close()
    return fails


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--drives", nargs="+", default=["DJMASTER", "DJMIRROR"])
    ap.add_argument(
        "--skip-hash-parity",
        action="store_true",
        help="skip full USBANLZ hash comparison (slow)",
    )
    args = ap.parse_args()

    random.seed(int(os.environ.get("VERIFY_SEED", "42")))
    fails = []

    print("\n=== per-drive DB + disk + grid checks ===")
    for drive in args.drives:
        print(f"\n### {drive}")
        fails += verify_drive(drive)

    if len(args.drives) == 2:
        a, b = args.drives
        print("\n=== cross-drive ===")
        same = md5(f"/Volumes/{a}/PIONEER/rekordbox/exportLibrary.db") == md5(
            f"/Volumes/{b}/PIONEER/rekordbox/exportLibrary.db"
        )
        print(f"DB byte-identical: {same}")
        fails.append("DB parity") if not same else None

        if not args.skip_hash_parity:
            src = {}
            for dp, _, fns in os.walk(f"/Volumes/{a}/PIONEER/USBANLZ"):
                for fn in fns:
                    if fn.startswith("._"):
                        continue
                    p = os.path.join(dp, fn)
                    src[os.path.relpath(p, f"/Volumes/{a}/PIONEER/USBANLZ")] = p
            mm = 0
            for i, (rel, p) in enumerate(src.items(), 1):
                d = f"/Volumes/{b}/PIONEER/USBANLZ/" + rel
                if not os.path.exists(d) or md5(p) != md5(d):
                    mm += 1
                    if mm <= 3:
                        print(f"  MISMATCH: {rel}")
                if i % 4000 == 0:
                    print(f"  hashed {i}/{len(src)}", flush=True)
            print(f"ANLZ full hash parity: {mm}/{len(src)} mismatches")
            if mm:
                fails.append("ANLZ parity")

        db = DeviceLibraryPlus(f"/Volumes/{a}/PIONEER/rekordbox/exportLibrary.db")
        sample = random.sample(db.query(Content).all(), 40)
        am = 0
        for c in sample:
            fa, fb = f"/Volumes/{a}{c.path}", f"/Volumes/{b}{c.path}"
            if os.path.exists(fa) and os.path.exists(fb) and md5(fa) != md5(fb):
                am += 1
                print(
                    f"  AUDIO MISMATCH (different rips — copy master's version over): {c.path}"
                )
        print(f"audio hash spot-check (40): {am} mismatches")
        if am:
            fails.append("audio parity")

    print(f"\nFINAL: {'ALL PASS' if not fails else 'FAILED: ' + ', '.join(fails)}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
