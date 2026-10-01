"""rb-title-repair.kit.py — Fix truncated and contaminated titles in master.db.

argv: <dbPath> <archivePath> <apply|report>

Three repair sources in priority order:
  1. File's embedded TIT2/TPE1 tags (most authoritative)
  2. archive.db title (the megadj pipeline's own ledger)
  3. Heuristic strip of "Artist - " prefix from contaminated titles

Three classes of defect:
  1. TRUNCATED: master.db title is shorter than tag/archive title (44-char wall)
  2. CONTAMINATED: title contains "Artist - Title" but artist col has the name
  3. PAREN-MISMATCH: unbalanced parens/brackets from truncation

Safety: RB-closed gate, WAL checkpoint. Report-only by default.
"""

import json
import os
import re
import sqlite3
import subprocess
import sys
import unicodedata

from pyrekordbox import db6  # type: ignore[import-not-found]
from pyrekordbox.db6.database import BLOB, deobfuscate  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdContent  # type: ignore[import-not-found]


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s).strip() if s else ""


def nfc_casefold(s: str) -> str:
    return unicodedata.normalize("NFC", s).casefold().strip() if s else ""


def read_file_title_artist(path: str) -> tuple[str, str]:
    """Read title and artist from the audio file's tags."""
    try:
        from mutagen import File as MFile  # type: ignore[import-not-found]
    except ImportError:
        return ("", "")
    try:
        a = MFile(path, easy=False)
    except Exception:
        return ("", "")
    if a is None or not hasattr(a, "tags") or a.tags is None:
        return ("", "")
    title = ""
    artist = ""
    tags = a.tags
    # ID3v2 (MP3, AIFF)
    if hasattr(tags, "getall"):
        for frame in tags.getall("TIT2"):
            t = str(frame)
            if t:
                title = t
                break
        for frame in tags.getall("TPE1"):
            t = str(frame)
            if t:
                artist = t
                break
    # MP4 (M4A, AAC)
    if not title:
        mp4_title = tags.get("\xa9nam")
        if mp4_title:
            title = str(mp4_title[0]) if mp4_title else ""
        mp4_artist = tags.get("\xa9ART")
        if mp4_artist:
            artist = str(mp4_artist[0]) if mp4_artist else ""
    # Vorbis (FLAC, OGG)
    if not title:
        vorbis_title = tags.get("title")
        if vorbis_title:
            title = str(vorbis_title[0]) if vorbis_title else ""
        vorbis_artist = tags.get("artist")
        if vorbis_artist:
            artist = str(vorbis_artist[0]) if vorbis_artist else ""
    return (nfc(title), nfc(artist))


def split_artist_title(s: str) -> tuple[str, str]:
    """Split 'Artist - Title' on first ' - '."""
    idx = s.find(" - ")
    if idx < 1:
        return ("", s)
    return (s[:idx].strip(), s[idx + 3 :].strip())


def has_paren_mismatch(s: str) -> bool:
    return s.count("(") != s.count(")") or s.count("[") != s.count("]")


def is_truncation_of(short: str, full: str) -> bool:
    """True when short is a truncated version of full."""
    s = nfc_casefold(short)
    f = nfc_casefold(full)
    if not s or not f or len(s) >= len(f):
        return False
    # Strip RB dedup suffix (-1, -2, etc.)
    clean = re.sub(r"-\d+$", "", s)
    return f.startswith(clean) and len(f) > len(clean) + 1


def artist_name(c: object) -> str:
    try:
        return str(c.ArtistID.Name) if c.ArtistID else ""  # type: ignore[union-attr]
    except Exception:
        return ""


