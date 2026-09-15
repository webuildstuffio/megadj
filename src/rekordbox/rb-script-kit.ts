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
