"""artwork-extract — extract embedded artwork from audio files to PIONEER/Artwork/.

argv: <dbPath> <mountPoint> [apply]

Scans master.db for tracks whose ImagePath has no JPEG on disk, reads
the embedded APIC/covr/FLAC picture from the audio file via mutagen, and
writes it to the RB artwork directory. Does NOT modify master.db (read-only
on the DB; only writes artwork JPEGs to disk).

Safe to run while rekordbox is open — no DB writes, only disk writes.
"""

import json
import os
import sys

from pyrekordbox import db6  # type: ignore[import-not-found]
from pyrekordbox.db6.database import BLOB, deobfuscate  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdContent  # type: ignore[import-not-found]


def extract_embedded_art(audio_path: str) -> bytes | None:
    """Extract embedded artwork from any supported audio container."""
    try:
        from mutagen import File as MFile
    except ImportError:
        return None

    ext = os.path.splitext(audio_path)[1].lower()

    # ID3-based (MP3, AIFF)
    if ext in (".mp3", ".aiff", ".aif"):
        try:
            from mutagen.id3 import ID3

            tags = ID3(audio_path)
            for k in tags:
                if k.startswith("APIC"):
                    data = tags[k].data
                    if data and len(data) > 500:
                        return data
        except Exception:
            pass

    # MP4/M4A (AAC)
    if ext in (".m4a", ".mp4", ".aac"):
        try:
            from mutagen.mp4 import MP4

            mp4 = MP4(audio_path)
            covers = mp4.tags.get("covr", []) if mp4.tags else []
            if covers:
                data = bytes(covers[0])
                if len(data) > 500:
                    return data
        except Exception:
            pass

    # FLAC
    if ext == ".flac":
        try:
            from mutagen.flac import FLAC

            f = FLAC(audio_path)
            if f.pictures:
                data = f.pictures[0].data
                if data and len(data) > 500:
                    return data
        except Exception:
            pass

    # Fallback: mutagen generic
    try:
        mf = MFile(audio_path, easy=False)
        if mf and hasattr(mf, "tags") and mf.tags:
            for k in mf.tags or {}:
                if str(k).startswith("APIC"):
                    data = mf.tags[k].data
                    if data and len(data) > 500:
                        return data
            covr = (mf.tags or {}).get("covr", [])
            if covr:
                data = bytes(covr[0])
                if len(data) > 500:
                    return data
    except Exception:
        pass

    return None


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: artwork-extract.kit.py <dbPath> <mountPoint> [apply]", file=sys.stderr)
        sys.exit(2)

    db_path = sys.argv[1]
    mount = sys.argv[2]
    apply = len(sys.argv) > 3 and sys.argv[3] == "apply"

    db = db6.Rekordbox6Database(path=db_path, key=deobfuscate(BLOB))

    missing = []
    for c in db.query(DjmdContent).all():
        fp = c.FolderPath or ""
        if "/Sampler/" in fp:
            continue
        ip = str(c.ImagePath or "")
        if not ip:
            continue
        resolved = ip if ip.startswith("/Volumes/") else (mount + ip)
        if not os.path.exists(resolved):
            missing.append(c)

    out = {
        "total_missing": len(missing),
        "extracted": 0,
        "no_embed": 0,
        "no_audio": 0,
        "failed": 0,
        "apply": apply,
    }

    for c in missing:
        fp = str(c.FolderPath or "")
        audio = fp if fp.startswith("/Volumes/") else (mount + fp)

        if not os.path.exists(audio):
            out["no_audio"] += 1
            continue

        img = extract_embedded_art(audio)
        if not img:
            out["no_embed"] += 1
            continue

        # Write to the EXISTING ImagePath location — RB already set the path,
        # we just need the file on disk. Using ImagePath directly instead of
        # deriving from UUID avoids mismatches if the path convention differs.
        ip = str(c.ImagePath or "")
        art_file = ip if ip.startswith("/Volumes/") else (mount + ip)
        if not art_file or "//" in art_file.replace("://", ""):
            out["failed"] += 1
            continue

        if apply:
            os.makedirs(os.path.dirname(art_file), exist_ok=True)
            with open(art_file, "wb") as f:
                f.write(img)
            out["extracted"] += 1
        else:
            out["extracted"] += 1

    db.close()
    print(json.dumps(out))


if __name__ == "__main__":
    main()
