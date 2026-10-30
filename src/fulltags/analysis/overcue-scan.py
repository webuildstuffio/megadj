"""Scan FIKWOK stems and rekordbox DB to generate OverCue mapping JSON.

Usage:
  python overcue-scan.py <volume> <stems_subdir> <output_json> [--skip-indexed]

Scans stem cache dirs (rb-*/) for complete Demucs sets (vocals, drums, bass, other),
resolves source audio paths from rekordbox master.db, and outputs a mapping JSON
suitable for overcue-turbo.py.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

STEM_FILES = ["vocals.flac", "drums.flac", "bass.flac", "other.flac"]


def scan_stem_dirs(stems_root: Path) -> dict[str, Path]:
    """Find all rb-* dirs with a complete stem set. Returns {desktop_id: stem_dir}."""
    result: dict[str, Path] = {}
    if not stems_root.is_dir():
        return result
    for entry in sorted(stems_root.iterdir()):
        if not entry.is_dir() or not entry.name.startswith("rb-"):
            continue
        desktop_id = entry.name[3:]
        if all((entry / f).exists() for f in STEM_FILES):
            result[desktop_id] = entry
    return result


def load_rb_paths(volume: str) -> dict[str, dict[str, str]]:
    """Load rekordbox desktop DB track paths. Returns {desktop_id: {path, title, artist}}."""
    try:
        sys.path.insert(0, os.path.expanduser("~/github/XZ-Mods/.venv/lib/python3.13/site-packages"))
        from pyrekordbox import Rekordbox6Database as RB6
    except ImportError:
        try:
            from pyrekordbox import MasterDatabase as RB6  # type: ignore[import-untyped]
        except ImportError:
            print("ERROR: pyrekordbox not available", file=sys.stderr)
            return {}

    master_db = os.path.expanduser("~/Library/Pioneer/rekordbox/master.db")
    if not os.path.exists(master_db):
        print(f"ERROR: rekordbox DB not found: {master_db}", file=sys.stderr)
        return {}

    db = RB6(master_db)
    tracks: dict[str, dict[str, str]] = {}
    for content in list(db.get_content()):
        rid = str(content.ID)
        fp = getattr(content, "FolderPath", "") or ""
        fn = getattr(content, "FileNameL", "") or getattr(content, "FileName", "") or ""
        title = getattr(content, "Title", "") or ""
        artist_obj = getattr(content, "Artist", None)
        artist = getattr(artist_obj, "Name", "") if artist_obj else ""
        if fp or fn:
            full_path = fp + fn if fp else fn
            tracks[rid] = {"path": full_path, "title": title, "artist": artist}
    return tracks


def main() -> None:
    if len(sys.argv) < 4:
        print("Usage: overcue-scan.py <volume> <stems_subdir> <output_json> [--skip-indexed]")
        sys.exit(1)

    volume = sys.argv[1]
    stems_subdir = sys.argv[2]
    output_json = sys.argv[3]
    skip_indexed = "--skip-indexed" in sys.argv

    stems_root = Path(volume) / stems_subdir
    cdjmods = Path(volume) / "CDJMODS"

    stem_dirs = scan_stem_dirs(stems_root)
    print(f"Found {len(stem_dirs)} complete stem sets in {stems_root}")

    rb_tracks = load_rb_paths(volume)
    print(f"Loaded {len(rb_tracks)} tracks from rekordbox DB")

    indexed_ids: set[str] = set()
    if skip_indexed:
        index_path = cdjmods / "index.json"
        if index_path.exists():
            idx = json.loads(index_path.read_text())
            indexed_ids = set(idx.get("tracks", {}).keys())
            print(f"Skipping {len(indexed_ids)} already-indexed tracks")

    mapping: list[dict[str, str | int]] = []
    matched = 0
    unmatched = 0

    for desktop_id, stem_dir in sorted(stem_dirs.items()):
        if desktop_id in indexed_ids:
            continue

        rb_info = rb_tracks.get(desktop_id)
        if not rb_info:
            unmatched += 1
            continue

        file_path = rb_info["path"]
        source = Path(volume + file_path) if file_path.startswith("/") else Path(volume) / file_path
        if not source.exists():
            source_check = Path(file_path)
            if source_check.exists():
                source = source_check
                file_path = str(source)
            else:
                unmatched += 1
                continue

        matched += 1
        mapping.append({
            "track_id": int(desktop_id),
            "rb_desktop_id": int(desktop_id),
            "file_path": file_path if file_path.startswith("/") else "/" + str(source.relative_to(volume)),
            "title": rb_info["title"],
            "artist": rb_info["artist"],
            "stem_dir": str(stem_dir),
        })

    with open(output_json, "w") as f:
        json.dump(mapping, f, indent=1)

    print(f"Mapping: {len(mapping)} tracks ({matched} matched, {unmatched} unmatched)")
    print(f"Written: {output_json}")
    print(json.dumps({"count": len(mapping), "matched": matched, "unmatched": unmatched}))


if __name__ == "__main__":
    main()
