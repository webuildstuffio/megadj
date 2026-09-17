// rb-playlist-scripts.ts — rb-playlist's Python program builders + the
// boundary parsers for their JSON stdout (#88 item 2 extraction; the
// command was 790 LOC carrying five families). The scripts interpolate
// the SAME rb-script-kit fragments as rb-import (pyPathKeyFn,
// pyContentMatchPreamble, PY_FIND_PLAYLIST_FN, pyEnsurePlaylistLadder,
// pyAddSongPlaylist, PY_MATCH_TRACK_STEP) so the matching ladder can't
// drift between the write and read-only probe paths.
import {
  PY_FIND_PLAYLIST_FN,
  PY_MATCH_TRACK_STEP,
  pyAddSongPlaylist,
  pyContentMatchPreamble,
  pyEnsurePlaylistLadder,
  pyPathKeyFn,
} from "./rb-script-kit.js";
import {
  isDecimalIdOrNull,
  isStringArray,
  parseJsonBoundary,
} from "./rb-command-kit.js";
import { isRecord, isNonNegativeInteger } from "../../cratedeck/shared/guards";

export const PYRK_TAG =
  "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git@f695541827cc488af267d6ca8a8e0052598d85a0";

export interface PyOut {
  linked: number;
  unmatched: string[];
  playlistId: string | null;
  parentId: string | null;
  errors: string[];
}

export interface PlaylistVerifyOut {
  rows: number;
  contiguous: boolean;
}

export interface MatchPrediction {
  hit: number;
  unmatched: string[];
}

/** Python side: match chain basenames → content IDs, create/link the
 *  playlist. Per-link commit (one bad row never kills the batch);
 *  playlist row committed once; duplicate name is a LOUD error, never a
 *  silent merge. NFC normalization kills the macOS NFD trap that made a
 *  1/60 basename miss ("Hernández" bytes differ across filesystems). */
export function buildScript(): string {
  return `
import json, os, sys, unicodedata, uuid, datetime
from pyrekordbox import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdContent, DjmdPlaylist, DjmdSongPlaylist

db_path, payload = sys.argv[1], json.loads(sys.argv[2])
chain, playlist_name, group_name = payload["chain"], payload["playlist"], payload["group"]
now = datetime.datetime.now()
db = Rekordbox6Database(db_path)

out = {"linked": 0, "unmatched": [], "playlistId": None, "parentId": None, "errors": []}

${pyPathKeyFn()}

# Exact normalized path wins. Basename fallback is allowed only when it is
# unique; duplicate filenames across artist folders are ambiguous and must
# never silently link the arbitrary first row.
${pyContentMatchPreamble()}

content_ids = []
for track in chain:
${PY_MATCH_TRACK_STEP}
    if cid is None and len(candidates) > 1:
        out["unmatched"].append((track["title"] + " (ambiguous filename)")[:100])
        continue
    if cid is None:
        out["unmatched"].append(track["title"][:70])
        continue
    content_ids.append(cid)

${PY_FIND_PLAYLIST_FN}

${pyEnsurePlaylistLadder({ createMissingGroup: true, onExisting: "refuse" })}

track_no = 0
for cid in content_ids:
    try:
        ${pyAddSongPlaylist("sp", "pl.ID", "cid", "track_no + 1").replaceAll("\n", "\n        ")}
        track_no += 1
        out["linked"] += 1
    except Exception as e:
        db.session.rollback()
        out["errors"].append("link %s: %s" % (cid, repr(e)[:120]))

print(json.dumps(out))
db.close()
`;
}

/** Python verify: song-playlist rows under the playlist + TrackNo
 *  contiguity. Read-only. */
export function verifyScript(): string {
  return `
import json, sys
from pyrekordbox import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdSongPlaylist

db = Rekordbox6Database(sys.argv[1])
pid = int(sys.argv[2])
rows = db.query(DjmdSongPlaylist).filter(DjmdSongPlaylist.PlaylistID == pid).all()
nos = sorted(r.TrackNo for r in rows)
contiguous = nos == list(range(1, len(nos) + 1))
print(json.dumps({"rows": len(rows), "contiguous": contiguous}))
db.close()
`;
}

/** Python probe (READ-ONLY): which chain basenames have a content row in
 *  the master — powers the dry-run report so the user sees the real link
 *  count BEFORE writing anything. Same matching as buildScript, from the
 *  SAME rb-script-kit fragments (the drift-prone twin is gone). */
export function predictScript(): string {
  return `
import json, os, sys, unicodedata
from pyrekordbox import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdContent

db = Rekordbox6Database(sys.argv[1])
chain = json.loads(sys.argv[2])["chain"]

${pyPathKeyFn()}

${pyContentMatchPreamble()}

hit = 0
unmatched = []
for track in chain:
${PY_MATCH_TRACK_STEP}
    if cid is None and len(candidates) > 1:
        unmatched.append((track["title"] + " (ambiguous filename)")[:100])
        continue
    if cid is None:
        unmatched.append(track["title"][:70])
    else:
        hit += 1
print(json.dumps({"hit": hit, "unmatched": unmatched}))
db.close()
`;
}

export function parseWriteOutput(raw: string): PyOut {
  const value = parseJsonBoundary(raw, "pyrekordbox playlist write");
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.linked) ||
    !isStringArray(value.unmatched) ||
    !isDecimalIdOrNull(value.playlistId) ||
    !isDecimalIdOrNull(value.parentId) ||
    !isStringArray(value.errors)
  ) {
    throw new Error(
      "pyrekordbox playlist write returned an invalid result payload",
    );
  }
  return {
    linked: value.linked,
    unmatched: value.unmatched,
    playlistId: value.playlistId,
    parentId: value.parentId,
    errors: value.errors,
  };
}

export function parseVerifyOutput(raw: string): PlaylistVerifyOut {
  const value = parseJsonBoundary(raw, "pyrekordbox playlist post-verify");
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.rows) ||
    typeof value.contiguous !== "boolean"
  ) {
    throw new Error(
      "pyrekordbox playlist post-verify returned an invalid result payload",
    );
  }
  return { rows: value.rows, contiguous: value.contiguous };
}

export function parseMatchPrediction(raw: string): MatchPrediction {
  const value = parseJsonBoundary(raw, "pyrekordbox playlist match probe");
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.hit) ||
    !isStringArray(value.unmatched)
  ) {
    throw new Error(
      "pyrekordbox playlist match probe returned an invalid result payload",
    );
  }
  return { hit: value.hit, unmatched: value.unmatched };
}
