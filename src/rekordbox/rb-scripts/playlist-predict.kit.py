"""rb-playlist dry-run probe (READ-ONLY) — predict the real link count.

argv: <dbPath> <payloadJson> — payload: {chain}. Same matching as the
write leg, from the SAME kit fragments (the drift-prone twin is gone):
powers the dry-run report so the user sees the real link count BEFORE
writing anything. Markers carry NO indentation — PY_MATCH_TRACK_STEP
ships pre-indented at 4 spaces for the `for track in chain:` body.
"""

import json
import os
import sys
import unicodedata

from pyrekordbox import Rekordbox6Database  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdContent  # type: ignore[import-not-found]

db = Rekordbox6Database(sys.argv[1])
chain = json.loads(sys.argv[2])["chain"]

# @kit(pyPathKeyFn)

# @kit(pyContentMatchPreamble)

hit = 0
unmatched = []
for track in chain:
    # @kit(PY_MATCH_TRACK_STEP;4)
    if cid is None and len(candidates) > 1:
        unmatched.append((track["title"] + " (ambiguous filename)")[:100])
        continue
    if cid is None:
        unmatched.append(track["title"][:70])
    else:
        hit += 1
print(json.dumps({"hit": hit, "unmatched": unmatched}))
db.close()
