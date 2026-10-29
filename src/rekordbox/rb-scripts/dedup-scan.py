"""rb-dedup scan leg — cheap duplicate candidates by title/path/length.

argv: <dbPath> — reads every content row, emits pairs judged duplicates
by same-path / NFC-casefold path-twin / stem-key twin / ±2s duration
candidate. Sep 26 hardening: strips [archive N], [BACKUP2], and trailing
(N) dupe suffixes from BOTH titles and filenames before grouping, so
shelf-sync and legacy-backup twins surface as candidates.
"""

import json
import os
import re
import sys
import unicodedata
from typing import Any

from pyrekordbox import db6  # type: ignore[import-not-found]
from pyrekordbox.masterdb.database import BLOB, deobfuscate  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdContent  # type: ignore[import-not-found]

_DUPE_SUFFIX = re.compile(r"\s*\[(?:archive(?: \d+)?|BACKUP2)]")
_TRAILING_NUM = re.compile(r"\(\d+\)$")


def norm(s: str) -> str:
    return unicodedata.normalize("NFC", s).casefold().strip()


def clean_title(t: str) -> str:
    """Normalize a title for dupe-grouping: NFC+casefold, strip dupe suffixes."""
    t = _DUPE_SUFFIX.sub("", t)
    t = _TRAILING_NUM.sub("", t)
    return norm(t.strip())


def stem_key(path: str) -> str:
    """NFC+casefold filename stem with dupe suffixes stripped."""
    name = os.path.splitext(os.path.basename(path))[0]
    name = _DUPE_SUFFIX.sub("", name)
    name = _TRAILING_NUM.sub("", name)
    return norm(name.strip())


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

    # Group by CLEANED title (strips [archive], [BACKUP2], trailing (N))
    by_title: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        key = clean_title(r["title"])
        if key:
            by_title.setdefault(key, []).append(r)

    # Also group by cleaned filename stem (catches files with different
    # title metadata but same stem, e.g. artist-in-title vs clean title)
    by_stem: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        if not r["path"]:
            continue
        key = stem_key(r["path"])
        if key and len(key) > 3:
            by_stem.setdefault(key, []).append(r)

    seen_pair_ids: set[tuple[str, str]] = set()
    pairs: list[dict[str, Any]] = []

    def add_pair(a: dict[str, Any], b: dict[str, Any], basis: str) -> None:
        pair_key = (min(a["id"], b["id"]), max(a["id"], b["id"]))
        if pair_key in seen_pair_ids:
            return
        seen_pair_ids.add(pair_key)
        pairs.append({**a, "other": b, "basis": basis})

    # Title-group pairs
    for _key, group in by_title.items():
        if len(group) < 2:
            continue
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                if a["path"] == b["path"]:
                    add_pair(
                        a if int(a["id"]) < int(b["id"]) else b,
                        b if int(a["id"]) < int(b["id"]) else a,
                        "same-path",
                    )
                    continue
                if norm(a["path"]) == norm(b["path"]):
                    add_pair(a, b, "path-twin")
                    continue
                if a["len"] and b["len"] and abs(a["len"] - b["len"]) <= 2:
                    add_pair(a, b, "candidate")

    # Stem-group pairs (catches cross-title dupes from filename stems)
    for _key, group in by_stem.items():
        if len(group) < 2:
            continue
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                if a["path"] != b["path"] and norm(a["path"]) != norm(b["path"]):
                    add_pair(a, b, "stem-twin")

    print(json.dumps({"scanned": len(rows), "pairs": pairs}))


if __name__ == "__main__":
    main()
