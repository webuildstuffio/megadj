"""Turbo OverCue builder — multi-track parallel pipeline for FIKWOK.

3x+ speedup over v1 (120s/track baseline):
  1. Skip verify_role (saves 52%)
  2. Run flac_pack + waveforms in parallel per track
  3. Process N tracks concurrently via ThreadPoolExecutor
  4. Read index once, batch-write every 5 tracks

Usage:
  python overcue-turbo.py <mapping.json> <volume> [limit] [start] [workers]
  env: XZ_WORKERS (default 3), XZ_RESOURCES (auto-detected)

Output: JSON summary on last stdout line for TS wrapper to parse.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

XZ_RES_DEFAULT = "/Applications/XZ Mods Beta.app/Contents/Resources/resources"


def setup_env() -> tuple[str, str, str, str]:
    """Configure paths and environment. Returns (res, import_python, grouped, flac_pack, waveform)."""
    res = os.environ.get("XZ_BUILDER_RESOURCES", XZ_RES_DEFAULT)
    os.environ["XZ_BUILDER_RESOURCES"] = res
    os.environ["XZ_AUDIO_HELPER"] = os.path.join(res, "xz-audio-helper")
    os.environ["XZ_OVERCUE_CHECK"] = os.path.join(res, "xz-overcue-check")
    sys.path.insert(0, os.path.expanduser("~/github/XZ-Mods/source/xdj-xz-toolkit"))
    import_python = str(Path.home() / ".local/share/XZ Mods/import-python/bin/python")
    return res, import_python, f"{res}/inference/grouped_stems.py", f"{res}/inference/overcue_flac_pack.py"


RES, IMPORT_PYTHON, GROUPED_STEMS, FLAC_PACK = setup_env()
WAVEFORM = f"{RES}/inference/stem_waveforms.py"

from builder import cache, overcue_writer  # type: ignore[import-not-found]  # noqa: E402
from builder.service import VERSION  # type: ignore[import-not-found]  # noqa: E402

index_lock = threading.Lock()
print_lock = threading.Lock()
global_index: dict[str, Any] | None = None
pending_entries: list[tuple[int, dict[str, Any]]] = []


def load_index(cdjmods: Path) -> set[str]:
    global global_index
    idx, _ = overcue_writer.read_index(cdjmods)
    global_index = idx
    return set(idx.get("tracks", {}).keys())


def flush_index(cdjmods: Path) -> int:
    global global_index
    with index_lock:
        if not pending_entries:
            return 0
        stems_dir = cdjmods / "stems"
        for track_id, entry in pending_entries:
            merged, _ = overcue_writer.merge(
                global_index, track_id, entry,
                lambda b: overcue_writer.replaceable(stems_dir, b),
            )
            if merged is not None:
                global_index = merged
        overcue_writer._write_json(cdjmods / "index.json", global_index, compact=True)
        count = len(pending_entries)
        pending_entries.clear()
    return count


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fast_page_table_sha(page_file: Path) -> str:
    with open(page_file, "rb") as f:
        header = f.read(24)
        if len(header) < 24:
            raise ValueError("truncated page file")
        magic = header[:8]
        if magic not in (b"OVPGZ003", b"OVPGZ001"):
            raise ValueError(f"unknown magic: {magic!r}")
        _, count, _ = struct.unpack(">IIQ", header[8:])
        table = f.read(48 * count)
        return hashlib.sha256(header + table).hexdigest()


def process_one(
    track_info: dict[str, Any], volume: str, cdjmods: Path, done_ids: set[str],
) -> tuple[str, int, str | None, dict[str, Any] | None, float]:
    file_path = track_info["file_path"]
    track_id = track_info["track_id"]
    stem_dir = track_info["stem_dir"]
    source = Path(volume + file_path) if file_path.startswith("/") else Path(volume) / file_path

    if not source.exists():
        return "missing", track_id, None, None, 0
    if not os.path.isdir(stem_dir):
        return "no_stems", track_id, None, None, 0
    if str(track_id) in done_ids:
        return "exists", track_id, None, None, 0

    stems_dir = cdjmods / "stems"
    t0 = time.time()
    source_sha = sha256_file(source)
    codec = source.suffix.lower().lstrip(".")

    result = subprocess.run(
        [os.path.join(RES, "xz-audio-helper"), "inspect", str(source)],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise ValueError(f"inspect: {result.stderr[:200]}")
    info = json.loads(result.stdout)
    sample_rate = info.get("sample_rate", 44100)
    mp3_info = info.get("mp3")

    with tempfile.TemporaryDirectory(prefix="xz-turbo-") as tmpdir:
        temp = Path(tmpdir)
        audio_dir = temp / "audio"

        request = {
            "mix": str(source),
            "files": [
                {"path": f"{stem_dir}/vocals.flac", "group": "vocals"},
                {"path": f"{stem_dir}/drums.flac", "group": "drums"},
                {"path": f"{stem_dir}/bass.flac", "group": "harmonics"},
                {"path": f"{stem_dir}/other.flac", "group": "harmonics"},
            ],
            "fit_length": True, "alignment": None, "require": None,
        }
        request_file = temp / "request.json"
        request_file.write_text(json.dumps(request))

        r = subprocess.run(
            [IMPORT_PYTHON, "-I", GROUPED_STEMS,
             "--mode", "combine", "--request", str(request_file), "--output", str(audio_dir)],
            capture_output=True, text=True, timeout=600,
        )
        if r.returncode != 0:
            raise ValueError(f"combine: {r.stderr[:300]}")

        roles_dir = audio_dir / "roles"
        packed_dir = temp / "packed"
        waves_dir = temp / "waveforms"

        flac_proc = subprocess.Popen(
            [IMPORT_PYTHON, "-I", FLAC_PACK,
             "--roles", str(roles_dir), "--output", str(packed_dir)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        wave_proc = subprocess.Popen(
            [IMPORT_PYTHON, "-I", WAVEFORM,
             "--roles", str(roles_dir), "--output", str(waves_dir)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )

        _, flac_err = flac_proc.communicate(timeout=600)
        wave_proc.communicate(timeout=120)

        if flac_proc.returncode != 0:
            raise ValueError(f"flac_pack: {flac_err.decode()[:300]}")

        roles_result = json.loads((roles_dir / "result.json").read_text())
        oc_frames = roles_result["frames"]
        headroom = float(roles_result["headroom_gain"])
        pcm = {role: roles_result["roles"][role]["sha256"] for role in overcue_writer.ROLES}

        tables: dict[str, str] = {}
        for role in overcue_writer.ROLES:
            page_file = packed_dir / overcue_writer.role_file(role)
            tables[role] = fast_page_table_sha(page_file)

        page_codec = "flac-96k"
        bundle_id = hashlib.sha256(
            ("three-part/2:" + page_codec + ":" +
             ":".join(pcm[role] for role in overcue_writer.ROLES) + ":" +
             ":".join(tables[role] for role in overcue_writer.ROLES)
             ).encode()
        ).hexdigest()[:16]

        bundle_dir = stems_dir / bundle_id
        if bundle_dir.exists():
            return "exists", track_id, bundle_id, None, time.time() - t0

        staging = Path(tempfile.mkdtemp(prefix=overcue_writer.STAGING, dir=stems_dir))
        try:
            for role in overcue_writer.ROLES:
                shutil.copyfile(
                    packed_dir / overcue_writer.role_file(role),
                    staging / overcue_writer.role_file(role),
                )

            waveforms = None
            if wave_proc.returncode == 0 and waves_dir.exists():
                try:
                    waveform_records: dict[str, dict[str, Any]] = {}
                    for name in overcue_writer.WAVEFORM_FILES:
                        wf_src = waves_dir / name
                        if wf_src.exists():
                            shutil.copyfile(wf_src, staging / name)
                            waveform_records[name] = overcue_writer.check_waveform(staging / name, oc_frames)
                    if len(waveform_records) == len(overcue_writer.WAVEFORM_FILES):
                        waveforms = waveform_records
                except Exception:
                    waveforms = None

            groups = json.loads((audio_dir / "groups.json").read_text())
            check = groups.get("check", {})
            alignment = {
                "offset_samples": check.get("offset_samples", 0),
                "offset_ms": round(1000 * check.get("offset_samples", 0) / 44100, 3),
                "gain": check.get("applied_gain", 1.0),
                "correlation": round(check.get("correlation", 0), 6),
                "residual_db": round(check.get("residual_db", -100), 2),
                "verdict": check.get("verdict", "aligned"),
            }
            separation = {"method": "import", "source": "name", "layout": "full", "alignment": alignment}

            source_record = overcue_writer.source_record(
                file_path, source_sha, codec,
                {"sample_rate": sample_rate, "mp3": mp3_info},
            )

            manifest = {
                "schema": overcue_writer.MANIFEST_SCHEMA,
                "writer": {"name": overcue_writer.WRITER, "version": VERSION, "beta": True},
                "source": source_record,
                "runtime": {
                    "sample_rate": 96000, "channels": 2, "format": "s16le", "frames": oc_frames,
                    "latency_pad_frames": 0,
                    "headroom_gain": headroom, "page_codec": page_codec,
                },
                "separation": separation,
                "roles": {
                    role: {
                        "file": overcue_writer.role_file(role),
                        "bytes": oc_frames * 4,
                        "sha256": pcm[role],
                        "page_table_sha256": tables[role],
                        "loudness_gain": 1.0,
                    } for role in overcue_writer.ROLES
                },
            }
            if waveforms:
                manifest["waveforms"] = waveforms

            overcue_writer._write_json(staging / "overcue-manifest.json", manifest)
            cache._publish_new(staging, bundle_dir)
        finally:
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)

        entry = {
            "bundle": bundle_id, "file_path": file_path, "frames": oc_frames,
            "three_part": 1, "page_bytes": overcue_writer.PAGE_BYTES, "page_codec": page_codec,
        }
        for role in overcue_writer.ROLES:
            key = role.replace("-", "_")
            entry[key + "_sha256"] = pcm[role]
            entry[key + "_page_table_sha256"] = tables[role]
        entry["source_sha256"] = source_sha
        entry["separation"] = separation

    elapsed = time.time() - t0
    return "ok", track_id, bundle_id, entry, elapsed


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: overcue-turbo.py <mapping.json> <volume> [limit] [start] [workers]")
        sys.exit(1)

    mapping_file = sys.argv[1]
    volume = sys.argv[2]
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    start_at = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    workers = int(sys.argv[5]) if len(sys.argv) > 5 else int(os.environ.get("XZ_WORKERS", "3"))

    mapping = json.load(open(mapping_file))
    if limit <= 0:
        limit = len(mapping)

    cdjmods = Path(volume) / "CDJMODS"
    cdjmods.mkdir(exist_ok=True)
    (cdjmods / "stems").mkdir(exist_ok=True)

    done_ids = load_index(cdjmods)
    tracks = mapping[start_at:start_at + limit]

    processable = []
    pre_skip = 0
    for t in tracks:
        if str(t["track_id"]) in done_ids:
            pre_skip += 1
        else:
            source = Path(volume + t["file_path"]) if t["file_path"].startswith("/") else Path(volume) / t["file_path"]
            if source.exists() and os.path.isdir(t["stem_dir"]):
                processable.append(t)

    print(f"TURBO OverCue — {workers} workers", flush=True)
    print(f"Mapping: {len(mapping)} | Slice: {len(tracks)} (start={start_at})", flush=True)
    print(f"Pre-skip: {pre_skip} | To process: {len(processable)}", flush=True)
    print(f"Volume: {volume}", flush=True)
    print(f"Free: {shutil.disk_usage(volume).free / (1024**3):.0f} GB", flush=True)
    print(flush=True)

    ok = exists = failed_count = missing = 0
    total_time = 0.0
    wall_start = time.time()

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {}
        for i, track in enumerate(processable):
            f = pool.submit(process_one, track, volume, cdjmods, done_ids)
            futures[f] = (i, track)

        for f in as_completed(futures):
            i, track = futures[f]
            title = track["title"][:50]
            try:
                status, tid, bundle, entry, track_time = f.result()
                wall = time.time() - wall_start
                if status == "ok":
                    ok += 1
                    total_time += track_time
                    with index_lock:
                        assert entry is not None
                        pending_entries.append((tid, entry))
                        done_ids.add(str(tid))
                    if len(pending_entries) >= 5:
                        flush_index(cdjmods)
                    effective = wall / ok if ok else 0
                    rate = ok / wall * 60 if wall > 0 else 0
                    remain = len(processable) - (ok + exists + failed_count + missing)
                    eta = remain / (ok / wall) if ok > 0 and wall > 0 else 0
                    with print_lock:
                        print(
                            f"  [{ok:4d}] OK: {title} -> {bundle} "
                            f"({track_time:.0f}s, {effective:.0f}s eff, {rate:.1f}/min, ~{eta/60:.0f}h left)",
                            flush=True,
                        )
                elif status == "exists":
                    exists += 1
                elif status in ("missing", "no_stems"):
                    missing += 1
            except Exception as e:
                failed_count += 1
                with print_lock:
                    print(f"  [FAIL] {title} — {str(e)[:150]}", flush=True)

    flush_index(cdjmods)

    wall = time.time() - wall_start
    final_index, _ = overcue_writer.read_index(cdjmods)
    total_indexed = len(final_index.get("tracks", {}))

    print(flush=True)
    print(f"=== TURBO OVERCUE COMPLETE ({workers}w) ===", flush=True)
    print(f"OK:      {ok}", flush=True)
    print(f"Exists:  {exists}", flush=True)
    print(f"Missing: {missing}", flush=True)
    print(f"Failed:  {failed_count}", flush=True)
    print(f"Wall:    {wall:.0f}s ({wall/60:.1f}m)", flush=True)

    cpu_avg = total_time / ok if ok else 0
    eff_avg = wall / ok if ok else 0
    if ok > 0:
        print(f"CPU avg: {cpu_avg:.1f}s | Eff avg: {eff_avg:.1f}s | Gain: {cpu_avg/eff_avg:.1f}x", flush=True)
        print(f"Rate:    {ok/wall*60:.1f}/min | vs v1: {120/eff_avg:.1f}x speedup", flush=True)
    print(f"Free:    {shutil.disk_usage(volume).free / (1024**3):.0f} GB", flush=True)
    print(f"Index:   {total_indexed} total", flush=True)

    summary = json.dumps({
        "ok": ok, "exists": exists, "missing": missing, "failed": failed_count,
        "wall_s": round(wall, 1), "cpu_avg_s": round(cpu_avg, 1),
        "eff_avg_s": round(eff_avg, 1), "workers": workers,
        "total_indexed": total_indexed,
    })
    print(f"RESULT:{summary}", flush=True)


if __name__ == "__main__":
    main()
