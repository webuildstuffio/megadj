/**
 * rb-script-kit — THE python-script boilerplate seam (#78). The embedded
 * pyrekordbox scripts under src/rekordbox repeat the same open block as
 * string literals: the `deobfuscate(BLOB)` import pair and the
 * `Rekordbox6Database(path=…, key=deobfuscate(BLOB))` construction. Nine
 * strings used to carry the RB7 key-handling rule; a pyrekordbox API
 * change meant nine edits, and a missed one made that command silently
 * fail its DB open. The rule now lives HERE once and every script
 * interpolates it.
 *
 * Not every rb-* script opens the same way on purpose: rb-playlist's
 * pinned-fork scripts (`pyrekordbox @ git+…`) construct the DB without an
 * explicit key (`Rekordbox6Database(db_path)`) because the fork resolves
 * it internally — those stay as-is, guarded by a different string.
 */

/** The two import lines every deobfuscate-open script needs. */
export function pyDbOpenImports(): string {
  return `from pyrekordbox.db6.database import deobfuscate, BLOB
from pyrekordbox import db6`;
}

/** The canonical open: `db = db6.Rekordbox6Database(path=<pathExpr>,
 * key=deobfuscate(BLOB))`. `pathExpr` is interpolated verbatim — pass
 * `sys.argv[1]` or a python variable name (`db_path`), exactly as the
 * script would have written it. */
export function pyDbOpen(pathExpr: string): string {
  return `db = db6.Rekordbox6Database(path=${pathExpr}, key=deobfuscate(BLOB))`;
}

/** Import + open in one block, for scripts whose first statement after
 *  the stdlib imports is the open (the majority shape). */
export function pyDbOpenBlock(pathExpr: string): string {
  return `${pyDbOpenImports()}
${pyDbOpen(pathExpr)}`;
}

// ---------------------------------------------------------------------------
// Shared Python PROGRAM bodies (the statement-level twins). These are for
// the Rekordbox6Database(db_path) scripts (rb-import/rb-playlist family,
// the pinned fork) — the deobfuscate family interpolates pyDbOpen above.
// ---------------------------------------------------------------------------

/** NFC normalize + casefold path key — the macOS NFD-trap killer. Every
 *  content-path match in every rb script MUST go through this one rule;
 *  a script that skips it re-creates the 1/60 "Hernández" basename miss. */
export function pyPathKeyFn(withNfc = true): string {
  return `${
    withNfc
      ? `def nfc(s):
    return unicodedata.normalize("NFC", s) if s else s

`
      : ""
  }def path_key(s):
    return nfc(s).casefold()`;
}

/** The pinned-fork random-ID fallback (upstream may or may not expose
 *  random_id; both shapes produce a positive 31-bit int). */
export const PY_RID_FN = `def rid():
    return db.random_id() if hasattr(db, "random_id") else int.from_bytes(os.urandom(4), "big") & 0x7FFFFFFF`;

/** Root-only playlist finder: exact (Name, Attribute, ParentID) match with
 *  the str()-coerced parent comparison that keeps sqlite ints and python
 *  ints from disagreeing. The pinned test asserts these exact lines. */
export const PY_FIND_PLAYLIST_FN = `def find_playlist(name, attr, parent_id):
    parent = None if parent_id == 0 else db.query(DjmdPlaylist).filter(DjmdPlaylist.ID == parent_id).first()
    expected_parent_id = parent.ID if parent is not None else 0
    q = db.query(DjmdPlaylist).filter(
        DjmdPlaylist.Name == name,
        DjmdPlaylist.Attribute == attr,
        DjmdPlaylist.ParentID == parent_id,
    )
    for p in q.all():
        if str(p.ParentID or 0) == str(expected_parent_id):
            return p
    return None`;

/** The by-path/by-basename content matcher preamble: exact case-folded
 *  path wins; basename fallback only when unique (duplicate basenames are
 *  ambiguous and must never silently link the arbitrary first row); the
 *  FileNameL 60-char clip is tolerated. Shared by rb-playlist's write and
 *  dry-run predict programs — one matching rule, one drift surface. */
export function pyContentMatchPreamble(): string {
  return `by_path = {}
by_base = {}
for c in db.query(DjmdContent).all():
    if c.FolderPath:
        path = path_key(c.FolderPath)
        by_path.setdefault(path, c.ID)
        b = path_key(os.path.basename(path))
        by_base.setdefault(b, []).append(c.ID)`;
}

/** One chain-track match step against the by_path/by_base maps the
 *  preamble above built (same maps, same rule, both callers). */
export const PY_MATCH_TRACK_STEP = `    path = path_key(track["path"])
    base = path_key(track["base"])
    cid = by_path.get(path)
    candidates = by_base.get(base, []) if cid is None else []
    if cid is None and not candidates and len(base) > 60:
        # tolerate the FileNameL 60-char clip ("..." suffix), still unique-only
        candidates = by_base.get(base[:57] + "...", [])
    if cid is None and len(candidates) == 1:
        cid = candidates[0]`;

/** The cue-fingerprint block the dedup delete + verify scripts share:
 *  identity-field exclusion, scalar coercion, and the sha256 cue_sig the
 *  merge/verify legs compare. Delete and verify MUST fingerprint cues the
 *  same way — a drift between the two made verify disagree with what
 *  delete actually wrote (the twin this seam removes). */
export const PY_CUE_SIG_BLOCK = `cue_identity_fields = {
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
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()`;

export const pyCueSigBlock = (): string => PY_CUE_SIG_BLOCK;
