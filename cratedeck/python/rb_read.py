#!/usr/bin/env python3
"""CrateDeck rekordbox bridge — the ONLY Python seam into rekordbox-land.

Reads a COPY of a device library (never the live DB) and emits one JSON.
Imports the skill's canonical implementations directly:

    anlz_paths.compute_anlz_folder / folder_key   (ANLZ hash paths)
    usb_verify.pdb_live_rows                      (legacy export.pdb rows)

Usage:
    uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \\
        python python/rb_read.py <db_copy> <drive_root>

Output: {"ok": true, "snapshot": {...}} or {"ok": false, "error": "..."}
"""

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SKILL_SCRIPTS = os.path.join(REPO, ".claude", "skills", "rekordbox-usb-sync", "scripts")
sys.path.insert(0, SKILL_SCRIPTS)

from anlz_paths import compute_anlz_folder, folder_key


def analyze_anlz_coverage(db, content_model, drive_root: str) -> float:
    """Fraction of tracks whose ANLZ exists at the hash-computed path."""
    usb_anlz = os.path.join(drive_root, "PIONEER", "USBANLZ")
    total = found = 0
    for c in db.query(content_model).all():
        if not c.path or c.fileType not in (4, 1):
            continue
        total += 1
        rel_path = c.path.lstrip("/").replace("Contents/", "", 1)
        try:
            p, hr = compute_anlz_folder(rel_path)
            anlz = os.path.join(usb_anlz, folder_key(p, hr), "ANLZ0000.DAT")
            if os.path.exists(anlz):
                found += 1
        except (ValueError, TypeError, OSError):
            continue
    return round(found / total, 4) if total else 0.0


def _median(vals):
    s = sorted(vals)
    n = len(s)
    if not n:
        return 0
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


def _top(counter: dict, n: int = 12):
    return [
        {"name": k, "count": v}
        for k, v in sorted(counter.items(), key=lambda kv: -kv[1])[:n]
        if k
    ]


def _bpm_bucket(bpm):
    if not bpm or bpm <= 0:
        return None
    return f"{int(bpm // 10) * 10}-{int(bpm // 10) * 10 + 9}"


def dj_stats(db, contents) -> dict:
    """Genre/BPM/key/artist/duration/bitrate/artwork analytics from Content rows."""
    from pyrekordbox.devicelib_plus.models import Genre, Key

    genre_names = {g.genre_id: g.name for g in db.query(Genre).all()}
    key_names = {k.key_id: k.name for k in db.query(Key).all()}

    genres: dict = {}
    keys: dict = {}
    artists: dict = {}
    bpm_hist: dict = {}
    bpms = []
    durations = []
    lossless = lossy_high = lossy = unknown_br = 0
    artwork_missing = 0
    artwork_total = 0

    for c in contents:
        if c.fileType not in (4, 1):
            continue
        g = genre_names.get(getattr(c, "genre_id", None))
        if g:
            genres[g] = genres.get(g, 0) + 1
        k = key_names.get(getattr(c, "key_id", None))
        if k:
            keys[k] = keys.get(k, 0) + 1
        a = getattr(c, "artist_id_artist", None)
        if a:
            artists[a] = artists.get(a, 0) + 1
        bpm = getattr(c, "bpmx100", None)
        if bpm:
            real_bpm = bpm / 100.0
            bpms.append(real_bpm)
            b = _bpm_bucket(real_bpm)
            if b:
                bpm_hist[b] = bpm_hist.get(b, 0) + 1
        if c.length:
            durations.append(c.length)
        bitrate = getattr(c, "bitrate", None)
        if not bitrate:
            unknown_br += 1
        elif bitrate >= 1000:  # rekordbox marks lossless with high pseudo-bitrate
            lossless += 1
        elif bitrate >= 256:
            lossy_high += 1
        else:
            lossy += 1
        artwork_total += 1
        if not getattr(c, "image_id", None):
            artwork_missing += 1

    bpm_sorted = sorted(bpm_hist.items(), key=lambda kv: int(kv[0].split("-")[0]))
    return {
        "genres": _top(genres),
        "keys": _top(keys),
        "artists_top": _top(artists),
        "bpm_min": min(bpms) if bpms else None,
        "bpm_max": max(bpms) if bpms else None,
        "bpm_median": round(_median(bpms), 1) if bpms else None,
        "bpm_histogram": [{"bucket": b, "count": c} for b, c in bpm_sorted],
        "duration": {
            "shortest_s": min(durations) if durations else 0,
            "longest_s": max(durations) if durations else 0,
            "median_s": round(_median(durations), 1) if durations else 0,
            "average_s": round(sum(durations) / len(durations), 1) if durations else 0,
        },
        "bitrate": {
            "lossless": lossless,
            "lossy_high": lossy_high,
            "lossy": lossy,
            "unknown": unknown_br,
        },
        "artwork_missing": artwork_missing,
        "artwork_total": artwork_total,
    }


