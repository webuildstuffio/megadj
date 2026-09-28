"""rb-comment-sync write leg — FullTags comment from TXXX + ledger.

argv: <dbPath> <ledgerPath> <apply> <batch> — for each master
row with an empty Comment and an existing file: read TXXX
CAMELOT/ENERGY/MOOD (+ MOODS variant) via mutagen and build the
FullTags comment `Camelot · E<energy> · Mood1+Mood2`; falls back to
archive.db (mood+tracks tables) when the file carries no TXXX set.
One spawn writes the batch behind the RB-closed guard (kit fragment).
"""

import json
import os
import sqlite3
import subprocess
import sys

from pyrekordbox import db6  # type: ignore[import-not-found]
from pyrekordbox.db6.database import BLOB, deobfuscate  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdContent  # type: ignore[import-not-found]

# Sentinel: the file exists but its tag block is corrupt/unparseable.
# Distinct from None ("readable, no usable frames") so the skip list can
# report "unreadable" — a data-integrity signal — instead of "no tag data"
# (issue #229: corrupt indistinguishable from untagged).
UNREADABLE = object()


def read_txxx(path):
    """Read CAMELOT/ENERGY/MOOD TXXX frames + comment-format fields.

    Returns {..frames..}, None (readable file, no usable tag frames),
    or UNREADABLE (the file's tag block exists but mutagen cannot
    parse it — issue #229: corrupt must not read as "no tag data",
    a data-integrity signal mislabeled as absence).
    """
    try:
        from mutagen import File as MFile
    except Exception:  # mutagen absent — the whole read leg can't run
        return None
    try:
        a = MFile(path, easy=False)
    except Exception:
        return UNREADABLE
    if a is None or not hasattr(a, "tags") or a.tags is None:
        return None
    out = {}
    for tag in a.tags.values():
        k = getattr(tag, "desc", "") or ""
        v = getattr(tag, "text", [""])
        v = str(v[0]) if v else ""
        ku = k.upper()
        if ku in ("CAMELOT", "TKEY", "INITIALKEY") and v:
            out.setdefault("key", v)
        elif ku == "ENERGY" and v:
            out.setdefault("energy", v)
        elif ku in ("MOOD", "MOODS") and v:
            out.setdefault("mood", v)
    return out or None


