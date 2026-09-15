/** Python subprocess programs used by the Rekordbox duplicate workflow.
 *  DB-open boilerplate comes from rb-script-kit (#78). */
import { pyDbOpen, pyDbOpenImports } from "./rb-script-kit.js";

/** Pull content rows and emit cheap duplicate candidates. */
export function dedupScanScript(): string {
  return `
import json, sys, os, unicodedata
${pyDbOpenImports()}
from pyrekordbox.db6.tables import DjmdContent

${pyDbOpen("sys.argv[1]")}
rows = []
for c in db.query(DjmdContent).all():
    path = c.FolderPath or ""
    try:
        size = os.path.getsize(path) if path else 0
    except OSError:
        size = c.FileSize or 0
    rows.append({
        "id": str(c.ID), "title": c.Title or "", "path": path,
        "len": c.Length or 0, "size": size, "bitrate": c.BitRate or 0,
    })
db.close()

def norm(s):
    return unicodedata.normalize("NFC", s).casefold().strip()

by_title = {}
for r in rows:
    key = norm(r["title"])
    if key:
        by_title.setdefault(key, []).append(r)

pairs = []
for key, group in by_title.items():
    if len(group) < 2:
        continue
    for i in range(len(group)):
        for j in range(i + 1, len(group)):
            a, b = group[i], group[j]
            if a["path"] == b["path"]:
                pairs.append({**a, "other": b, "basis": "same-path"}
                             if int(a["id"]) < int(b["id"]) else {**b, "other": a, "basis": "same-path"})
                continue
            if norm(a["path"]) == norm(b["path"]):
                pairs.append({**a, "other": b, "basis": "path-twin"})
                continue
            if a["len"] and b["len"] and abs(a["len"] - b["len"]) <= 2:
                pairs.append({**a, "other": b, "basis": "candidate"})
print(json.dumps({"scanned": len(rows), "pairs": pairs}))
`;
}

/** Rehome loser-owned associations before deleting duplicate rows. */
export function dedupDeleteScript(): string {
  return `
import hashlib, json, sys
${pyDbOpenImports()}
from pyrekordbox.db6.tables import DjmdContent, DjmdCue, DjmdSongPlaylist

cue_identity_fields = {
    "ID", "ContentID", "ContentUUID", "UUID", "rb_data_status",
    "rb_local_data_status", "rb_local_deleted", "rb_local_synced",
    "usn", "rb_local_usn", "created_at", "updated_at",
}
cue_fields = sorted(c.name for c in DjmdCue.__table__.columns
                    if c.name not in cue_identity_fields)

def scalar(value):
    if isinstance(value, bytes):
        return {"bytes": value.hex()}
    if hasattr(value, "isoformat"):
        return {"iso": value.isoformat()}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return repr(value)

def cue_sig(cue):
    values = [[name, scalar(getattr(cue, name, None))] for name in cue_fields]
    payload = json.dumps(values, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()

${pyDbOpen("sys.argv[1]")}
mappings = json.loads(sys.argv[2])
out = {"removed_ids": [], "errors": [], "associations": []}
for cid, keep_id in mappings:
    try:
        loser = db.query(DjmdContent).filter(DjmdContent.ID == cid).first()
        keeper = db.query(DjmdContent).filter(DjmdContent.ID == keep_id).first()
        if loser is None:
            raise RuntimeError("loser content row not found")
        if keeper is None:
            raise RuntimeError("keeper content row not found")

        keeper_memberships = db.query(DjmdSongPlaylist).filter(
            DjmdSongPlaylist.ContentID == keep_id).all()
        playlist_ids = {str(sp.PlaylistID) for sp in keeper_memberships}
        for sp in db.query(DjmdSongPlaylist).filter(
                DjmdSongPlaylist.ContentID == cid).all():
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

        playlists = sorted([[str(sp.PlaylistID), int(sp.TrackNo or 0)]
                            for sp in keeper_memberships])
        cues = sorted(cue_signatures)
        db.session.flush()
        db.delete(loser)
        db.session.commit()
        out["removed_ids"].append(str(cid))
        out["associations"].append({"keep_id": str(keep_id),
                                    "playlists": playlists,
                                    "cue_signatures": cues})
    except Exception as error:
        db.session.rollback()
        out["errors"].append([str(cid), repr(error)[:120]])
db.close()
print(json.dumps(out))
`;
}

/** Freshly read all keeper/loser state needed for post-write verification. */
export function dedupVerifyScript(): string {
  return `
import hashlib, json, sys
${pyDbOpenImports()}
from pyrekordbox.db6.tables import DjmdContent, DjmdCue, DjmdSongPlaylist

cue_identity_fields = {
    "ID", "ContentID", "ContentUUID", "UUID", "rb_data_status",
    "rb_local_data_status", "rb_local_deleted", "rb_local_synced",
    "usn", "rb_local_usn", "created_at", "updated_at",
}
cue_fields = sorted(c.name for c in DjmdCue.__table__.columns
                    if c.name not in cue_identity_fields)

def scalar(value):
    if isinstance(value, bytes):
        return {"bytes": value.hex()}
    if hasattr(value, "isoformat"):
        return {"iso": value.isoformat()}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return repr(value)

def cue_sig(cue):
    values = [[name, scalar(getattr(cue, name, None))] for name in cue_fields]
    payload = json.dumps(values, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()

ids = set(json.loads(sys.argv[2]))
${pyDbOpen("sys.argv[1]")}
rows = []
for c in db.query(DjmdContent).all():
    cid = str(c.ID)
    if cid not in ids:
        continue
    playlists = sorted([[str(sp.PlaylistID), int(sp.TrackNo or 0)]
                        for sp in db.query(DjmdSongPlaylist).filter(DjmdSongPlaylist.ContentID == c.ID).all()])
    cue_rows = db.query(DjmdCue).filter(DjmdCue.ContentID == c.ID).all()
    cues = sorted(cue_sig(cue) for cue in cue_rows)
    cue_owners_valid = all(str(cue.ContentID) == cid and
                           str(cue.ContentUUID) == str(c.UUID)
                           for cue in cue_rows)
    rows.append({"id": cid, "path": c.FolderPath or "",
                 "playlists": playlists, "cue_signatures": cues,
                 "cue_owners_valid": cue_owners_valid})
db.close()
print(json.dumps({"rows": rows}))
`;
}
