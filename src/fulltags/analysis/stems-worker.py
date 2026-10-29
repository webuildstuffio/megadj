"""Persistent demucs-mlx stem separation worker — NDJSON over stdin/stdout.

Uses demucs-mlx (pure MLX, Metal-accelerated) for ~5-9x realtime on M4 Pro.
Same htdemucs_ft weights, identical output to torch Demucs (< 1 ppm).

Memory management: caps MLX Metal cache at 6 GB, clears after every track
to prevent GPU Timeout errors from memory pressure on 48 GB unified memory.

Protocol: same as beats-analysis worker (analysis-worker.ts adapter).

Request:  {"id": N, "path": "/path/to/track.m4a", "output_dir": "/path/to/stems/VIDEO_ID"}
Response: {"id": N, "status": "ok", "stems": {"vocals": "...", ...}, "elapsed_s": 30.5}
Error:    {"id": N, "status": "error", "error": "message"}
"""
from __future__ import annotations

import gc
import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import mlx.core as mx  # type: ignore[import-not-found]

_SIX_GB = 6 * 1024 * 1024 * 1024


def _setup_metal_limits() -> None:
    """Cap MLX Metal cache to prevent GPU timeout from memory pressure."""
    if hasattr(mx, "set_cache_limit"):
        mx.set_cache_limit(_SIX_GB)
    elif hasattr(mx, "metal") and hasattr(mx.metal, "set_cache_limit"):
        mx.metal.set_cache_limit(_SIX_GB)


def _clear_metal() -> None:
    """Release Metal GPU memory after each track to prevent OOM/timeout."""
    if hasattr(mx, "clear_cache"):
        mx.clear_cache()
    elif hasattr(mx, "metal") and hasattr(mx.metal, "clear_cache"):
        mx.metal.clear_cache()
    gc.collect()


def load_separator(model_name: str) -> Any:
    from demucs_mlx import Separator  # type: ignore[import-not-found]

    return Separator(
        model=model_name,
        shifts=1,
        overlap=0.25,
        batch_size=1,
    )


def separate_track(sep: Any, path: str, output_dir: str) -> dict[str, Any]:
    t0 = time.monotonic()
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    src = Path(path)
    if not src.exists():
        raise FileNotFoundError(f"source file missing: {path}")
    if src.stat().st_size == 0:
        raise ValueError(f"source file is empty (0 bytes): {path}")

    saved = sep.separate(
        path,
        output_dir=str(out),
        filename_format="{stem}.flac",
        bits_per_sample=16,
        clip="rescale",
    )

    _clear_metal()

    total_bytes = sum(p.stat().st_size for p in saved.values())

    import soundfile as sf  # type: ignore[import-not-found]

    info = sf.info(str(next(iter(saved.values()))))
    duration_s = info.duration

    stems: dict[str, str] = {name: str(p) for name, p in saved.items()}
    elapsed = time.monotonic() - t0
    return {
        "stems": stems,
        "elapsed_s": round(elapsed, 2),
        "duration_s": round(duration_s, 2),
        "output_bytes": total_bytes,
    }


def main() -> int:
    model_name = os.environ.get("DEMUCS_MODEL", "htdemucs_ft")
    _setup_metal_limits()

    try:
        t_load = time.monotonic()
        sep = load_separator(model_name)
        load_elapsed = round(time.monotonic() - t_load, 2)
    except Exception as exc:
        err = {"type": "error", "error": f"model load failed: {exc}"}
        sys.stdout.write(json.dumps(err) + "\n")
        sys.stdout.flush()
        return 1

    ready = {
        "type": "ready",
        "model": model_name,
        "device": "mlx",
        "sources": list(sep.model.sources),
        "samplerate": sep.model.samplerate,
        "load_elapsed_s": load_elapsed,
    }
    sys.stdout.write(json.dumps(ready) + "\n")
    sys.stdout.flush()

    processed = 0
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
            result = separate_track(sep, req["path"], req["output_dir"])
            processed += 1
            resp: dict[str, Any] = {
                "id": req_id,
                "status": "ok",
                "track_number": processed,
                **result,
            }
        except Exception as exc:
            tb = traceback.format_exception_only(type(exc), exc)
            resp = {
                "id": req_id,
                "status": "error",
                "error": str(exc),
                "error_type": type(exc).__name__,
                "traceback": "".join(tb).strip(),
            }
            _clear_metal()

        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
