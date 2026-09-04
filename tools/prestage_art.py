#!/usr/bin/env python3
"""prestage_art.py — pre-stage artwork for the rb_art.py pilot/batch pass.

Everything except the master.db write can be done BEFORE the USB drives are
plugged back in:

    1. verify every archive WAV has embedded art (the raw material)
    2. write each cover into rekordbox's Artwork/<shard>/<uuid>/ tree
       (pure filesystem — safe with rekordbox closed or open; the files are
       unreferenced until ImagePath is set, so RB just ignores them)
    3. save the exact ImagePath each track will get to a plan file
       (~/.local/state/megadj/rb-art-plan.json)

Then, WHEN DRIVES ARE IN, `tools/rb_art.py` becomes a 30-second step: it
re-extracts art (unchanged files → same deterministic path) and only does
the USN-managed DB commit. The plan file records the mapping for review.

Usage:
    uv run --with mutagen python tools/prestage_art.py            # stage + plan
    uv run --with mutagen python tools/prestage_art.py --check    # verify only
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from rb_art import (
    ARCHIVE,
    ARTWORK_ROOT,
    RB_DIR,
    check_prerequisites,
    collect_targets,
    ensure_artwork_file,
    open_db,
)

PLAN_PATH = Path.home() / ".local/state/megadj/rb-art-plan.json"


def build_plan() -> list[dict]:
    check_prerequisites(need_db_write=False)
    db, DjmdContent = open_db()
    targets = collect_targets(db, DjmdContent)
    plan_rows: list[dict] = []
    no_art = 0
    staged = 0
    for t in targets:
        art: bytes | None = t["art"]
        if not art:
            no_art += 1
            print(f"  ⚠ no embedded art: {t['file'][:60]}")
            continue
        image_path = ensure_artwork_file(art, t["id"])
        staged += 1
        plan_rows.append(
            {
                "content_id": str(t["id"]),
                "file": t["file"],
                "image_path": image_path,
                "art_bytes": len(art),
            }
        )
    try:
        eng = targets[0]["content"].session.bind if targets else None
        if eng is not None:
            eng.dispose()
    except (AttributeError, KeyError, IndexError):
        pass
    PLAN_PATH.parent.mkdir(parents=True, exist_ok=True)
    PLAN_PATH.write_text(
        json.dumps(
            {
                "generated": datetime.now(timezone.utc).isoformat(),
                "rb_dir": str(RB_DIR),
                "artwork_root": str(ARTWORK_ROOT),
                "tracks": plan_rows,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"\nstaged: {staged} artwork file(s) under {ARTWORK_ROOT}")
    print(f"no embedded art: {no_art}")
    print(f"plan → {PLAN_PATH}")
    return plan_rows


def check_plan() -> int:
    check_prerequisites(need_db_write=False)
    if not PLAN_PATH.exists():
        print("no plan file — run without --check first")
        return 1
    plan = json.loads(PLAN_PATH.read_text())
    missing = 0
    for row in plan["tracks"]:
        p = RB_DIR / "share" / row["image_path"].lstrip("/")
        if not p.exists():
            missing += 1
            print(f"  ✗ missing: {row['image_path']} ({row['file'][:50]})")
    print(
        f"plan from {plan['generated']}: {len(plan['tracks'])} track(s), "
        f"{missing} artwork file(s) missing"
    )
    if ARCHIVE.exists():
        wavs = [p for p in ARCHIVE.iterdir() if p.suffix.lower() == ".wav"]
        print(f"archive WAVs on disk: {len(wavs)} (legacy pass pending)")
    return 1 if missing else 0


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(check_plan())
    build_plan()
    print(
        "\nWHEN DRIVES IN:\n"
        "  1. quit rekordbox\n"
        "  2. uv run --with \"pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git\""
        " --with mutagen python tools/rb_art.py pilot\n"
        "  3. verify covers in RB, then … rb_art.py batch\n"
    )
