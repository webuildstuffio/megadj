"""album-push.kit.py — Push album data from archive.db → master.db.

argv: <dbPath> <ledgerPath> <apply|report>

Reads album data from archive.db (the pipeline ledger) and sets AlbumID
on master.db content rows that have no album. Creates new djmdAlbum rows
when needed (with UUID + timestamps). Matches on NFC-casefolded file path
first, then title+artist fallback.

Safety: RB-closed gate, WAL checkpoint. The caller (rb-comment-sync or
full-pipeline) owns the backup.
"""

import datetime
import json
import sqlite3
import subprocess
import sys
import unicodedata
import uuid

from pyrekordbox import db6  # type: ignore[import-not-found]
from pyrekordbox.db6.database import BLOB, deobfuscate  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdAlbum, DjmdContent  # type: ignore[import-not-found]
from sqlalchemy import text  # type: ignore[import-not-found]


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s).casefold() if s else ""


def main() -> None:
    db_path = sys.argv[1]
    ledger_path = sys.argv[2]
    apply = sys.argv[3] == "apply" if len(sys.argv) > 3 else False

    if subprocess.run(
        ["pgrep", "-x", "rekordbox"], capture_output=True
    ).returncode == 0:
        print(json.dumps({"error": "rekordbox is running — refusing write"}))
        sys.exit(1)

    rbdb = db6.Rekordbox6Database(path=db_path, key=deobfuscate(BLOB))
    archive = sqlite3.connect(ledger_path)
    archive.row_factory = sqlite3.Row

    # Build archive album lookup keyed on multiple keys
    arc_albums: dict[str, str] = {}
    for r in archive.execute(
        "SELECT file_path, album, title, artist FROM tracks "
        "WHERE status='downloaded' AND album IS NOT NULL "
        "AND album != '' AND album != 'UnknownAlbum'"
    ):
        if r["file_path"]:
            arc_albums[nfc(r["file_path"])] = r["album"]
        if r["title"] and r["artist"]:
            arc_albums[nfc(str(r["title"])) + "|" + nfc(str(r["artist"]))] = r["album"]
    archive.close()

    # Build album name → ID cache
    album_ids: dict[str, int] = {}
    max_id = 0
    for a in rbdb.query(DjmdAlbum).all():
        if a.Name:
            album_ids[str(a.Name)] = int(a.ID)
        aid = int(a.ID) if a.ID else 0
        if aid > max_id:
            max_id = aid

    next_id = max_id + 1
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    pushed = 0
    skipped = 0
    already = 0
    created_albums = 0
    samples: list[list[str]] = []

    for c in rbdb.query(DjmdContent).all():
        if c.AlbumID is not None and int(c.AlbumID) > 0:
            already += 1
            continue

        fp = c.FolderPath or ""
        album = arc_albums.get(nfc(fp))

        if not album and c.Title and c.ArtistName:
            key = nfc(str(c.Title)) + "|" + nfc(str(c.ArtistName))
            album = arc_albums.get(key)

        if not album:
            skipped += 1
            continue

        aid = album_ids.get(album)
        if aid is None:
            new_uuid = str(uuid.uuid4())
            if apply:
                with rbdb.engine.connect() as conn:
                    conn.execute(
                        text(
                            "INSERT INTO djmdAlbum (ID, UUID, Name, created_at, updated_at) "
                            "VALUES (:id, :uuid, :name, :now, :now)"
                        ),
                        {"id": next_id, "uuid": new_uuid, "name": album, "now": now},
                    )
                    conn.commit()
            album_ids[album] = next_id
            aid = next_id
            next_id += 1
            created_albums += 1

        if apply:
            c.AlbumID = aid
        pushed += 1
        if len(samples) < 10:
            samples.append([str(c.Title or "")[:50], album[:50]])

    if apply:
        rbdb.session.commit()

    total = already + pushed + skipped
    pct = (already + pushed) * 100.0 / total if total > 0 else 0

    out = {
        "pushed": pushed,
        "created_albums": created_albums,
        "already_had": already,
        "no_match": skipped,
        "total": total,
        "coverage_pct": round(pct, 1),
        "applied": apply,
        "samples": samples,
    }
    print(json.dumps(out))

    try:
        with rbdb.engine.connect() as conn:
            conn.execute(text("PRAGMA wal_checkpoint(TRUNCATE)"))
    except Exception:
        pass
    finally:
        rbdb.close()


if __name__ == "__main__":
    main()