def snapshot(db_path: str, drive_root: str) -> dict:
    from pyrekordbox.devicelib_plus.database import DeviceLibraryPlus
    from pyrekordbox.devicelib_plus.models import Content, Playlist, PlaylistContent
    from usb_verify import pdb_live_rows

    db = DeviceLibraryPlus(db_path)
    try:
        contents = db.query(Content).all()
        playlists = db.query(Playlist).all()
        entries = db.query(PlaylistContent).all()

        playlist_names = {p.playlist_id: p.name for p in playlists}
        entry_counts: dict = {}
        parent_by_id = {p.playlist_id: p.playlist_id_parent for p in playlists}
        for e in entries:
            entry_counts[e.playlist_id] = entry_counts.get(e.playlist_id, 0) + 1

        pl_info = [
            {
                "name": p.name,
                "entries": entry_counts.get(p.playlist_id, 0),
                "parent": playlist_names.get(parent_by_id.get(p.playlist_id))
                if parent_by_id.get(p.playlist_id)
                else None,
            }
            for p in playlists
            if getattr(p, "attribute", 0) != 4  # skip folder-node stubs in tree
        ]

        durations = [c.length for c in contents if c.length]
        grid_cov = analyze_anlz_coverage(db, Content, drive_root)

        onelibrary_rows = len(contents)
        pdb_path = os.path.join(drive_root, "PIONEER", "rekordbox", "export.pdb")
        pdb_rows = pdb_live_rows(pdb_path) if os.path.exists(pdb_path) else None

        def mtime(path):
            try:
                return int(os.path.getmtime(path) * 1000)
            except OSError:
                return None

        return {
            "kind": "full",
            "taken_at": int(time.time() * 1000),
            "track_count": onelibrary_rows,
            "total_duration_ms": int(sum(durations) * 1000) if durations else 0,
            "playlists": pl_info,
            "grid_coverage": grid_cov,
            "onelibrary_rows": onelibrary_rows,
            "pdb_live_rows": pdb_rows,
            "dj": dj_stats(db, contents),
            "db_mtime": mtime(os.path.join(drive_root, "PIONEER", "rekordbox", "exportLibrary.db")),
            "pdb_mtime": mtime(pdb_path) if os.path.exists(pdb_path) else None,
        }
    finally:
        try:
            db.session.close()
        except Exception as exc:  # noqa: BLE001 — best-effort cleanup
            print(f"warn: session close failed: {exc}", file=sys.stderr)


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: rb_read.py <db_copy> <drive_root>"}))
        return 1
    db_path, drive_root = sys.argv[1], sys.argv[2]
    try:
        import pyrekordbox  # noqa: F401
    except ImportError:
        print(json.dumps({"ok": False, "error": "pyrekordbox not installed; run via uv --with pyrekordbox"}))
        return 1
    try:
        print(json.dumps({"ok": True, "snapshot": snapshot(db_path, drive_root)}))
    except Exception as exc:  # noqa: BLE001 — bridge reports all failures as JSON
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
