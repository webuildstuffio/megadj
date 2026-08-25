#!/usr/bin/env python3
"""Inject a folder of new tracks into the master device DB and generate rekordbox analysis.

One command runs the full pipeline for a batch of new audio files already
copied onto the master drive:

    uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
        --with librosa --with numpy python scripts/usb_sync.py \
        --db /tmp/usb-sync/work_master.db --drive /Volumes/DJMASTER \
        --folder "/Contents/YTMusic Liked" --playlist "YTMusic Liked"

Steps (each skippable with flags):
  1. ffprobe metadata extraction        (--skip-probe to reuse an existing JSON)
  2. DB injection (Content/Artist rows, playlist)
  3. BPM detection (ffmpeg pipe -> librosa)
  4. ANLZ generation (beatgrid + waveforms)

WARNING: quit rekordbox before touching any DB on a drive. Edit a /tmp copy,
verify, then deploy with usb_mirror.py --rekordbox-only.

Device DB gotchas baked in from hard-won experience:
  - Content.length is SECONDS, not milliseconds.
  - releaseDate/dateCreated/dateAdded must be non-None or the ORM serializer crashes.
  - fileType: 4 = m4a/AAC, 11 = wav.
"""

import argparse
import json
import os
import random
import subprocess
import sys
import warnings
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from progress import Progress, Stage

warnings.filterwarnings("ignore")


