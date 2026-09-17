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
import sys

from pyrekordbox import db6  # type: ignore[import-not-found]
from pyrekordbox.db6.database import BLOB, deobfuscate  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdContent  # type: ignore[import-not-found]


def read_txxx(path):
    """Read CAMELOT/ENERGY/MOOD TXXX frames + comment-format fields."""
    try:
        from mutagen import File as MFile

        a = MFile(path, easy=False)
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
    except Exception:
        return None


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
        "alreadyHad": 0,
        "skipped": [],
        "samples": [],
        "writes": [],
        "errors": [],
    }
    pending = []
    for c in rows:
        p = c.FolderPath or ""
        if (c.Commnt or "").strip():
            out["alreadyHad"] += 1
            continue
        if not os.path.exists(p):
            out["skipped"].append([p[-70:], "file missing"])
            continue
        tags = read_txxx(p)
        key = (tags or {}).get("key", "")
        energy = (tags or {}).get("energy", "")
        mood = (tags or {}).get("mood", "")
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
                    except Exception:
                        pass
                mood = "+".join(tops[:3])
        if not (energy or mood or key):
            out["skipped"].append([p[-70:], "no tag data"])
            continue
        epart = f"E{energy}" if energy else ""
        parts = [x for x in (key, epart, mood) if x]
        comment = " · ".join(parts)
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

    print(json.dumps(out))
    db.close()


if __name__ == "__main__":
    main()
