"""rb-comment-sync verify leg — comment rewrite took on every target row.

argv: <dbPath> — stdin carries [id, expectedComment] rows. Reports
matched/missing/mismatched counts so the caller can fail closed.
"""

import json
import sys

from pyrekordbox import db6  # type: ignore[import-not-found]
from pyrekordbox.db6.database import BLOB, deobfuscate  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdContent  # type: ignore[import-not-found]


def main() -> None:
    expected = {str(row[0]): str(row[1]) for row in json.load(sys.stdin)}
    db = db6.Rekordbox6Database(path=sys.argv[1], key=deobfuscate(BLOB))
    rows = (
        db.query(DjmdContent).filter(DjmdContent.ID.in_([int(i) for i in expected])).all()
        if expected
        else []
    )
    actual = {str(row.ID): str(row.Commnt or "") for row in rows}
    db.close()
    missing = sorted(i for i in expected if i not in actual)
    mismatched = [
        [i, expected[i], actual[i]] for i in expected if i in actual and actual[i] != expected[i]
    ]
    matched = sum(1 for i in expected if actual.get(i) == expected[i])
    print(
        json.dumps(
            {
                "total": len(actual),
                "matched": matched,
                "missing": missing,
                "mismatched": mismatched,
            }
        )
    )


if __name__ == "__main__":
    main()