def probe_file(path: str) -> dict:
    r = subprocess.run(
        [
            "ffprobe",
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            path,
        ],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if r.returncode != 0:
        return {"error": "probe failed"}
    d = json.loads(r.stdout)
    fmt = d.get("format", {})
    audio = next(
        (s for s in d.get("streams", []) if s.get("codec_type") == "audio"), {}
    )
    base = os.path.splitext(os.path.basename(path))[0]
    parts = base.split(" - ", 1)
    return {
        "rank": parts[0],
        "raw_name": parts[1] if len(parts) > 1 else base,
        "duration_sec": round(float(fmt.get("duration", 0))),
        "bitrate_kbps": round(int(fmt.get("bit_rate", 0)) / 1000) or None,
        "size": int(fmt.get("size", os.path.getsize(path))),
        "codec": audio.get("codec_name"),
        "sample_rate": audio.get("sample_rate"),
        "tags": fmt.get("tags", {}),
    }


def cmd_probe(args, stage: Stage) -> dict:
    src_dir = args.drive + args.folder
    stage.info(f"probing {src_dir}")
    files = sorted(
        f for f in os.listdir(src_dir) if not f.startswith("._") and f != ".DS_Store"
    )
    meta = {}
    prog = Progress(len(files), label="probe")
    errs = 0
    for fn in files:
        m = probe_file(os.path.join(src_dir, fn))
        if "error" in m:
            errs += 1
            print(
                f"\nBROKEN {fn}: {m['error']} (zero-byte/interrupted download? replace before syncing)"
            )
        meta[fn] = m
        prog.update(1)
    prog.close(f"errors: {errs}")
    out = os.path.join(os.path.dirname(args.db), "ytmusic_meta.json")
    with open(out, "w") as f:
        json.dump(meta, f, indent=1)
    return meta


def cmd_inject(args, meta: dict, stage: Stage) -> None:
    from pyrekordbox.devicelib_plus.database import DeviceLibraryPlus
    from pyrekordbox.devicelib_plus.models import (
        Artist,
        Content,
        Playlist,
        PlaylistContent,
    )

    db = DeviceLibraryPlus(args.db)
    existing = {c.path for c in db.query(Content).all()}
    artists = {a.name: a.artist_id for a in db.query(Artist).all()}
    next_artist = db.query(Artist).order_by(Artist.artist_id.desc()).first().artist_id

    used_anlz = set()
    for c in db.query(Content).all():
        if c.analysisDataFilePath:
            try:
                used_anlz.add(int(c.analysisDataFilePath.split("/")[4], 16))
            except (IndexError, ValueError):
                pass

    rng = random.Random()
    added = skipped = 0
    results = []
    for fn in sorted(meta):
        m = meta[fn]
        if "error" in m:
            continue
        device_path = f"{args.folder}/{fn}"
        if device_path in existing:
            skipped += 1
            continue
        tags = m.get("tags", {})
        title = (tags.get("title") or m["raw_name"])[:255]
        artist_name = tags.get("artist") or ""
        if artist_name and artist_name not in artists:
            next_artist += 1
            db.add(Artist(artist_id=next_artist, name=artist_name))
            artists[artist_name] = next_artist
        aid = artists.get(artist_name)
        while True:
            uid = rng.randint(0x10000, 0xFFFFFF)
            if uid not in used_anlz:
                used_anlz.add(uid)
                break
        c = Content(
            title=title,
            bpmx100=None,
            length=m["duration_sec"],  # SECONDS — device DB convention
            artist_id_artist=aid,
            path=device_path,
            fileName=fn,
            fileSize=m["size"],
            fileType=4 if fn.lower().endswith((".m4a", ".mp4")) else 11,
            bitrate=m.get("bitrate_kbps") or 0,
            samplingRate=int(m.get("sample_rate") or 0),
            releaseDate=datetime.now(tz=timezone.utc),
            dateCreated=datetime.now(tz=timezone.utc),
            dateAdded=datetime.now(tz=timezone.utc),
            cueUpdateCount=0,
            analysisDataUpdateCount=0,
            informationUpdateCount=0,
            analysisDataFilePath=f"/PIONEER/USBANLZ/{args.device}/{uid:08X}/ANLZ0000.DAT",
        )
        db.add(c)
        db.flush()
        results.append({"content_id": c.content_id, "file": fn})
        added += 1

    pl = db.query(Playlist).filter(Playlist.name == args.playlist).first()
    if pl is None:
        max_pl = (
            db.query(Playlist).order_by(Playlist.playlist_id.desc()).first().playlist_id
        )
        pl = Playlist(
            playlist_id=max_pl + 1,
            sequenceNo=0,
            name=args.playlist,
            attribute=2,
            playlist_id_parent=0,
        )
        db.add(pl)
        db.flush()
    for i, r in enumerate(results, 1):
        db.add(
            PlaylistContent(
                playlist_id=pl.playlist_id, content_id=r["content_id"], sequenceNo=i
            )
        )
    db.commit()
    stage.info(
        f"injected {added} tracks (skipped {skipped} existing), playlist={args.playlist!r}"
    )
    with open(os.path.join(os.path.dirname(args.db), "injected_ids.json"), "w") as f:
        json.dump(results, f, indent=1)


def cmd_bpm(args, stage: Stage) -> None:
    import librosa
    import numpy as np
    from pyrekordbox.devicelib_plus.database import DeviceLibraryPlus
    from pyrekordbox.devicelib_plus.models import Content

    db = DeviceLibraryPlus(args.db)
    rows = db.query(Content).filter(Content.path.like(args.folder + "/%")).all()
    todo = [c for c in rows if not c.bpmx100]
    stage.info(f"BPM for {len(todo)} of {len(rows)} rows in {args.folder}")
    prog = Progress(len(todo), label="bpm")
    errs = 0
    for c in todo:
        full = args.drive + c.path
        try:
            r = subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-t",
                    "120",
                    "-i",
                    full,
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "11025",
                    "-f",
                    "f32le",
                    "-",
                ],
                capture_output=True,
                timeout=180,
                check=False,
            )
            if r.returncode != 0 or len(r.stdout) < 44100:
                raise RuntimeError(r.stderr[:80])
            y = np.frombuffer(r.stdout, dtype=np.float32)
            tempo, _ = librosa.beat.beat_track(y=y, sr=11025)
            bpm = float(tempo.item() if hasattr(tempo, "item") else tempo)
            if bpm < 60:
                bpm *= 2
            elif bpm >= 200:
                bpm /= 2
            c.bpmx100 = round(bpm * 100)
        except Exception as e:  # noqa: BLE001
            errs += 1
            print(f"\nERR {c.fileName[:50]}: {e}", flush=True)
        prog.update(1)
    db.commit()
    prog.close(f"errors: {errs}")


def build_pmai() -> bytes:
    import struct

    return b"PMAI" + struct.pack(">IIIIII", 28, 0x18FA, 1, 0x10000, 1, 0)


def build_ppth(path: str) -> bytes:
    import struct

    p = path.encode("utf-16-be")
    return b"PPTH" + struct.pack(">III", 16, 16 + len(p), len(p)) + p


def build_pvbr() -> bytes:
    import struct

    return (
        b"PVBR"
        + struct.pack(">III", 16, 24, 1620)
        + struct.pack(">I", 0)
        + b"\x00\x00\x00\x00"
    )


