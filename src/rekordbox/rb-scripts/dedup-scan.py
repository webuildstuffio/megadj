"""rb-dedup scan leg — cheap duplicate candidates by title/path/length.

argv: <dbPath> — reads every content row, emits pairs judged duplicates
by same-path / NFC-casefold path-twin / ±2s duration candidate.
"""

import json
import os
import sys
import unicodedata
from typing import Any

from pyrekordbox import db6  # type: ignore[import-not-found]
from pyrekordbox.db6.database import BLOB, deobfuscate  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdContent  # type: ignore[import-not-found]


def main() -> None:
    db = db6.Rekordbox6Database(path=sys.argv[1], key=deobfuscate(BLOB))
    rows: list[dict[str, Any]] = []
    for c in db.query(DjmdContent).all():
        path = c.FolderPath or ""
        try:
            size = os.path.getsize(path) if path else 0
        except OSError:
            size = c.FileSize or 0
        rows.append(
            {
                "id": str(c.ID),
                "title": c.Title or "",
                "path": path,
                "len": c.Length or 0,
                "size": size,
                "bitrate": c.BitRate or 0,
            }
        )
    db.close()

    def norm(s: str) -> str:
        return unicodedata.normalize("NFC", s).casefold().strip()

    by_title: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        key = norm(r["title"])
        if key:
            by_title.setdefault(key, []).append(r)

    pairs: list[dict[str, Any]] = []
    for _key, group in by_title.items():
        if len(group) < 2:
            continue
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                if a["path"] == b["path"]:
                    pairs.append(
                        {**a, "other": b, "basis": "same-path"}
                        if int(a["id"]) < int(b["id"])
                        else {**b, "other": a, "basis": "same-path"}
                    )
                    continue
                if norm(a["path"]) == norm(b["path"]):
                    pairs.append({**a, "other": b, "basis": "path-twin"})
                    continue
                if a["len"] and b["len"] and abs(a["len"] - b["len"]) <= 2:
                    pairs.append({**a, "other": b, "basis": "candidate"})
    print(json.dumps({"scanned": len(rows), "pairs": pairs}))


if __name__ == "__main__":
    main()
