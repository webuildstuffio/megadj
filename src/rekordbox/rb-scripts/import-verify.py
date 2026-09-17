"""rb-import post-verify leg — delayed fresh-process verification.

argv: <dbPath> <filesJson> <playlistId> — verifies imported content
paths exist, counts broken rows, and checks the playlist twin (row
count + track-number contiguity). Emits one JSON verdict.
"""

import json
import os
import sys

from pyrekordbox import Rekordbox6Database as R  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import (  # type: ignore[import-not-found]
    DjmdContent,
    DjmdPlaylist,
    DjmdSongPlaylist,
)


def main() -> None:
    db = R(sys.argv[1])
    files = set(json.loads(sys.argv[2]))
    pid = int(sys.argv[3])
    rows = db.query(DjmdContent).all()
    hit = sum(1 for c in rows if c.FolderPath in files)
    broken = sum(
        1
        for c in rows
        if c.FolderPath
        and not (os.path.exists(c.FolderPath) or os.path.basename(c.FolderPath) in files)
    )
    members = db.query(DjmdSongPlaylist).filter(DjmdSongPlaylist.PlaylistID == pid).all()
    nos = sorted(r.TrackNo for r in members)
    playlist_exists = db.query(DjmdPlaylist).filter(DjmdPlaylist.ID == pid).first() is not None
    print(
        json.dumps(
            {
                "hit": hit,
                "broken": broken,
                "total": len(rows),
                "playlistRows": len(members),
                "contiguous": nos == list(range(1, len(nos) + 1)),
                "playlistExists": playlist_exists,
            }
        )
    )
    db.close()


if __name__ == "__main__":
    main()