def main() -> None:
    db_path = sys.argv[1]
    archive_path = sys.argv[2] if len(sys.argv) > 2 else ""
    apply = len(sys.argv) > 3 and sys.argv[3] == "apply"

    rbdb = db6.Rekordbox6Database(path=db_path, key=deobfuscate(BLOB))

    # Load archive.db titles by NFC-casefolded file_path
    archive_titles: dict[str, dict[str, str]] = {}
    if archive_path and os.path.exists(archive_path):
        con = sqlite3.connect(archive_path)
        con.row_factory = sqlite3.Row
        for r in con.execute(
            "SELECT title, artist, file_path FROM tracks"
            " WHERE file_path IS NOT NULL AND title IS NOT NULL"
        ):
            fp = nfc_casefold(r["file_path"] or "")
            if fp:
                archive_titles[fp] = {"title": nfc(r["title"]), "artist": nfc(r["artist"] or "")}
        con.close()

    out: dict = {
        "scanned": 0,
        "truncated_fixed": 0,
        "contamination_fixed": 0,
        "paren_fixed": 0,
        "skipped_missing": 0,
        "skipped_no_source": 0,
        "already_good": 0,
        "applied": apply,
        "samples": [],
        "errors": [],
    }

    rows = list(rbdb.query(DjmdContent).all())
    out["scanned"] = len(rows)

    pending: list[tuple[object, str]] = []

    for c in rows:
        db_title = nfc(c.Title or "")
        db_path_str = c.FolderPath or ""
        db_artist = nfc(artist_name(c))
        fp_key = nfc_casefold(db_path_str)

        if not db_title:
            continue

        # Determine if this row needs fixing
        is_paren = has_paren_mismatch(db_title)
        is_contam = " - " in db_title and (
            db_title.rstrip().endswith(" -")
            or (
                db_artist
                and nfc_casefold(split_artist_title(db_title)[0]) == nfc_casefold(db_artist)
            )
        )

        if not is_paren and not is_contam:
            out["already_good"] += 1
            continue

        # Source 1: file tags (only if file exists)
        tag_title = ""
        if db_path_str and os.path.exists(db_path_str):
            raw_tag_title, _tag_artist = read_file_title_artist(db_path_str)
            # Pre-clean: if tag title has "Artist - Title" shape, strip the prefix
            if raw_tag_title and " - " in raw_tag_title:
                _tp, tag_rest = split_artist_title(raw_tag_title)
                # Only strip if the rest is substantial (not "- Extended" or "- DC195")
                if tag_rest and len(tag_rest) > len(_tp):
                    tag_title = tag_rest
                else:
                    tag_title = raw_tag_title
            else:
                tag_title = raw_tag_title
            # Reject tag titles that are themselves truncated
            if tag_title and has_paren_mismatch(tag_title):
                tag_title = ""
        elif not db_path_str or not os.path.exists(db_path_str):
            out["skipped_missing"] += 1

        # Source 2: archive.db
        archive_title = ""
        arch = archive_titles.get(fp_key)
        if arch:
            archive_title = arch["title"]

        # Pick the best replacement
        new_title = ""
        fix_class = ""

        # Prefer tag title if it's longer and untruncated
        if tag_title and not has_paren_mismatch(tag_title):
            # Reject tag titles that are themselves contaminated with "Artist - "
            # (the file tag was written from the same bad source as the DB title).
            tag_has_dash = " - " in tag_title
            if tag_has_dash:
                # If the tag prefix matches the known DB artist, strip it
                _tp, tag_rest = split_artist_title(tag_title)
                if db_artist and nfc_casefold(_tp) == nfc_casefold(db_artist) and tag_rest:
                    tag_title = tag_rest
                    tag_has_dash = " - " in tag_title
            # Only use the tag title if it's cleaner than the DB title
            if not tag_has_dash or not is_contam:
                if is_paren and len(tag_title) > len(db_title):
                    new_title = tag_title
                    fix_class = "truncated"
                elif is_contam and nfc_casefold(tag_title) != nfc_casefold(db_title):
                    new_title = tag_title
                    fix_class = "contamination"

        # Fall back to archive.db title
        if not new_title and archive_title and not has_paren_mismatch(archive_title):
            if is_paren and len(archive_title) > len(db_title):
                new_title = archive_title
                fix_class = "truncated"
            elif is_contam and " - " not in archive_title:
                new_title = archive_title
                fix_class = "contamination"

        # Fall back to heuristic: strip "Artist - " prefix
        if not new_title and is_contam and not db_title.rstrip().endswith(" -"):
            _prefix, rest = split_artist_title(db_title)
            if rest and rest != db_title:
                new_title = rest
                fix_class = "contamination"

        # Trailing " -" with no title half → can't fix without a source
        if not new_title and is_contam and db_title.rstrip().endswith(" -"):
            # Try the archive artist's name to see if we can strip
            if archive_title and nfc_casefold(archive_title) != nfc_casefold(db_title):
                new_title = archive_title
                fix_class = "contamination"

        if not new_title or nfc_casefold(new_title) == nfc_casefold(db_title):
            out["skipped_no_source"] += 1
            continue

        pending.append((c, new_title))
        if fix_class == "truncated":
            out["truncated_fixed"] += 1
        elif fix_class == "contamination":
            out["contamination_fixed"] += 1
        else:
            out["paren_fixed"] += 1

        if len(out["samples"]) < 25:
            out["samples"].append([fix_class, db_title[:60], new_title[:60]])

    if apply and pending:
        if subprocess.run(["pgrep", "-x", "rekordbox"], capture_output=True).returncode == 0:
            rbdb.session.rollback()
            out["errors"].append(["gate", "rekordbox is running -- refusing write"])
            out["applied"] = False
            print(json.dumps(out))
            rbdb.close()
            sys.exit(1)

        for c_obj, new_t in pending:
            c_obj.Title = new_t

        try:
            rbdb.session.commit()
        except Exception as e:
            rbdb.session.rollback()
            out["errors"].append(["commit", repr(e)[:200]])

    print(json.dumps(out))

    try:
        from sqlalchemy import text  # type: ignore[import-not-found]

        with rbdb.engine.connect() as conn:
            conn.execute(text("PRAGMA wal_checkpoint(TRUNCATE)"))
    except Exception:
        pass
    finally:
        rbdb.close()


if __name__ == "__main__":
    main()
