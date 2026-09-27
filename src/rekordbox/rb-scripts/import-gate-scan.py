"""rb-import gate-scan leg — fingerprint/dupe-gate candidate scan.

argv: <dbPath> <payloadJson> — payload carries the incoming files; emits
the gate's candidate report as one JSON object. Path matching goes
through the shared NFC+casefold path_key (the macOS NFD-trap killer).
"""

import json
import re
import sys
import unicodedata
from typing import Any

from pyrekordbox import Rekordbox6Database  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdContent  # type: ignore[import-not-found]


def nfc(s: str | None) -> str | None:
    return unicodedata.normalize("NFC", s) if s else s


def path_key(s: str) -> str:
    normalized = nfc(s)
    return normalized.casefold() if normalized else ""


_DUPE_SUFFIX = re.compile(r" \[(?:archive(?: \d+)?|BACKUP2)]")


def stem_key(s: str) -> str:
    """path_key with [archive N] and [BACKUP2] suffixes stripped.

    Without this, an existing `Track.m4a` row and an incoming
    `Track [archive].m4a` or `Track [BACKUP2].m4a` are invisible
    to each other and both get imported (Sep 26 audit: 34 archive
    + 60 BACKUP2 groups of this class).
    """
    return path_key(_DUPE_SUFFIX.sub("", s))


def main() -> None:
    db_path, payload = sys.argv[1], json.loads(sys.argv[2])
    incoming = {str(f[0]): float(f[1] or 0) for f in payload["files"]}

    db = Rekordbox6Database(db_path)
    existing: list[tuple[str, str, float, str, str]] = []
    for c in db.query(DjmdContent).all():
        if not c.FolderPath:
            continue
        dur = float(c.Length) if c.Length else 0.0
        existing.append(
            (str(c.ID), str(c.FolderPath), dur, path_key(c.FolderPath), stem_key(c.FolderPath))
        )
    db.close()

    candidates: list[dict[str, Any]] = []
    for full, dur in incoming.items():
        key = path_key(full)
        skey = stem_key(full)
        for row_id, path, e_dur, e_key, e_skey in existing:
            if e_key == key:
                # (a) NFC+casefold path proof — same file row already
                candidates.append(
                    {"rowId": row_id, "path": path, "duration": e_dur, "targets": [full]}
                )
            elif e_skey == skey:
                # (a2) [archive]-aware stem match — incoming "Track [archive].m4a"
                # matches existing "Track.m4a" (Sep 26 fix)
                candidates.append(
                    {"rowId": row_id, "path": path, "duration": e_dur, "targets": [full]}
                )
            elif abs(e_dur - dur) <= 2.0:
                # (b) duration candidate — TS fingerprints this row's file
                candidates.append({"rowId": row_id, "path": path, "duration": e_dur, "targets": []})

    print(json.dumps({"candidates": candidates}))


if __name__ == "__main__":
    main()
