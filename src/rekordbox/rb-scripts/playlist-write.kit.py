"""rb-playlist write leg — match chain, create/link the playlist.

argv: <dbPath> <payloadJson> — payload: {chain, playlist, group}.
Per-link commit (one bad row never kills the batch); playlist row
committed once; duplicate name is a LOUD error, never a silent merge.
NFC normalization kills the macOS NFD trap that made a 1/60 basename
miss ("Hernández" bytes differ across filesystems).

Kit fragments (#@kit markers rendered by rb-command-kit at spawn) are
the SAME rb-script-kit fragments rb-import interpolates, so the matching
ladder can't drift between the write and read-only probe paths.

NOTE: markers here carry NO indentation — the fragments are written to
land at column 0 (PY_MATCH_TRACK_STEP ships pre-indented at 4 spaces).
"""

import datetime
import json
import os
import sys
import unicodedata
import uuid

from pyrekordbox import Rekordbox6Database  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import (  # type: ignore[import-not-found]
    DjmdContent,
    DjmdPlaylist,
    DjmdSongPlaylist,
)

db_path, payload = sys.argv[1], json.loads(sys.argv[2])
chain, playlist_name, group_name = payload["chain"], payload["playlist"], payload["group"]
now = datetime.datetime.now()
db = Rekordbox6Database(db_path)

out = {"linked": 0, "unmatched": [], "playlistId": None, "parentId": None, "errors": []}

# @kit(pyPathKeyFn)

# @kit(PY_RID_FN)

# Exact normalized path wins. Basename fallback is allowed only when it is
# unique; duplicate filenames across artist folders are ambiguous and must
# never silently link the arbitrary first row.
# @kit(pyContentMatchPreamble)

content_ids = []
for track in chain:
    # @kit(PY_MATCH_TRACK_STEP;4)
    if cid is None and len(candidates) > 1:
        out["unmatched"].append((track["title"] + " (ambiguous filename)")[:100])
        continue
    if cid is None:
        out["unmatched"].append(track["title"][:70])
        continue
    content_ids.append(cid)

# @kit(PY_FIND_PLAYLIST_FN)

# @kit(pyEnsurePlaylistLadder true|refuse)

track_no = 0
for cid in content_ids:
    try:
        # @kit(pyAddSongPlaylist;8)
        track_no += 1
        out["linked"] += 1
    except Exception as e:
        db.session.rollback()
        out["errors"].append(f"link {cid}: {repr(e)[:120]}")

print(json.dumps(out))
db.close()
