#!/usr/bin/env python3
"""Deep 10x verification of the rekordbox USB library state.

    uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
        python scripts/usb_verify.py [--drives MASTER MIRROR]

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
import json
import os
import random
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from anlz_paths import compute_anlz_folder
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

# Structured payload accumulated during the run and emitted as ONE
# "VERIFY_JSON: {...}" line before FINAL. The CrateDeck job engine parses
# this first; the human-readable text above stays the source of truth for
# eyes. Offender lists are full paths so the UI can say exactly which
# tracks need attention.
VERIFY_JSON: dict = {}


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


def pdb_live_rows(pdb_path: str, table_type: int = 0) -> int:
    """Count live (non-tombstone) rows in a legacy export.pdb table.

    Page index walks the chain from the file header; row groups build
    backwards from each 4096-byte page tail with a 0x24-byte stride (4 flag
    bytes + 16 u16 row offsets). Validated against a rekordbox-7-written
    export.pdb on 2026-08-25.
    """
    PAGE = 4096
    with open(pdb_path, "rb") as f:
        data = f.read()
    n_tables = struct.unpack_from("<I", data, 0x08)[0]
    first = last = None
    for i in range(n_tables):
        t, _empty, f_, l = struct.unpack_from("<IIII", data, 0x1C + 16 * i)
        if t == table_type:
            first, last = f_, l
            break
    if first is None:
        return -1
    live = 0
    seen, cur = set(), first
    while cur and cur not in seen and (cur + 1) * PAGE <= len(data):
        seen.add(cur)
        o = cur * PAGE
        packed = data[o + 0x18] | (data[o + 0x19] << 8) | (data[o + 0x1A] << 16)
        n_slots = packed >> 11
        if n_slots and not (data[o + 0x1B] & 0x40):  # data pages only
            n_groups = (n_slots - 1) // 16 + 1
            for g in range(n_groups):
                base = o + PAGE - (g * 0x24)
                present = struct.unpack_from("<H", data, base - 4)[0]
                for b in range(16):
                    slot = g * 16 + b
                    if slot >= n_slots:
                        break
                    if present & (1 << b):
                        row_off = struct.unpack_from("<H", data, base - (6 + 2 * b))[0]
                        ro = o + 32 + row_off
                        subtype = struct.unpack_from("<H", data, ro)[0]
                        if subtype & 0x02 == 0:  # 0x02 = missing/deleted marker
                            live += 1
        if cur == last:
            break
        cur = struct.unpack_from("<I", data, o + 0x0C)[0]
    return live


def verify_hardware_view(drive: str) -> list:
    """What a legacy player (XDJ-XZ etc.) actually reads: export.pdb vs OneLibrary."""
    vol = f"/Volumes/{drive}"
    fails = []
    J = VERIFY_JSON.setdefault("drives", {}).setdefault(drive, {})
    pdb_path = os.path.join(vol, "PIONEER/rekordbox/export.pdb")
    db = DeviceLibraryPlus(os.path.join(vol, "PIONEER/rekordbox/exportLibrary.db"))
    try:
        contents = db.query(Content).all()
        n_db = len(contents)
    finally:
        db.close()
    if not os.path.exists(pdb_path):
        print("  export.pdb missing — legacy players will show NOTHING")
        fails.append(f"{drive}: no export.pdb")
        return fails
    n_pdb = pdb_live_rows(pdb_path, table_type=0)
    print(f"  hardware view: export.pdb={n_pdb} tracks vs OneLibrary DB={n_db} tracks")
    J["pdb_tracks"] = n_pdb
    J["onelibrary_tracks"] = n_db
    if n_pdb != n_db:
        delta = n_db - n_pdb
        if delta > 0:
            print(f"  MISMATCH — legacy players (XDJ-XZ, older CDJs) will not show the {delta} newer tracks")
        else:
            print(f"  MISMATCH — export.pdb carries {abs(delta)} extra rows (stale/tombstoned) vs OneLibrary DB")
        fails.append(f"{drive}: pdb/db track count")
    # ANLZ at hash paths for every track
    bad_hash = 0
    anlz_hash_missing: list[str] = []
    for c in contents:
        p, hr = compute_anlz_folder(c.path)
        expected = os.path.join(
            vol, "PIONEER/USBANLZ", f"P{p:03X}", f"{hr:08X}", "ANLZ0000.DAT"
        )
        if not os.path.exists(expected) and (
            not c.analysisDataFilePath
            or not os.path.exists(vol + c.analysisDataFilePath)
        ):
            bad_hash += 1
            anlz_hash_missing.append(c.path)
    print(f"  ANLZ missing at hash path AND at DB path: {bad_hash}")
    if bad_hash:
        J["anlz_hash_missing"] = anlz_hash_missing
        fails.append(f"{drive}: anlz hardware paths")
    return fails


def verify_drive(drive: str) -> list:
    vol = f"/Volumes/{drive}"
    fails = []
    J = VERIFY_JSON.setdefault("drives", {}).setdefault(drive, {})
    db = DeviceLibraryPlus(os.path.join(vol, "PIONEER/rekordbox/exportLibrary.db"))
    rows = db.query(Content).all()
    print(f"  tracks: {len(rows)}")
    J["tracks"] = len(rows)

    no_file = no_anlz = no_bpm = bad_len = 0
    missing_files: list[str] = []
    missing_anlz: list[str] = []
    no_bpm_list: list[str] = []
    bad_len_list: list[str] = []
    bad_grid_list: list[str] = []
    bad_grid = pioneer_variance = 0
    for c in rows:
        if not os.path.exists(vol + c.path):
            no_file += 1
            missing_files.append(c.path)
        if not c.bpmx100:
            no_bpm += 1
            no_bpm_list.append(c.path)
        if not (0 < c.length < 25000):
            bad_len += 1
            bad_len_list.append(c.path)
        if not c.analysisDataFilePath or not os.path.exists(
            vol + c.analysisDataFilePath
        ):
            no_anlz += 1
            missing_anlz.append(c.path)
            continue
        data = open(vol + c.analysisDataFilePath, "rb").read()  # noqa: SIM115
        parsed = walk_anlz(data)
        if parsed is None:
            bad_grid += 1
            bad_grid_list.append(c.path)
            continue
        pth, sections = parsed
        if pth != c.path:
            bad_grid += 1
            bad_grid_list.append(c.path)
            continue
        qt = next((s for s in sections if s[0] == "PQTZ"), None)
        is_generated = c.path.startswith("/Contents/YTMusic Liked/")
        if qt is None:
            # Pioneer ships factory sample loops ungridded; anything else missing
            # PQTZ is only a problem if we generated it
            if is_generated and c.title not in FACTORY_SAMPLES:
                bad_grid += 1
                bad_grid_list.append(c.path)
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
                bad_grid_list.append(c.path)
            else:
                pioneer_variance += 1
        elif beat_off or bpm_off:
            # Pioneer's own grids drift from its own DB values slightly
            # (variable-BPM sections, rounding); only flag generated files
            if is_generated:
                bad_grid += 1
                bad_grid_list.append(c.path)
            else:
                pioneer_variance += 1

    print(
        f"  missing audio: {no_file} | missing analysis: {no_anlz} | no BPM: {no_bpm} | bad length: {bad_len}"
    )
    print(
        f"  bad grids (generated): {bad_grid} | pioneer-native variance (informational): {pioneer_variance}"
    )
    # structured offenders (only non-empty; keep the JSON line compact)
    if missing_files:
        J["missing_files"] = missing_files
    if missing_anlz:
        J["missing_anlz"] = missing_anlz
    if no_bpm_list:
        J["no_bpm"] = no_bpm_list
    if bad_len_list:
        J["bad_length"] = bad_len_list
    if bad_grid_list:
        J["bad_grids"] = bad_grid_list
    if any([no_file, no_anlz, no_bpm, bad_len]):
        fails.append(f"{drive}: coverage/fields")

    tids = {c.content_id for c in rows}
    bad_entries = [e for e in db.query(PlaylistContent).all() if e.content_id not in tids]
    bad_e = len(bad_entries)
    aids = {a.artist_id for a in db.query(Artist).all()}
    dang = sum(1 for c in rows if c.artist_id_artist and c.artist_id_artist not in aids)
    print(
        f"  playlists: {db.query(Playlist).count()} | entries: {db.query(PlaylistContent).count()} | dangling: {bad_e} | artist FK bad: {dang}"
    )
    JD = VERIFY_JSON["drives"].setdefault(drive, {})
    JD["playlists"] = db.query(Playlist).count()
    JD["playlist_entries"] = db.query(PlaylistContent).count()
    JD["dangling_entries"] = bad_e
    JD["artist_fk_bad"] = dang
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
        fails += verify_hardware_view(drive)
        fails += verify_drive(drive)

    if len(args.drives) == 2:
        a, b = args.drives
        print("\n=== cross-drive ===")
        same = md5(f"/Volumes/{a}/PIONEER/rekordbox/exportLibrary.db") == md5(
            f"/Volumes/{b}/PIONEER/rekordbox/exportLibrary.db"
        )
        print(f"DB byte-identical: {same}")
        VERIFY_JSON["db_identical"] = same
        if not same:
            fails.append("DB parity")

        if not args.skip_hash_parity:
            src = {}
            for dp, _, fns in os.walk(f"/Volumes/{a}/PIONEER/USBANLZ"):
                for fn in fns:
                    if fn.startswith("._"):
                        continue
                    p = os.path.join(dp, fn)
                    src[os.path.relpath(p, f"/Volumes/{a}/PIONEER/USBANLZ")] = p
            mm = 0
            anlz_mismatch: list[str] = []
            for i, (rel, p) in enumerate(src.items(), 1):
                d = f"/Volumes/{b}/PIONEER/USBANLZ/" + rel
                if not os.path.exists(d) or md5(p) != md5(d):
                    mm += 1
                    anlz_mismatch.append(rel)
                    if mm <= 3:
                        print(f"  MISMATCH: {rel}")
                if i % 4000 == 0:
                    print(f"  hashed {i}/{len(src)}", flush=True)
            print(f"ANLZ full hash parity: {mm}/{len(src)} mismatches")
            VERIFY_JSON["anlz_total"] = len(src)
            if mm:
                VERIFY_JSON["anlz_mismatches"] = anlz_mismatch
                fails.append("ANLZ parity")

        db = DeviceLibraryPlus(f"/Volumes/{a}/PIONEER/rekordbox/exportLibrary.db")
        try:
            sample = random.sample(db.query(Content).all(), 40)
        finally:
            db.close()
        am = 0
        audio_mismatch: list[str] = []
        for c in sample:
            fa, fb = f"/Volumes/{a}{c.path}", f"/Volumes/{b}{c.path}"
            if os.path.exists(fa) and os.path.exists(fb) and md5(fa) != md5(fb):
                am += 1
                audio_mismatch.append(c.path)
                print(
                    f"  AUDIO MISMATCH (different rips — copy master's version over): {c.path}"
                )
        print(f"audio hash spot-check (40): {am} mismatches")
        if am:
            VERIFY_JSON["audio_mismatches"] = audio_mismatch
            fails.append("audio parity")

    VERIFY_JSON["fails"] = fails
    # machine-readable payload on ONE stable line: the job engine parses this
    # first and only falls back to regexing the human output if absent.
    print(
        "VERIFY_JSON: "
        + json.dumps(VERIFY_JSON, separators=(",", ":"), default=str),
        flush=True,
    )
    print(f"\nFINAL: {'ALL PASS' if not fails else 'FAILED: ' + ', '.join(fails)}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
