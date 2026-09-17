"""rb-dedup verify leg — fresh read of keeper/loser state post-write.

argv: <dbPath> <idsJson> — for every id in the set: memberships, cue
signatures (cue_sig MUST match the delete leg — kit-shared), and
cue-ownership validity (ContentID + ContentUUID both consistent).
"""

import hashlib
import json
import sys

from pyrekordbox import db6  # type: ignore[import-not-found]
from pyrekordbox.db6.database import BLOB, deobfuscate  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import (  # type: ignore[import-not-found]
    DjmdContent,
    DjmdCue,
    DjmdSongPlaylist,
)

# @kit(PY_CUE_SIG_BLOCK)


def main() -> None:
    ids = set(json.loads(sys.argv[2]))
    db = db6.Rekordbox6Database(path=sys.argv[1], key=deobfuscate(BLOB))
    rows = []
    for c in db.query(DjmdContent).all():
        cid = str(c.ID)
        if cid not in ids:
            continue
        playlists = sorted(
            [
                [str(sp.PlaylistID), int(sp.TrackNo or 0)]
                for sp in db.query(DjmdSongPlaylist)
                .filter(DjmdSongPlaylist.ContentID == c.ID)
                .all()
            ]
        )
        cue_rows = db.query(DjmdCue).filter(DjmdCue.ContentID == c.ID).all()
        cues = sorted(cue_sig(cue) for cue in cue_rows)
        cue_owners_valid = all(
            str(cue.ContentID) == cid and str(cue.ContentUUID) == str(c.UUID) for cue in cue_rows
        )
        rows.append(
            {
                "id": cid,
                "path": c.FolderPath or "",
                "playlists": playlists,
                "cue_signatures": cues,
                "cue_owners_valid": cue_owners_valid,
            }
        )
    db.close()
    print(json.dumps({"rows": rows}))


if __name__ == "__main__":
    main()
