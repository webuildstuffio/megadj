"""rb-playlist post-verify leg — membership + TrackNo contiguity.

argv: <dbPath> <playlistId> — read-only count of the playlist's
song-playlist rows plus a TrackNo contiguity check (1..N, no gaps).
"""

import json
import sys

from pyrekordbox import Rekordbox6Database  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdSongPlaylist  # type: ignore[import-not-found]

db = Rekordbox6Database(sys.argv[1])
pid = int(sys.argv[2])
rows = db.query(DjmdSongPlaylist).filter(DjmdSongPlaylist.PlaylistID == pid).all()
nos = sorted(r.TrackNo for r in rows)
contiguous = nos == list(range(1, len(nos) + 1))
print(json.dumps({"rows": len(rows), "contiguous": contiguous}))
db.close()
