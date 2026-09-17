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
            rows.append(
                {
                    "id": str(p.ID),
                    "name": p.Name or "",
                    "parentId": str(p.ParentID or 0),
                    "attribute": p.Attribute or 0,
                    "seq": p.Seq or 0,
                }
            )
    finally:
        db.close()
    print(json.dumps(rows))


if __name__ == "__main__":
    main()
