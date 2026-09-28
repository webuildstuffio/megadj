"""One-shot cleanup: remove 31 confirmed duplicate rows from master.db.

Sep 26 2026 — second pass of the dupe audit. Requires rekordbox CLOSED.
Creates a dated backup before any mutation. Removes playlist entries first,
then content rows via raw SQLAlchemy session.delete() (pyrekordbox's
db.delete() chokes on DjmdContent with 'is_folder' AttributeError).

Usage: uv run --with pyrekordbox python3 tools/rb-dedup-cleanup-20260926.py
"""

import os
import subprocess
import sys
import zipfile
from datetime import UTC, datetime

from pyrekordbox import Rekordbox6Database  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdContent, DjmdSongPlaylist  # type: ignore[import-not-found]

DB_PATH = "/Volumes/SHELF1/PIONEER/Master/master.db"

# 37 confirmed duplicate IDs from the audit (title + acoustic fingerprint)
REMOVE_IDS: set[str] = {
    # 19 [archive] suffix dupes
    "1811926201", "889947516", "1291639823", "2070316469", "1700787146",
    "362310610", "1081327234", "1670484089", "607034171", "812963383",
    "1920895078", "1119241949", "1254093320", "944421341", "2124450523",
    "928337375", "1070118494", "1425668844", "1109589045",
    # 9 BACKUP2 with non-BACKUP2 original (title match)
    "741092521", "926298826", "2002635222", "110190060", "906656068",
    "2053180543", "219325262", "2000992003", "176247033",
    # 3 BACKUP2 internal dupes — title match (UnknownArtist variant removed)
    "667957919", "188951293", "856097969",
    # 6 BACKUP2 internal dupes — ACOUSTIC FINGERPRINT match (title missed)
    "792298668", "423241712", "1696166222", "2097560261", "1623082955",
    "138608890",
}


def rekordbox_running() -> bool:
    r = subprocess.run(["pgrep", "-x", "rekordbox"], capture_output=True)
    return r.returncode == 0


def backup(db_path: str) -> str:
    stamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    state_dir = os.path.expanduser("~/.local/state/megadj")
    os.makedirs(state_dir, exist_ok=True)
    zip_path = os.path.join(state_dir, f"rekordbox_bak_{stamp}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for suffix in ("", "-wal", "-shm"):
            p = db_path + suffix
            if os.path.exists(p):
                zf.write(p, os.path.basename(p))
    print(f"backup: {zip_path} ({os.path.getsize(zip_path) / 1_048_576:.1f} MB)")
    return zip_path


def main() -> None:
    if rekordbox_running():
        print("ERROR: rekordbox is running — quit it first", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(DB_PATH):
        print(f"ERROR: DB not found at {DB_PATH}", file=sys.stderr)
        sys.exit(1)

    bak = backup(DB_PATH)
    print(f"backup saved: {bak}")

    db = Rekordbox6Database(DB_PATH)

    # Phase 1: remove playlist entries referencing doomed content
    playlist_removed = 0
    for sp in db.query(DjmdSongPlaylist).all():
        cid = str(sp.ContentID) if sp.ContentID is not None else None
        if cid in REMOVE_IDS:
            db.session.delete(sp)
            playlist_removed += 1

    if playlist_removed:
        db.session.commit()
        print(f"removed {playlist_removed} playlist entries")

    # Phase 2: remove content rows via raw session.delete()
    content_removed = 0
    for c in db.query(DjmdContent).all():
        if str(c.ID) in REMOVE_IDS:
            db.session.delete(c)
            content_removed += 1

    if content_removed:
        db.session.commit()
        print(f"removed {content_removed} content rows")

    # Verify
    remaining = sum(1 for c in db.get_content() if c.FolderPath)
    db.close()
    print(f"post-cleanup: {remaining} tracks remain")
    print(f"expected removals: {len(REMOVE_IDS)}, actual: {content_removed}")
    if content_removed != len(REMOVE_IDS):
        missing = len(REMOVE_IDS) - content_removed
        print(f"WARNING: {missing} IDs were not found (already removed?)")


if __name__ == "__main__":
    main()
