#!/usr/bin/env python3
"""Inspect WAV artwork coverage in an explicitly selected rekordbox DB.

The old version wrote the stale local
``~/Library/Pioneer/rekordbox/master.db`` and its local Artwork tree. That
database is not the collection source of truth, while a shelf DB has a
different storage contract. Until artwork-file placement and DB updates are
implemented through the shared shelf write seam, mutation is deliberately
disabled.

Usage:
    uv run --with pyrekordbox --with mutagen python tools/rb_art.py \
        <status|dry-run> --db /Volumes/SHELF1/PIONEER/Master/master.db

``MEGADJ_RB_MASTER`` may provide the DB path instead of ``--db``. An explicit
``--db`` wins. ``pilot`` and ``batch`` are retained only to fail closed with a
clear migration message; neither opens a DB nor writes artwork.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

MUTATING_MODES = frozenset({"pilot", "batch"})
READ_ONLY_MODES = frozenset({"status", "dry-run"})


def stale_local_db() -> Path:
    """The known-stale rekordbox desktop DB, never a target for this tool."""
    return (Path.home() / "Library/Pioneer/rekordbox/master.db").resolve(strict=False)


def resolve_db_path(explicit: Path | None, env: Mapping[str, str]) -> Path:
    """Resolve the explicit/configured collection DB and reject the stale local DB."""
    configured = env.get("MEGADJ_RB_MASTER")
    if explicit is None and not configured:
        raise ValueError("an explicit collection DB is required: --db or MEGADJ_RB_MASTER")
    candidate = (explicit if explicit is not None else Path(configured or "")).expanduser()
    resolved = candidate.resolve(strict=False)
    if resolved == stale_local_db():
        raise ValueError(
            "refusing the stale local rekordbox DB; select the configured shelf collection DB"
        )
    if resolved.name != "master.db":
        raise ValueError(f"collection DB must be a master.db file, got: {resolved}")
    return resolved


def require_readable_db(db_path: Path) -> None:
    if not db_path.is_file():
        raise ValueError(f"master.db not found at {db_path}")


def open_db(db_path: Path) -> tuple[Any, Any]:
    """Open exactly the selected DB; never fall back to pyrekordbox defaults."""
    from pyrekordbox import Rekordbox6Database  # type: ignore[import-not-found]
    from pyrekordbox.db6.tables import DjmdContent  # type: ignore[import-not-found]

    try:
        db: Any = Rekordbox6Database(path=str(db_path))
    except Exception as exc:
        raise RuntimeError(f"cannot open collection DB {db_path}: {exc}") from exc
    return db, DjmdContent


def close_db(db: Any) -> None:
    try:
        db.close()
    except (AttributeError, OSError) as exc:
        print(f"warning: could not close collection DB cleanly: {exc}", file=sys.stderr)


def wav_art_image(path: Path) -> bytes | None:
    """Extract an embedded JPEG/PNG cover from a WAV without modifying it."""
    from mutagen.wave import WAVE

    try:
        audio: Any = WAVE(str(path))  # type: ignore[no-untyped-call]
        tags: Any = audio.tags
        if not tags:
            return None
        for key in list(tags.keys()):
            if not str(key).startswith("APIC"):
                continue
            frame = tags.get(key)
            data = bytes(getattr(frame, "data", b"") or b"")
            if data[:3] == b"\xff\xd8\xff" or data[:8] == b"\x89PNG\r\n\x1a\n":
                return data
    except (OSError, ValueError, TypeError):
        return None
    return None


def wav_rows(db: Any, content_type: Any) -> list[Any]:
    return list(db.query(content_type).filter(content_type.FileType == 11).all())


def collect_targets(db: Any, content_type: Any) -> list[dict[str, Any]]:
    """Existing WAV rows without ImagePath, inspected read-only from their DB path."""
    targets: list[dict[str, Any]] = []
    for content in wav_rows(db, content_type):
        if content.ImagePath:
            continue
        path = Path(str(content.FolderPath or ""))
        if path.suffix.lower() != ".wav" or not path.is_file():
            continue
        targets.append(
            {
                "id": str(content.ID),
                "file": path.name,
                "path": path,
                "has_embedded_art": wav_art_image(path) is not None,
            }
        )
    targets.sort(key=lambda target: str(target["file"]).lower())
    return targets


def mode_status(db_path: Path) -> int:
    db, content_type = open_db(db_path)
    try:
        rows = wav_rows(db, content_type)
        with_art = sum(1 for content in rows if content.ImagePath)
        existing = [content for content in rows if Path(str(content.FolderPath or "")).is_file()]
        print(f"Collection DB: {db_path}")
        print(
            f"RB library WAVs: {len(rows)} (with art: {with_art}, without: {len(rows) - with_art})"
        )
        print(f"WAV rows with an existing source file: {len(existing)}")
        return 0
    finally:
        close_db(db)


def mode_dry_run(db_path: Path) -> int:
    db, content_type = open_db(db_path)
    try:
        targets = collect_targets(db, content_type)
    finally:
        close_db(db)
    print(f"Collection DB: {db_path}")
    print(f"dry-run — {len(targets)} WAV row(s) lack ImagePath; no writes are available")
    for target in targets:
        art = "embedded art present" if target["has_embedded_art"] else "no embedded art"
        print(f"  {target['file']}: {art}")
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("mode", choices=sorted(READ_ONLY_MODES | MUTATING_MODES))
    result.add_argument("--db", type=Path, help="explicit shelf collection master.db")
    return result


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    mode = str(args.mode)
    if mode in MUTATING_MODES:
        print(
            "error: mutating artwork mode is disabled: the stale local DB/artwork "
            "contract is unsafe; use status or dry-run with the configured shelf DB",
            file=sys.stderr,
        )
        return 2
    try:
        db_path = resolve_db_path(args.db, os.environ)
        require_readable_db(db_path)
        if mode == "status":
            return mode_status(db_path)
        return mode_dry_run(db_path)
    except (RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
