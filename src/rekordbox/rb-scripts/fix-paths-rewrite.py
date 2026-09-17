"""rb-fix-paths rewrite leg — apply FolderPath rewrites as one transaction.

argv: <dbPath> <updatesJson> — updates are [contentId, fixedPath] pairs.
Per-row commit is avoided deliberately: the whole batch commits once and
rolls back as one transaction on any failure.
"""

import json
import sys

from pyrekordbox import Rekordbox6Database as R  # type: ignore[import-not-found]


def main() -> None:
    db = R(sys.argv[1])
    updates = json.loads(sys.argv[2])
    n = 0
    try:
        for cid, path in updates:
            c = db.get_content(ID=int(cid))
            if c is None:
                raise RuntimeError(f"content row {cid} disappeared before rewrite")
            c.FolderPath = path
            n += 1
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    finally:
        db.close()
    print(json.dumps({"applied": n}))


if __name__ == "__main__":
    main()
