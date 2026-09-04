# final_audit.py — ground-truth audit of every audio file in ~/Music/DJ-Imports.
# For each file (ffprobe/mutagen, NOT the DB):
#   - title / artist / album / genre tags present?
#   - embedded artwork present? (video stream for mp3/m4a, APIC for wav)
# Exit summary shows the exact 100% scorecard.
import json
import os
import subprocess

HOME = os.path.expanduser("~")
ARCH = os.path.join(HOME, "Music", "DJ-Imports")
EXTS = {".wav", ".mp3", ".m4a", ".aiff", ".flac"}


def ffprobe_json(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        capture_output=True,
        check=False,
    )
    return json.loads(r.stdout.decode()) if r.returncode == 0 else {}


def wav_tags(path):
    """mutagen ground truth for wav (ID3 + LIST INFO)"""
    script = f"""
from mutagen.wave import WAVE
a = WAVE({path!r})
out = {{}}
if a.tags:
    for k in a.tags.keys():
        try:
            v = a.tags.get(k)
            out[k.split(":")[0]] = str(v)
        except Exception:  # noqa: BLE001
            pass
print(json.dumps(out))
"""
    r = subprocess.run(["uv", "run", "--with", "mutagen", "python", "-c", script], capture_output=True, check=False)
    try:
        return json.loads(r.stdout.decode().strip().splitlines()[-1])
    except Exception:  # noqa: BLE001
        return {}


def main():
    files = sorted(
        f for f in os.listdir(ARCH)
        if not f.startswith(".") and os.path.splitext(f)[1].lower() in EXTS
    )
    report = []
    for fname in files:
        path = os.path.join(ARCH, fname)
        info = ffprobe_json(path)
        fmt = info.get("format", {})
        fmt_tags = fmt.get("tags", {}) or {}
        streams = info.get("streams", [])
        has_art = any(s.get("disposition", {}).get("attached_pic") or (s.get("codec_type") == "video" and s.get("codec_name") in ("png", "mjpeg")) for s in streams)

        # wav: merge mutagen view (LIST INFO shows up as format tags too)
        tags = dict(fmt_tags)
        if fname.lower().endswith(".wav"):
            mt = wav_tags(path)
            tags.update({k.lower(): v for k, v in mt.items() if k.startswith("T")})
            if any(k.startswith("APIC") for k in mt):
                has_art = True

        def g(*keys, tag_map=None):
            for k in keys:
                v = tag_map.get(k) or tag_map.get(k.lower())
                if v and str(v).strip():
                    return str(v).strip()
            return None

        title = g("title", "INAM", tag_map=tags)
        artist = g("artist", "IART", tag_map=tags)
        album = g("album", "IPRD", tag_map=tags)
        genre = g("genre", "IGNR", tag_map=tags)
        # strip dupes like "Edits / Bootlegs,Progressive House" — take first
        if genre and "," in genre:
            genre = genre.split(",")[0].strip()

        missing = []
        if not title: missing.append("title")
        if not artist: missing.append("artist")
        if not album: missing.append("album")
        if not genre or genre == "Music": missing.append("genre")
        if not has_art: missing.append("ART")

        report.append((fname, title, artist, album, genre, has_art, missing))

    full = 0
    for fname, title, artist, album, genre, has_art, missing in report:
        if not missing:
            full += 1
        else:
            print(f"  ✗ {fname}")
            print(f"      missing: {', '.join(missing)} | title={title!r} artist={artist!r} album={album!r} genre={genre!r} art={has_art}")

    n = len(report)
    print(f"\n{'=' * 50}")
    print(f"SCORECARD: {full}/{n} files 100% (full tags + artwork)")
    print(f"{'=' * 50}")
    if full < n:
        print("incomplete:")
        for fname, t, a, al, gnr, art, missing in report:
            if missing:
                print(f"  {fname}: {', '.join(missing)}")


if __name__ == "__main__":
    main()
