"""Persistent Demucs stem separation worker — NDJSON over stdin/stdout.

Loads the model ONCE, then processes tracks one at a time.
Protocol: same as beats-analysis worker (analysis-worker.ts adapter).

Request:  {"id": N, "path": "/path/to/track.m4a", "output_dir": "/path/to/stems/VIDEO_ID"}
Response: {"id": N, "status": "ok", "stems": {"vocals": "...", ...}, "elapsed_s": 30.5}
Error:    {"id": N, "status": "error", "error": "message"}
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import soundfile as sf  # type: ignore[import-not-found]
import torch  # type: ignore[import-not-found]

STEM_NAMES = ("drums", "bass", "other", "vocals")


def detect_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_model(model_name: str, device: str) -> Any:
    from demucs.pretrained import get_model  # type: ignore[import-not-found]

    model = get_model(model_name)
    model.to(device)
    model.eval()
    return model


def _clear_mps_cache() -> None:
    """Release MPS memory after each track to prevent OOM on long batches."""
    if hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
        torch.mps.empty_cache()


def separate_track(model: Any, path: str, output_dir: str, device: str) -> dict[str, Any]:
    from demucs.apply import apply_model  # type: ignore[import-not-found]
    from demucs.audio import AudioFile  # type: ignore[import-not-found]

    t0 = time.monotonic()
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    # Validate the source file is readable before committing GPU time
    src = Path(path)
    if not src.exists():
        raise FileNotFoundError(f"source file missing: {path}")
    if src.stat().st_size == 0:
        raise ValueError(f"source file is empty (0 bytes): {path}")

    audio = AudioFile(path).read(
        seek_time=0,
        streams=0,
        samplerate=model.samplerate,
        channels=model.audio_channels,
    )

    duration_s = audio.shape[-1] / model.samplerate
    ref = audio.mean(0)
    audio_norm = (audio - ref.mean()) / ref.std()

    # shifts=2: average 2 random-offset passes for better boundary quality
    # (htdemucs_ft default is 1; 2 improves SDR ~0.1-0.3 dB at ~2x cost,
    #  but per-track wall time stays under 60s on MPS which is fine).
    # overlap=0.25 is the default for stable segment transitions.
    with torch.inference_mode():
        sources = apply_model(
            model,
            audio_norm[None].to(device),
            device=device,
            shifts=2,
            overlap=0.25,
            progress=False,
        )

    sources = sources[0] * ref.std() + ref.mean()
    sources = sources.cpu()

    # Free GPU tensors before writing FLAC (I/O bound, no GPU needed)
    del audio, audio_norm, ref
    _clear_mps_cache()

    stems: dict[str, str] = {}
    total_bytes = 0
    for i, name in enumerate(model.sources):
        stem_path = out / f"{name}.flac"
        sf.write(str(stem_path), sources[i].numpy().T, model.samplerate, format="FLAC")
        total_bytes += stem_path.stat().st_size
        stems[name] = str(stem_path)

    elapsed = time.monotonic() - t0
    return {
        "stems": stems,
        "elapsed_s": round(elapsed, 2),
        "duration_s": round(duration_s, 2),
        "output_bytes": total_bytes,
    }


def main() -> int:
    model_name = os.environ.get("DEMUCS_MODEL", "htdemucs_ft")
    device = detect_device()

    try:
        t_load = time.monotonic()
        model = load_model(model_name, device)
        load_elapsed = round(time.monotonic() - t_load, 2)
    except Exception as exc:
        err = {"type": "error", "error": f"model load failed: {exc}"}
        sys.stdout.write(json.dumps(err) + "\n")
        sys.stdout.flush()
        return 1

    ready = {
        "type": "ready",
        "model": model_name,
        "device": device,
        "sources": list(model.sources),
        "samplerate": model.samplerate,
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
            result = separate_track(
                model,
                req["path"],
                req["output_dir"],
                device,
            )
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
            # Clear GPU state after an error to prevent cascade failures
            _clear_mps_cache()

        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
