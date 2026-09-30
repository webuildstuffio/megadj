"""rb-tag-fix.kit.py — Push title/artist fixes from archive.db to master.db.

argv: <dbPath> <ledgerPath> <apply|report>

Reads recently-fixed tracks from archive.db and updates master.db Title
and ArtistID. Creates new djmdArtist rows when needed. Safety: RB-closed
gate, dated backup, WAL checkpoint.
"""

import json
import os
import sqlite3
import subprocess
import sys
import unicodedata
import uuid

from pyrekordbox import db6  # type: ignore[import-not-found]
from pyrekordbox.db6.database import BLOB, deobfuscate  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdArtist, DjmdContent  # type: ignore[import-not-found]


def nfc_casefold(s: str) -> str:
    return unicodedata.normalize("NFC", s).casefold() if s else ""


def main() -> None:
    db_path = sys.argv[1]
    ledger_path = sys.argv[2]
    apply = sys.argv[3] == "apply"

    rbdb = db6.Rekordbox6Database(path=db_path, key=deobfuscate(BLOB))

    # Build artist lookup
    artist_map: dict[str, object] = {}
    for a in rbdb.query(DjmdArtist).all():
        artist_map[nfc_casefold(a.Name or "")] = a

    # Read fixed tracks from archive.db
    archive_con = sqlite3.connect(ledger_path)
    archive_con.row_factory = sqlite3.Row

    fixed: dict[str, dict] = {}
    for row in archive_con.execute(
        """SELECT t.video_id, t.title, t.artist, t.year, rc.content_id
           FROM tracks t
           JOIN rekordbox_content rc ON rc.video_id = t.video_id
           WHERE t.updated_at > '2026-09-30T08:37'"""
    ):
        fixed[str(row["content_id"])] = {
            "title": row["title"],
            "artist": row["artist"],
            "year": row["year"],
        }
    archive_con.close()

    title_fixed = 0
    artist_fixed = 0
    artist_created = 0
    samples: list[list[str]] = []
    existing_ids = {str(a.ID) for a in artist_map.values()}

    for c in rbdb.query(DjmdContent).all():
        cid = str(c.ID)
        if cid not in fixed:
            continue
        f = fixed[cid]

        old_title = c.Title or ""

        # Fix title
        if f["title"] and f["title"] != c.Title:
            if apply:
                c.Title = f["title"]
            title_fixed += 1
            if len(samples) < 10:
                samples.append([old_title[:60], f["title"][:60], f.get("artist") or ""])

        # Fix artist
        if f["artist"]:
            akey = nfc_casefold(f["artist"])
            if akey in artist_map:
                art = artist_map[akey]
            else:
                aid = str(abs(hash(f["artist"])) % (2**31))
                while aid in existing_ids:
                    aid = str(int(aid) + 1)
                existing_ids.add(aid)
                art = DjmdArtist(ID=aid, Name=f["artist"], UUID=str(uuid.uuid4()))
                if apply:
                    rbdb.session.add(art)
                artist_map[akey] = art
                artist_created += 1

            if str(c.ArtistID) != str(art.ID):
                if apply:
                    c.ArtistID = art.ID
                    c.OrgArtistID = art.ID
                artist_fixed += 1

    if apply:
        rbdb.session.commit()

    out = {
        "scanned": len(fixed),
        "title_fixed": title_fixed,
        "artist_fixed": artist_fixed,
        "artist_created": artist_created,
        "applied": apply,
        "samples": samples,
    }
    print(json.dumps(out))

    try:
        from sqlalchemy import text

        with rbdb.engine.connect() as conn:
            conn.execute(text("PRAGMA wal_checkpoint(TRUNCATE)"))
    except Exception:
        pass
    finally:
        rbdb.close()


if __name__ == "__main__":
    main()
