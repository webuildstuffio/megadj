"""rb-import write leg — one spawn does the whole import job.

argv: <dbPath> <payloadJson> — payload: {files: 12-field rows, playlist,
group, gated}. Idempotent: skips files that already have a content row
OR were refused by the F11 dupe gate the caller resolved; per-row
commit; playlist per folder; rows returned for verification.

Kit fragments (#@kit markers rendered by rb-command-kit at spawn) keep
the matching ladder / playlist ladder identical to rb-playlist's.
"""

import datetime
import json
import os
import sys
import unicodedata
import uuid

from pyrekordbox import Rekordbox6Database  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import (  # type: ignore[import-not-found]
    DjmdArtist,
    DjmdContent,
    DjmdPlaylist,
    DjmdSongPlaylist,
)

db_path, payload = sys.argv[1], json.loads(sys.argv[2])
files, playlist_name, group_name = payload["files"], payload["playlist"], payload["group"]
gate = {d[0] for d in payload.get("gated", [])}
now = datetime.datetime.now()
db = Rekordbox6Database(db_path)

out = {
    "inserted": 0,
    "already": 0,
    "linked": 0,
    "gated": 0,
    "playlistId": None,
    "parentId": None,
    "errors": [],
}

# @kit(pyPathKeyFn)

existing = {}
for c in db.query(DjmdContent).all():
    if c.FolderPath:
        existing[path_key(c.FolderPath)] = c.ID

# --- playlist (child of group when given) ---
# @kit(PY_FIND_PLAYLIST_FN)

# @kit(PY_RID_FN)

# @kit(pyEnsurePlaylistLadder false|reuse)

track_no = db.query(DjmdSongPlaylist).filter(DjmdSongPlaylist.PlaylistID == pl.ID).count()
playlist_content = {
    r.ContentID
    for r in db.query(DjmdSongPlaylist).filter(DjmdSongPlaylist.PlaylistID == pl.ID).all()
}

master_db_id = ""
c0 = db.query(DjmdContent).first()
if c0 is not None and getattr(c0, "MasterDBID", None):
    master_db_id = c0.MasterDBID

device_id = "adeae5be-3cc0-4f1d-bb8a-cf6c61c01bdf"

for f in files:
    full, fname, title, artist, album, genre, year, duration, bitrate, bpm, key, fp = f
    cid = existing.get(path_key(full))
    if cid is not None:
        out["already"] += 1
    elif full in gate:
        # F11 dupe gate: the caller proved this file duplicates an
        # existing recording (fingerprint or NFC path match) and the
        # run is not --allow-dupe. Counted, never silently imported.
        out["gated"] += 1
    else:
        try:
            ext = os.path.splitext(fname)[1].lower()
            file_type = {
                ".mp3": 1,
                ".wav": 11,
                ".aiff": 12,
                ".aif": 12,
                ".flac": 14,
                ".m4a": 5,
                ".aac": 5,
            }.get(ext, 0)
            clip = fname if len(fname) <= 60 else fname[:57] + "..."
            art_id = None
            if artist:
                a = db.query(DjmdArtist).filter(DjmdArtist.Name == artist).first()
                if a is None:
                    aid = rid()
                    a = DjmdArtist(
                        ID=aid, Name=artist, UUID=str(uuid.uuid4()), created_at=now, updated_at=now
                    )
                    db.add(a)
                    db.session.commit()
                art_id = a.ID
            cid = rid()
            row = DjmdContent(
                ID=cid,
                FolderPath=full,
                FileNameL=clip,
                Title=title or fname,
                ArtistID=art_id,
                AlbumID=None,
                GenreID=None,
                BPM=bpm,
                Length=duration,
                BitRate=bitrate,
                BitDepth=0,
                FileType=file_type,
                Rating=0,
                ReleaseYear=year,
                KeyID=None,
                StockDate=now.strftime("%Y-%m-%d"),
                ColorID=0,
                MasterDBID=master_db_id,
                UUID=str(uuid.uuid4()),
                FileSize=os.path.getsize(full) if os.path.exists(full) else 0,
                SearchStr=(title or "") + " " + (artist or ""),
                Commnt="",
                SamplerGain=0.0,
                VideoAssociate=0,
                Lyricist="",
                ServiceID=0,
                OrgFolderPath="",
                Reserved1="",
                Reserved2="",
                Reserved3="",
                Reserved4="",
                ExtInfo="null",
                DeviceID=device_id,
                SrcID=0,
                SrcTitle="",
                SrcArtistName="",
                SrcAlbumName="",
                SrcLength=0,
                rb_data_status=0,
                rb_local_data_status=0,
                rb_local_deleted=0,
                rb_local_synced=0,
                usn=None,
                rb_local_usn=0,
                created_at=now,
                updated_at=now,
            )
            db.add(row)
            db.session.commit()
            out["inserted"] += 1
            existing[path_key(full)] = cid
        except Exception as e:
            db.session.rollback()
            out["errors"].append([os.path.basename(full)[:60], repr(e)[:140]])
            continue
    try:
        if cid not in playlist_content:
            # playlist membership for both new and already-imported content
            # so re-runs repair an incomplete batch playlist idempotently.
            # (pyAddSongPlaylist ships at 12-space indent for this depth)
            # @kit(pyAddSongPlaylist;12)
            track_no += 1
            playlist_content.add(cid)
            out["linked"] += 1
    except Exception as e:
        db.session.rollback()
        out["errors"].append([os.path.basename(full)[:60], repr(e)[:140]])

print(json.dumps(out))
db.close()