def build_pqtz(bpm100: int, length_sec: int) -> bytes:
    import struct

    beat_ms = 6000000.0 / bpm100
    n = int((length_sec * 1000) / beat_ms)
    entries = []
    ms = 615.0
    beat = 2
    for _ in range(n):
        full = int(ms)
        entries.append(struct.pack(">4H", beat, bpm100, full // 65536, full % 65536))
        ms += beat_ms
        beat = beat % 4 + 1
    payload = b"".join(entries)
    hdr = struct.pack(">IIIII", 0, 0x80000, n, bpm100, 147)
    return b"PQTZ" + struct.pack(">II", 24, 32 + len(payload)) + hdr + payload


def build_pwav(scaled) -> bytes:
    import struct

    payload = scaled.tobytes()
    return (
        b"PWAV"
        + struct.pack(">IIII", 20, 20 + len(payload), len(scaled), 0x10000)
        + payload
    )


def build_pwv2(scaled) -> bytes:
    import struct

    payload = scaled.tobytes()
    return (
        b"PWV2"
        + struct.pack(">IIII", 20, 20 + len(payload), len(scaled), 0x10000)
        + payload
    )


def build_pcob() -> bytes:
    import struct

    return b"PCOB" + struct.pack(">IIIII", 24, 24, 0, 0, 0)


def get_peaks(path: str):
    import numpy as np

    r = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-t",
            "30",
            "-i",
            path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "8000",
            "-f",
            "f32le",
            "-",
        ],
        capture_output=True,
        timeout=120,
        check=False,
    )
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError("decode failed")
    y = np.frombuffer(r.stdout, dtype=np.float32)
    usable = y[: len(y) // 8000 * 8000]
    pwav = np.clip(
        np.array(
            [np.abs(s).max() if len(s) else 0.0 for s in np.array_split(usable, 200)]
        )
        * 255,
        0,
        255,
    ).astype(np.uint8)
    pwv2 = np.clip(
        np.array(
            [np.abs(s).max() if len(s) else 0.0 for s in np.array_split(usable, 100)]
        )
        * 255,
        0,
        255,
    ).astype(np.uint8)
    return pwav, pwv2


def cmd_anlz(args, stage: Stage) -> None:
    from pyrekordbox.devicelib_plus.database import DeviceLibraryPlus
    from pyrekordbox.devicelib_plus.models import Content

    db = DeviceLibraryPlus(args.db)
    rows = db.query(Content).filter(Content.path.like(args.folder + "/%")).all()
    stage.info(f"building ANLZ for {len(rows)} tracks")
    prog = Progress(len(rows), label="anlz")
    built = errs = 0
    for c in rows:
        full = args.drive + c.path
        try:
            if not c.bpmx100:
                raise RuntimeError("no BPM")
            pwav, pwv2 = get_peaks(full)
            dat = (
                build_pmai()
                + build_ppth(c.path)
                + build_pvbr()
                + build_pqtz(c.bpmx100, c.length)
                + build_pwav(pwav)
                + build_pwv2(pwv2)
                + build_pcob()
            )
            out_dir = args.drive + os.path.dirname(c.analysisDataFilePath)
            os.makedirs(out_dir, exist_ok=True)
            with open(os.path.join(out_dir, "ANLZ0000.DAT"), "wb") as f:
                f.write(dat)
            built += 1
        except Exception as e:  # noqa: BLE001
            errs += 1
            print(f"\nERR {c.fileName[:50]}: {e}", flush=True)
        prog.update(1)
    prog.close(f"built: {built}, errors: {errs}")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--db",
        required=True,
        help="path to working DB copy (never the drive's live file)",
    )
    ap.add_argument(
        "--drive", default="/Volumes/DJMASTER", help="master drive mount point"
    )
    ap.add_argument(
        "--folder",
        default="/Contents/YTMusic Liked",
        help="device-relative folder to sync",
    )
    ap.add_argument(
        "--playlist", default="YTMusic Liked", help="playlist name for new tracks"
    )
    ap.add_argument(
        "--device", default="P080", help="USBANLZ device folder for new analysis"
    )
    ap.add_argument("--meta", help="reuse existing metadata JSON instead of re-probing")
    args = ap.parse_args()

    if not os.path.exists(args.db):
        print(
            f"ERROR: {args.db} not found. Copy the drive DB first (rekordbox must be closed)."
        )
        return 2
    if not os.path.isdir(args.drive + args.folder):
        print(f"ERROR: {args.drive}{args.folder} not found.")
        return 2

    stage = Stage()
    stage.step("ffprobe metadata")
    if args.meta and os.path.exists(args.meta):
        import json as _json

        with open(args.meta) as f:
            meta = _json.load(f)
        stage.info(f"loaded {len(meta)} entries from {args.meta}")
    else:
        meta = cmd_probe(args, stage)

    stage.step("DB injection")
    cmd_inject(args, meta, stage)
    stage.step("BPM detection")
    cmd_bpm(args, stage)
    stage.step("ANLZ generation")
    cmd_anlz(args, stage)
    print(
        "\nRESULT: OK — deploy with usb_mirror.py --rekordbox-only, then --anlz-only --contents-only"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
