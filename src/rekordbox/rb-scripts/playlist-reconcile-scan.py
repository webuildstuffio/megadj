"""rb-playlist-reconcile scan leg — DB playlists vs XML twin diff feed.

argv: <dbPath> — opens the OneLibrary master read-only and emits every
playlist row as one JSON array (id, name, parentId, attribute, seq).
"""

import json
import sys
from typing import Any

from pyrekordbox import Rekordbox6Database as R  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdPlaylist  # type: ignore[import-not-found]


def main() -> None:
    db = R(sys.argv[1])
    rows: list[dict[str, Any]] = []
    try:
        for p in db.query(DjmdPlaylist).all():
            # Root-level playlists carry ParentID 0 in the DB but their
            # NODE parents resolve to the ROOT element — emit "0" so the
            # TS parser's numeric-parentId contract holds (the XML side
            # maps parent="root" to "0" in parsePlaylistXmlNodes).
            raw_parent = str(p.ParentID or 0)
            rows.append(
                {
                    "id": str(p.ID),
                    "name": p.Name or "",
                    "parentId": "0" if raw_parent == "root" else raw_parent,
                    "attribute": p.Attribute or 0,
                    "seq": p.Seq or 0,
                }
            )
    finally:
        db.close()
    # The parser's boundary contract is {"db": [...]} — never a bare array
    # (a bare list made every reconcile dry-run fail its own payload check).
    print(json.dumps({"db": rows}))


if __name__ == "__main__":
    main()
