"""rb-fix-paths read leg — [id, FolderPath] pairs for every content row."""

import json
import sys

from pyrekordbox import Rekordbox6Database as R  # type: ignore[import-not-found]


def main() -> None:
    db = R(sys.argv[1])
    rows = [(str(c.ID), c.FolderPath or "") for c in db.get_content()]
    print(json.dumps(rows))
    db.close()


if __name__ == "__main__":
    main()
