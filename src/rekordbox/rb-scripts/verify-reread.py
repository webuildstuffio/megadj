"""Delayed re-read verification — a COMMIT is not proof, the re-read is.

argv: <dbPath> <table> <predicate> — dumps every row of `table`, then
evaluates the caller's Python predicate expression per row (zip order =
row order) and reports failing row IDs.
"""

import importlib
import json
import sys

from pyrekordbox import db6  # type: ignore[import-not-found]
from pyrekordbox.db6.database import BLOB, deobfuscate  # type: ignore[import-not-found]


def main() -> None:
    db_path, table = sys.argv[1], sys.argv[2]
    db = db6.Rekordbox6Database(path=db_path, key=deobfuscate(BLOB))
    mod = importlib.import_module("pyrekordbox.db6.tables")
    cls = getattr(mod, table)
    rows = [dict(c.__dict__) for c in db.query(cls).all()]
    db.close()
    pred = eval(sys.argv[3])
    failures = [str(r.get("ID")) for r, ok in zip(rows, pred, strict=False) if not ok]
    print(json.dumps({"total": len(rows), "failures": failures[:50]}))


if __name__ == "__main__":
    main()
