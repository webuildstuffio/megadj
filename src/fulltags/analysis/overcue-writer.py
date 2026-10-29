"""OverCue stems format writer — NDJSON over stdin/stdout.

Reads Demucs-separated FLAC stems (vocals, drums, bass, other),
resamples to 96 kHz, and writes the 7 OverCue mixes as PGZ files
plus the overcue-manifest.json.

Request:  {"id": "...", "source": "/path/to/original.mp3",
           "stems": {"vocals": "...", "drums": "...", "bass": "...", "other": "..."},
           "output_dir": "/vol/CDJMODS/stems/<bundle>"}
Response: {"id": "...", "status": "ok", "frames": N, "elapsed_s": 1.2}
Error:    {"id": "...", "status": "error", "error": "message"}
"""
from __future__ import annotations

import hashlib
import json
import struct
import sys
import time
import zlib
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf  # type: ignore[import-not-found]

PAGE_BYTES = 131072
RATE = 96000
CHANNELS = 2
FRAME_BYTES = CHANNELS * 2

ROLE_NAMES = [
    "drums",        # mask 1
    "harmonics",    # mask 2 (bass + other)
    "vocal",        # mask 4
    "full-mix",     # mask 7 (all stems)
    "instrumental", # mask 3 (drums + harmonics)
    "vocals-drums",      # mask 5
    "vocals-harmonics",  # mask 6
]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def resample_to_96k(audio: np.ndarray, sr: int) -> np.ndarray:
    """Resample stereo audio to 96 kHz using linear interpolation."""
    if sr == RATE:
        return audio
    from scipy.signal import resample_poly  # type: ignore[import-untyped]
    gcd = np.gcd(RATE, sr)
    up = RATE // gcd
    down = sr // gcd
    result: np.ndarray = resample_poly(audio, up, down, axis=0).astype(np.float32)
    return result


def float_to_s16le(audio: np.ndarray) -> np.ndarray:
    """Convert float32 stereo to int16 little-endian."""
    clipped = np.clip(audio, -1.0, 1.0)
    result: np.ndarray = np.rint(clipped * 32767).astype("<i2")
    return result


def write_pgz(path: str, pcm_s16: np.ndarray) -> tuple[int, str]:
    """Write a PGZ file. Returns (frame_count, page_table_sha256)."""
    raw = pcm_s16.tobytes(order="C")
    total_bytes = len(raw)
    page_count = (total_bytes + PAGE_BYTES - 1) // PAGE_BYTES

    pages: list[dict[str, Any]] = []
    compressed_blobs: list[bytes] = []

    for i in range(page_count):
        start = i * PAGE_BYTES
        end = min(start + PAGE_BYTES, total_bytes)
        page_data = raw[start:end]
        compressed = zlib.compress(page_data, level=6)
        sha = hashlib.sha256(page_data).digest()
        pages.append({
            "bytes": len(page_data),
            "compressed": len(compressed),
            "sha": sha,
        })
        compressed_blobs.append(compressed)

    header = b"OVPGZ001"
    header += struct.pack(">I", PAGE_BYTES)
    header += struct.pack(">I", page_count)
    header += struct.pack(">Q", total_bytes)

    table_offset = 24
    data_offset = table_offset + page_count * 48

    table_entries: list[bytes] = []
    current_offset = data_offset
    for i, page in enumerate(pages):
        entry = struct.pack(">Q", current_offset)
        entry += struct.pack(">I", page["compressed"])
        entry += struct.pack(">I", page["bytes"])
        entry += page["sha"]
        table_entries.append(entry)
        current_offset += page["compressed"]

    table_data = b"".join(table_entries)
    table_hash = hashlib.sha256(header + table_data).hexdigest()

    with open(path, "wb") as f:
        f.write(header)
        f.write(table_data)
        for blob in compressed_blobs:
            f.write(blob)

    frames = total_bytes // FRAME_BYTES
    return frames, table_hash


def build_overcue_bundle(
    source_path: str,
    stems: dict[str, str],
    output_dir: str,
) -> dict[str, Any]:
    """Build a complete OverCue stems bundle from Demucs output."""
    t0 = time.monotonic()
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    vocals_raw, sr_v = sf.read(stems["vocals"], dtype="float32")
    drums_raw, sr_d = sf.read(stems["drums"], dtype="float32")
    bass_raw, sr_b = sf.read(stems["bass"], dtype="float32")
    other_raw, sr_o = sf.read(stems["other"], dtype="float32")

    sr = sr_v
    if not (sr_d == sr and sr_b == sr and sr_o == sr):
        raise ValueError(f"Sample rate mismatch: {sr_v} {sr_d} {sr_b} {sr_o}")

    vocals_96 = resample_to_96k(vocals_raw, sr)
    drums_96 = resample_to_96k(drums_raw, sr)
    bass_96 = resample_to_96k(bass_raw, sr)
    other_96 = resample_to_96k(other_raw, sr)

    harmonics_96 = bass_96 + other_96
    full_mix_96 = vocals_96 + drums_96 + harmonics_96
    instrumental_96 = drums_96 + harmonics_96
    vocals_drums_96 = vocals_96 + drums_96
    vocals_harmonics_96 = vocals_96 + harmonics_96

    mixes = {
        "drums": drums_96,
        "harmonics": harmonics_96,
        "vocal": vocals_96,
        "full-mix": full_mix_96,
        "instrumental": instrumental_96,
        "vocals-drums": vocals_drums_96,
        "vocals-harmonics": vocals_harmonics_96,
    }

    source_sha = sha256_file(source_path)
    roles: dict[str, Any] = {}
    frames = None

    for name in ROLE_NAMES:
        audio = mixes[name]
        s16 = float_to_s16le(audio)
        pgz_path = str(out / f"stems-sidecar-{name}.s16le.pgz")
        f_count, table_sha = write_pgz(pgz_path, s16)
        if frames is None:
            frames = f_count
        elif f_count != frames:
            raise ValueError(f"Frame count mismatch: {name}={f_count}, expected {frames}")

        peak = float(np.max(np.abs(audio)))
        gain = min(1.0, 1.0 / peak) if peak > 0 else 1.0

        roles[name] = {
            "bytes": f_count * FRAME_BYTES,
            "page_table_sha256": table_sha,
            "loudness_gain": round(gain, 9),
        }

    manifest = {
        "schema": "overcue-stems/4",
        "source": {
            "sha256": source_sha,
        },
        "runtime": {
            "sample_rate": RATE,
            "channels": CHANNELS,
            "format": "s16le",
            "frames": frames,
        },
        "roles": roles,
    }

    manifest_path = out / "overcue-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    elapsed = time.monotonic() - t0
    return {"frames": frames, "elapsed_s": round(elapsed, 2), "source_sha256": source_sha}


def main() -> int:
    ready = {"type": "ready", "format": "overcue-stems/4", "rate": RATE}
    sys.stdout.write(json.dumps(ready) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        req_id = req.get("id")
        try:
            result = build_overcue_bundle(
                req["source"], req["stems"], req["output_dir"],
            )
            resp = {"id": req_id, "status": "ok", **result}
        except Exception as exc:
            resp = {"id": req_id, "status": "error", "error": str(exc)}

        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
