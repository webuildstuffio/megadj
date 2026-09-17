"""rb-cues restamp leg — the one-shot BUG-1 repair write.

argv: <dbPath> <apply> <mount> — apply is "apply"|"dry". Kind=0 is also
the legitimate collection-DB value for memory cues, so a broad Kind=0
rewrite is unsafe: only rows matching every part of the Sep 12 intake
provenance signature (kit-shared predicate) become candidates, and the
pre-commit RB-closed guard shrinks the check-to-write window to ~nothing.
"""

import datetime
import json
import os
import sys

from pyrekordbox import db6  # type: ignore[import-not-found]
from pyrekordbox.db6.database import BLOB, deobfuscate  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdContent, DjmdCue  # type: ignore[import-not-found]

# @kit(incidentCuePredicatePython)


def main() -> None:
    db_path = sys.argv[1]
    apply = sys.argv[2] == "apply"
    mount = os.path.abspath(sys.argv[3])
    db = db6.Rekordbox6Database(path=db_path, key=deobfuscate(BLOB))
    all_kind_zero = db.query(DjmdCue).filter(DjmdCue.Kind == 0).all()
    contents = os.path.normpath(os.path.join(mount, "Contents"))
    content_paths = {
        str(content.ID): content.FolderPath or "" for content in db.query(DjmdContent).all()
    }

    rows = [cue for cue in all_kind_zero if is_incident_cue(cue)]
    out = {
        "found": len(rows),
        "written": 0,
        "protected": len(all_kind_zero) - len(rows),
        "written_ids": [],
        "errors": [],
    }
    if apply:
        try:
            for r in rows:
                r.Kind = 1
                # @kit(RB_CLOSED_PY_GUARD;12)
                raise RuntimeError("rekordbox reopened before cue commit")
            db.session.commit()
            out["written_ids"] = [str(r.ID) for r in rows]
            out["written"] = len(out["written_ids"])
        except Exception as e:
            db.session.rollback()
            out["errors"].append(["transaction", repr(e)[:200]])
    print(json.dumps(out))
    db.close()


if __name__ == "__main__":
    main()
