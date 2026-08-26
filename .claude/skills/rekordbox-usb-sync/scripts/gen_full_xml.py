#!/usr/bin/env python3
"""Generate a complete rekordbox XML (3,054 tracks + all 154 playlists) from the
OneLibrary exportLibrary.db, for import into rekordbox 7 followed by a proper
USB export (which writes BOTH export.pdb for the XDJ-XZ AND exportLibrary.db).
"""
import os
import xml.etree.ElementTree as ET
from xml.dom import minidom

DB = "/tmp/usb-sync/nm_current.db"
OUT = os.path.expanduser("~/rekordbox-exports/full_library.xml")
VOL = "DJMASTER"

from pyrekordbox.devicelib_plus.database import DeviceLibraryPlus
from pyrekordbox.devicelib_plus.models import (
    Artist,
    Content,
    Playlist,
    PlaylistContent,
)

db = DeviceLibraryPlus(DB)

artists = {a.artist_id: (a.name or "") for a in db.query(Artist).all()}
tracks = {}
order = []
for c in db.query(Content).order_by(Content.content_id).all():
    tracks[c.content_id] = c
    order.append(c.content_id)
print(f"tracks: {len(order)}")

playlists = {p.playlist_id: p for p in db.query(Playlist).all()}
entries = {}
for e in db.query(PlaylistContent).order_by(PlaylistContent.sequenceNo).all():
    entries.setdefault(e.playlist_id, []).append(e.content_id)
print(f"playlists: {len(playlists)}, entries: {sum(len(v) for v in entries.values())}")

root = ET.Element("DJ_PLAYLISTS", {"Version": "1.0.0"})
ET.SubElement(root, "PRODUCT", {"Name": "Crate Recovery", "Version": "2.0", "Company": "recovery"})
coll = ET.SubElement(root, "COLLECTION", {"Total": str(len(order))})

from pyrekordbox.rbxml import encode_path

for cid in order:
    c = tracks[cid]
    artist = artists.get(c.artist_id_artist, "")
    d, fn = os.path.split(c.path.lstrip("/"))
    full = f"/Volumes/{VOL}{c.path}"
    t = ET.SubElement(coll, "TRACK", {
        "TrackID": str(cid),
        "Name": (c.title or fn)[:255],
        "Artist": artist[:255],
        "Location": encode_path(full),
    })
    if c.bpmx100:
        t.set("AverageBpm", f"{c.bpmx100/100:.2f}")
    if c.length:
        t.set("TotalTime", str(int(c.length)))

pls = ET.SubElement(root, "PLAYLISTS")
root_node = ET.SubElement(pls, "NODE", {"Name": "ROOT", "Type": "0", "KeyType": "0"})

def emit(p, parent):
    attr = p.attribute
    node = ET.SubElement(parent, "NODE", {"Name": (p.name or "Playlist")[:255]})
    if attr == 1:  # folder — rekordbox XML: Type 0 = folder, 1 = playlist
        node.set("Type", "0")
        node.set("KeyType", "0")
        for child in sorted(playlists.values(), key=lambda x: x.sequenceNo or 0):
            if child.playlist_id_parent == p.playlist_id:
                emit(child, node)
    else:          # playlist leaf with TrackID-keyed entries
        node.set("Type", "1")
        node.set("KeyType", "0")
        for cid in entries.get(p.playlist_id, []):
            ET.SubElement(node, "TRACK", {"Key": str(cid)})

tops = [p for p in sorted(playlists.values(), key=lambda x: x.sequenceNo or 0)
        if not p.playlist_id_parent or p.playlist_id_parent not in playlists]
seen = set()
for p in tops:
    if p.playlist_id in seen:
        continue
    seen.add(p.playlist_id)
    emit(p, root_node)

xml = ET.tostring(root, encoding="unicode")
dom = minidom.parseString(xml)
with open(OUT, "w") as f:
    dom.writexml(f, indent="", addindent="  ", newl="\n")
print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")

# validate: tracks + playlist entries via ElementTree
tree = ET.parse(OUT)
n = len(tree.getroot().find("COLLECTION").findall("TRACK"))
pl_root = tree.getroot().find("PLAYLISTS").find("NODE")
leafs, total = [], 0
def walkn(node):
    global total
    for c in node.findall("NODE"):
        if c.get("Type") == "1":
            keys = [t.get("Key") for t in c.findall("TRACK")]
            leafs.append((c.get("Name"), len(keys)))
            total += len(keys)
        else:
            walkn(c)
walkn(pl_root)
print(f"round-trip: {n} collection tracks, {len(leafs)} leaf playlists, {total} playlist entries")
assert n == len(order) and total == sum(len(v) for v in entries.values())
ids = {t.get("TrackID") for t in tree.getroot().find("COLLECTION").findall("TRACK")}
missing_keys = 0
def check_keys(node):
    global missing_keys
    for c in node.findall("NODE"):
        if c.get("Type") == "1":
            for t in c.findall("TRACK"):
                if t.get("Key") not in ids:
                    missing_keys += 1
        else:
            check_keys(c)
check_keys(pl_root)
print(f"dangling playlist keys: {missing_keys}")
assert missing_keys == 0
print("XML VALID")
