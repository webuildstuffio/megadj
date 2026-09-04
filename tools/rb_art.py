#!/usr/bin/env python3
"""rb_art.py — give every WAV in the rekordbox library its cover art.

rekordbox cannot read embedded artwork from WAV files (RIFF INFO has no art
field; the ID3 APIC chunk is ignored). rekordbox stores art in its own library:

    ~/Library/Pioneer/rekordbox/share/PIONEER/Artwork/<shard>/<uuid>/artwork.jpg

and each djmdContent row points there via ImagePath. This script automates
exactly what the manual Artwork tab does:

    1. extract the JPEG already embedded in the WAV (APIC frame)
    2. write it into rekordbox's Artwork/ tree
    3. set djmdContent.ImagePath via pyrekordbox (USN-managed commit)

Safety rails (enforced):
    - rekordbox must NOT be running (WAL corruption)
    - master.db + -shm + -wal backed up before any write
    - pilot mode writes only 3 tracks; verify in RB before `batch`
    - idempotent: tracks with ImagePath already set are skipped

Usage:
    uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
        --with mutagen python tools/rb_art.py <status|dry-run|pilot|batch>

Modes:
    status    read-only: how many RB WAVs lack art
    dry-run   plan every write, touch nothing
    pilot     backup + write 3 tracks (then verify in rekordbox)
    batch     backup + write all remaining WAVs
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

warnings.filterwarnings("ignore")

HOME = Path.home()
RB_DIR = HOME / "Library/Pioneer/rekordbox"
MASTER_DB = RB_DIR / "master.db"
ARTWORK_ROOT = RB_DIR / "share/PIONEER/Artwork"
BACKUP_ROOT = RB_DIR / "backups"
ARCHIVE = HOME / "Music/DJ-Imports"
DB_ROOT_FOR_PATHS = RB_DIR / "share"  # ImagePath is relative to this ("share") root

PILOT_N = 3
ROLLBACK_DIR = ARTWORK_ROOT / "_megadj-rollback"


def fail(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


def check_prerequisites(need_db_write: bool) -> None:
    if not MASTER_DB.exists():
        fail(f"master.db not found at {MASTER_DB}")
    if need_db_write:
        pr = subprocess.run(["pgrep", "-x", "rekordbox"], capture_output=True, check=False)
        if pr.returncode == 0:
            fail("rekordbox is RUNNING — quit it first (WAL corruption risk).")


def backup_master_db(tag: str) -> Path:
    """Copy master.db + -shm + -wal to a dated backup folder."""
    dest = BACKUP_ROOT / f"{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{tag}"
    dest.mkdir(parents=True, exist_ok=True)
    copied = []
    for suffix in ("", "-shm", "-wal"):
        src = Path(str(MASTER_DB) + suffix)
        if src.exists():
            shutil.copy2(src, dest / src.name)
            copied.append(src.name)
    print(f"  backup → {dest} ({', '.join(copied)})")
    return dest


def open_db():
    from pyrekordbox import Rekordbox6Database
    from pyrekordbox.db6.tables import DjmdContent

    try:
        db = Rekordbox6Database()
    except Exception as exc:  # noqa: BLE001 — surface any unlock failure mode
        fail(f"cannot unlock master.db: {exc}")
    return db, DjmdContent


def wav_art_jpeg(path: str) -> bytes | None:
    """Extract the embedded cover (APIC) from a WAV file."""
    from mutagen.wave import WAVE

    try:
        a = WAVE(path)
        if not a.tags:
            return None
        for key in list(a.tags.keys()):
            if key.startswith("APIC"):
                frame = a.tags.get(key)
                data = bytes(getattr(frame, "data", b"") or b"")
                if data[:3] == b"\xff\xd8\xff":  # JPEG magic
                    return data
                if data[:8] == b"\x89PNG\r\n\x1a\n":
                    return data  # RB accepts PNG too
        return None
    except (OSError, ValueError, TypeError):
        return None


def collect_targets(db, DjmdContent) -> list[dict]:
    """All WAV rows in RB whose file exists in the archive and lacks ImagePath."""
    rows = db.query(DjmdContent).filter(DjmdContent.FileType == 11).all()
    targets = []
    archive_names = {p.name for p in ARCHIVE.iterdir() if p.suffix.lower() == ".wav"}
    for c in rows:
        if c.ImagePath:  # already has art
            continue
        fname = c.FileNameL or (os.path.basename(c.FolderPath or "") or "")
        if not fname or fname not in archive_names:
            continue
        fpath = ARCHIVE / fname
        art = wav_art_jpeg(str(fpath))
        targets.append(
            {
                "content": c,
                "id": c.ID,
                "file": fname,
                "fpath": str(fpath),
                "art": art,
            }
        )
    targets.sort(key=lambda t: t["file"].lower())
    return targets


def ensure_artwork_file(art: bytes, row_id: str) -> str:
    """Write art into RB's Artwork tree; return the ImagePath value.

    Layout mirrors existing files:  Artwork/<3-hex>/<uuid>/artwork.jpg
    ImagePath is stored relative to the share/ root: /PIONEER/Artwork/...
    """
    import uuid as uuid_mod

    row_id = str(row_id)
    # shard = stable 3-hex dir; existing dirs use first 3 chars of a hex uuid.
    shard = format(int(__import__("hashlib").sha1(row_id.encode()).hexdigest()[:6], 16) % 0xFFF, "03x")
    uid = str(uuid_mod.uuid5(uuid_mod.NAMESPACE_URL, f"megadj-artwork-{row_id}"))
    dest_dir = ARTWORK_ROOT / shard / uid
    dest_dir.mkdir(parents=True, exist_ok=True)
    ext = "png" if art[:8] == b"\x89PNG\r\n\x1a\n" else "jpg"
    dest = dest_dir / f"artwork.{ext}"
    if not dest.exists() or dest.stat().st_size != len(art):
        dest.write_bytes(art)
    return f"/PIONEER/Artwork/{shard}/{uid}/artwork.{ext}"


def set_image_path(db, content, image_path: str) -> None:
    content.ImagePath = image_path
    # keep RB's local-change bookkeeping consistent (cloud sync unused,
    # but rb_local_usn should still move like the app does)
    try:
        content.rb_local_usn = (content.rb_local_usn or 0) + 1
    except (TypeError, AttributeError):
        pass
    db.commit()


def mode_status() -> int:
    check_prerequisites(need_db_write=False)
    db, DjmdContent = open_db()
    rows = db.query(DjmdContent).filter(DjmdContent.FileType == 11).all()
    with_art = sum(1 for c in rows if c.ImagePath)
    archive_names = {p.name for p in ARCHIVE.iterdir() if p.suffix.lower() == ".wav"}
    ours = [c for c in rows if (c.FileNameL or "") in archive_names]
    ours_no_art = [c for c in ours if not c.ImagePath]
    with_our_art = sum(1 for f in archive_names if wav_art_jpeg(str(ARCHIVE / f)))
    print(f"RB library WAVs: {len(rows)} (with art: {with_art}, without: {len(rows) - with_art})")
    print(f"Archive WAVs:    {len(archive_names)} (embedded art: {with_our_art})")
    print(f"Our tracks in RB without art: {len(ours_no_art)}")
    return 0


def plan(mode: str) -> list[dict]:
    check_prerequisites(need_db_write=(mode in ("pilot", "batch")))
    if mode in ("pilot", "batch"):
        backup_master_db(mode)
    db, DjmdContent = open_db()
    targets = collect_targets(db, DjmdContent)
    if mode == "pilot":
        targets = targets[:PILOT_N]
    print(f"{'MODE':<8} {mode} — {len(targets)} track(s) to update\n")
    return targets


def apply(mode: str) -> int:
    targets = plan(mode)
    if not targets:
        print("Nothing to do — all WAVs already have art in RB.")
        return 0
    ok = no_art = err = 0
    for t in targets:
        if not t["art"]:
            no_art += 1
            print(f"  ⚠ no embedded art: {t['file'][:60]}")
            continue
        try:
            if mode in ("dry-run",):
                print(f"  would set ImagePath: {t['file'][:60]}")
                ok += 1
                continue
            image_path = ensure_artwork_file(t["art"], t["id"])
            set_image_path(t["content"], image_path)
            ok += 1
            print(f"  ✓ {t['file'][:60]}")
        except Exception as exc:  # noqa: BLE001 — keep batch going, log the failure
            err += 1
            print(f"  ✗ {t['file'][:60]}: {exc}")
    close_db(targets)
    print(f"\n{mode}: ok={ok} no-art={no_art} errors={err}")
    if mode == "pilot":
        print("\nNEXT: open rekordbox → check these 3 tracks show covers →")
        print("then run:  uv run python tools/rb_art.py batch")
    return 1 if err else 0


def close_db(targets: list[dict]) -> None:
    """Close the session opened in plan() — content objects carry their engine."""
    try:
        eng = targets[0]["content"].session.bind if targets else None
        if eng is not None:
            eng.dispose()
    except (AttributeError, KeyError, IndexError):
        pass


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "status"
    if mode not in ("status", "dry-run", "pilot", "batch"):
        print(__doc__)
        return 1
    if mode == "status":
        return mode_status()
    return apply(mode)


if __name__ == "__main__":
    sys.exit(main())