def main() -> None:
    db_path, ledger_path = sys.argv[1], sys.argv[2]
    apply = sys.argv[3] == "apply"
    batch = sys.argv[4]
    db = db6.Rekordbox6Database(path=db_path, key=deobfuscate(BLOB))

    rows = []
    for c in db.query(DjmdContent).all():
        p = c.FolderPath or ""
        if batch and batch not in p:
            continue
        rows.append(c)

    # ledger fallback data (video_id keyed)
    led = {}
    moods_by_path = {}
    if os.path.exists(ledger_path):
        con = sqlite3.connect(ledger_path)
        con.row_factory = sqlite3.Row
        for t in con.execute(
            "select video_id, energy, genre, year, album, title, artist, file_path from tracks"
        ):
            led.setdefault("path:" + (t["file_path"] or "").casefold(), dict(t))
            led.setdefault("id:" + t["video_id"], dict(t))
        for m in con.execute(
            "select m.video_id, m.dance, m.aggressive, m.happy, m.electronic, m.party,"
            " t.file_path from mood m join tracks t on t.video_id = m.video_id"
        ):
            moods_by_path[(m["file_path"] or "").casefold()] = dict(m)

    out = {
        "scanned": len(rows),
        "eligible": 0,
        "written": 0,
        "enriched": 0,
        "alreadyHad": 0,
        "skipped": [],
        "samples": [],
        "writes": [],
        "errors": [],
    }

    def resolve_data(p: str, tags: dict | None) -> tuple[str, str, str]:
        """Resolve key/energy/mood from TXXX tags + ledger fallback."""
        key = (tags or {}).get("key", "")
        energy = (tags or {}).get("energy", "")
        mood = (tags or {}).get("mood", "")
        # Old-format raw-score tags (dance=0.999;...) are useless — skip to ledger
        if mood and "=" in mood:
            mood = ""
        if not energy:
            led_row = led.get("path:" + p.casefold())
            if led_row and led_row.get("energy"):
                energy = str(led_row["energy"])
        if not mood:
            m = moods_by_path.get(p.casefold())
            if m:
                tops = []
                for head, label in (
                    ("party", "Party"),
                    ("dance", "Dance"),
                    ("aggressive", "Aggro"),
                    ("happy", "Happy"),
                    ("electronic", "Electronic"),
                ):
                    try:
                        if float(m.get(head) or 0) >= 0.5:
                            tops.append(label)
                    except (TypeError, ValueError):
                        pass
                mood = "+".join(tops[:3])
        return key, energy, mood

    def build_comment(key: str, energy: str, mood: str) -> str:
        epart = f"E{energy}" if energy else ""
        parts = [x for x in (key, epart, mood) if x]
        return " · ".join(parts)

    import re
    MOOD_HEADS = {"Party", "Dance", "Aggro", "Happy", "Electronic"}

    def parse_existing(comment: str) -> tuple[str, str, str]:
        """Extract key/energy/mood already present in a comment."""
        parts = [p.strip() for p in comment.split("·")]
        ex_key = ex_energy = ex_mood = ""
        for part in parts:
            if re.match(r"^[A-Ga-g][#b]?m?$", part):
                ex_key = part
            elif re.match(r"^E\d", part):
                ex_energy = part[1:]
            elif any(h in part for h in MOOD_HEADS):
                ex_mood = part
            elif re.match(r"^\d+[A-B]$", part):
                ex_key = part
        return ex_key, ex_energy, ex_mood

    pending = []
    for c in rows:
        p = c.FolderPath or ""
        existing = (c.Commnt or "").strip()
        if not os.path.exists(p):
            out["skipped"].append([p[-70:], "file missing"])
            continue
        tags = read_txxx(p)
        if tags is UNREADABLE:
            out["skipped"].append([p[-70:], "unreadable"])
            continue

        key, energy, mood = resolve_data(p, tags)

        if existing:
            ex_key, ex_energy, ex_mood = parse_existing(existing)
            new_key = ex_key or key
            new_energy = ex_energy or energy
            new_mood = ex_mood or mood
            new_comment = build_comment(new_key, new_energy, new_mood)
            if new_comment != existing and (new_key != ex_key or new_energy != ex_energy or new_mood != ex_mood):
                out["enriched"] += 1
                out["eligible"] += 1
                if len(out["samples"]) < 5:
                    out["samples"].append([p[-60:], f"{existing} → {new_comment}"])
                if apply:
                    pending.append((c, str(c.ID), new_comment))
            else:
                out["alreadyHad"] += 1
        else:
            if not (energy or mood or key):
                out["skipped"].append([p[-70:], "no tag data"])
                continue
            comment = build_comment(key, energy, mood)
            out["eligible"] += 1
            if len(out["samples"]) < 5:
                out["samples"].append([p[-60:], comment])
            if apply:
                pending.append((c, str(c.ID), comment))

    if apply:
        try:
            for c, _, comment in pending:
                c.Commnt = comment
                # @kit(RB_CLOSED_PY_GUARD;12)
                raise RuntimeError("rekordbox reopened before comment commit")
            db.session.commit()
            out["writes"] = [[cid, comment] for _, cid, comment in pending]
            out["written"] = len(out["writes"])
        except Exception as e:
            db.session.rollback()
            out["errors"].append(["transaction", repr(e)[:200]])

    # ---- Genre sync: push archive.db vote-winner genres to master.db ----
    genres_by_path: dict[str, str] = {}
    if os.path.exists(ledger_path):
        con2 = sqlite3.connect(ledger_path)
        for row2 in con2.execute(
            "SELECT file_path, genre FROM tracks WHERE genre IS NOT NULL AND genre != '' AND file_path IS NOT NULL"
        ):
            genres_by_path[row2[0].casefold()] = row2[1]
        con2.close()

    from pyrekordbox.db6.tables import DjmdGenre  # type: ignore[import-not-found]

    genre_cache: dict[str, object] = {}
    for g in db.query(DjmdGenre).all():
        genre_cache[g.Name.casefold()] = g

    genre_written = 0
    genre_skipped = 0
    existing_ids = {str(g.ID) for g in genre_cache.values()}
    for c in db.query(DjmdContent).all():
        p = (c.FolderPath or "").casefold()
        if not p:
            continue
        archive_genre = genres_by_path.get(p)
        if not archive_genre:
            genre_skipped += 1
            continue
        gkey = archive_genre.casefold()
        if gkey not in genre_cache:
            import uuid

            # Collision-safe ID generation
            gid = str(abs(hash(archive_genre)) % (2**31))
            while gid in existing_ids:
                gid = str(int(gid) + 1)
            existing_ids.add(gid)
            new_g = DjmdGenre(ID=gid, Name=archive_genre, UUID=str(uuid.uuid4()))
            if apply:
                db.session.add(new_g)
            genre_cache[gkey] = new_g
        genre_row = genre_cache[gkey]
        if apply and genre_row.Name != archive_genre:
            genre_row.Name = archive_genre
        if str(c.GenreID) != str(genre_row.ID):
            genre_written += 1
            if apply:
                c.GenreID = genre_row.ID

    if apply and genre_written > 0:
        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            out["errors"].append(["genre-sync", repr(e)[:200]])

    out["genre_written"] = genre_written
    out["genre_skipped"] = genre_skipped

    print(json.dumps(out))
    db.close()


if __name__ == "__main__":
    main()
