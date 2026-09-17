"""rb-dedup delete leg — rehome associations, then delete loser rows.

argv: <dbPath> <mappingsJson> — mappings are [loserId, keepId] pairs.
Playlist memberships are re-pointed (deduped against the keeper's set);
keeper cues win signature conflicts; loser-only hot cues merge under
rekordbox's 8-hot-cue limit. Per-loser transaction.

Kit fragments (#@kit markers rendered by rb-command-kit at spawn): the
cue-signature block is THE shared fingerprint — delete and verify legs
must cue_sig identically or verify disagrees with what delete wrote.
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

mappings = json.loads(sys.argv[2])
out = {"removed_ids": [], "errors": [], "associations": []}


def main() -> None:
    db = db6.Rekordbox6Database(path=sys.argv[1], key=deobfuscate(BLOB))
    for cid, keep_id in mappings:
        try:
            loser = db.query(DjmdContent).filter(DjmdContent.ID == cid).first()
            keeper = db.query(DjmdContent).filter(DjmdContent.ID == keep_id).first()
            if loser is None:
                raise RuntimeError("loser content row not found")
            if keeper is None:
                raise RuntimeError("keeper content row not found")

            keeper_memberships = (
                db.query(DjmdSongPlaylist).filter(DjmdSongPlaylist.ContentID == keep_id).all()
            )
            playlist_ids = {str(sp.PlaylistID) for sp in keeper_memberships}
            for sp in db.query(DjmdSongPlaylist).filter(DjmdSongPlaylist.ContentID == cid).all():
                playlist_id = str(sp.PlaylistID)
                if playlist_id in playlist_ids:
                    db.delete(sp)
                else:
                    sp.ContentID = keep_id
                    keeper_memberships.append(sp)
                    playlist_ids.add(playlist_id)

            keeper_cue_rows = db.query(DjmdCue).filter(DjmdCue.ContentID == keep_id).all()
            keeper_cues = [cue for cue in keeper_cue_rows if int(cue.Kind or 0) == 1]
            cue_signatures = {cue_sig(cue) for cue in keeper_cue_rows}
            for cue in db.query(DjmdCue).filter(DjmdCue.ContentID == cid).all():
                signature = cue_sig(cue)
                if signature in cue_signatures:
                    db.delete(cue)
                else:
                    if int(cue.Kind or 0) == 1:
                        if len(keeper_cues) >= 8:
                            raise RuntimeError("cue merge would exceed rekordbox's 8-hot-cue limit")
                        keeper_cues.append(cue)
                    cue.ContentID = keep_id
                    cue.ContentUUID = keeper.UUID
                    cue_signatures.add(signature)

            playlists = sorted(
                [[str(sp.PlaylistID), int(sp.TrackNo or 0)] for sp in keeper_memberships]
            )
            cues = sorted(cue_signatures)
            db.session.flush()
            db.delete(loser)
            db.session.commit()
            out["removed_ids"].append(str(cid))
            out["associations"].append(
                {"keep_id": str(keep_id), "playlists": playlists, "cue_signatures": cues}
            )
        except Exception as error:
            db.session.rollback()
            out["errors"].append([str(cid), repr(error)[:120]])
    db.close()
    print(json.dumps(out))


if __name__ == "__main__":
    main()
