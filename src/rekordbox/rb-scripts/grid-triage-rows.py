"""grid-triage rows leg — content rows + ANLZ hash dirs.

argv: <dbPath> <scriptsDir> — scriptsDir goes on sys.path so the skill's
canonical anlz_paths.compute_anlz_folder resolves (same rule as
src/deck/python/rb_read.py).
"""

import json
import sys
from typing import Any

sys.path.insert(0, sys.argv[2])

from anlz_paths import compute_anlz_folder  # noqa: I001
from pyrekordbox import Rekordbox6Database as R  # type: ignore[import-not-found]


def main() -> None:
    db = R(sys.argv[1])
    rows: list[dict[str, Any]] = []
    for c in db.get_content():
        p = compute_anlz_folder(c.FolderPath or "")
        rows.append(
            {
                "id": c.ID,
                "path": c.FolderPath or "",
                "anlz": getattr(c, "AnalysisDataPath", "") or "",
                "hashDir": f"P{p[0]:03X}/{p[1]:08X}",
            }
        )
    print(json.dumps(rows))
    db.close()


if __name__ == "__main__":
    main()
