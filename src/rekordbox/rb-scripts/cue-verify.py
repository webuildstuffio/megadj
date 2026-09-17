"""rb-cues re-read verify leg — cue Kind restamp took, nothing else moved.

argv: <dbPath> — stdin carries the expected content IDs as a JSON array.
Verifies every intended row now reads Kind=1, counts survivors and
missing/mismatched rows for the caller's hard failure.
"""

import json
import sys

from pyrekordbox import db6  # type: ignore[import-not-found]
from pyrekordbox.db6.database import BLOB, deobfuscate  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdCue  # type: ignore[import-not-found]


def main() -> None:
    expected = [str(i) for i in json.load(sys.stdin)]
    db = db6.Rekordbox6Database(path=sys.argv[1], key=deobfuscate(BLOB))
    rows = (
        db.query(DjmdCue).filter(DjmdCue.ID.in_([int(i) for i in expected])).all()
        if expected
        else []
    )
    actual = {str(row.ID): int(row.Kind) for row in rows}
    remaining = sum(1 for i in expected if actual.get(i) == 0)
    db.close()
    missing = sorted(i for i in expected if i not in actual)
    mismatched = [[i, actual[i]] for i in expected if i in actual and actual[i] != 1]
    matched = sum(1 for i in expected if actual.get(i) == 1)
    print(
        json.dumps(
            {
                "total": len(actual),
                "matched": matched,
                "remaining": remaining,
                "missing": missing,
                "mismatched": mismatched,
            }
        )
    )


if __name__ == "__main__":
    main()
