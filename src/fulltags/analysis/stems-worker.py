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


def separate_track(model: Any, path: str, output_dir: str, device: str) -> dict[str, Any]:
    from demucs.apply import apply_model  # type: ignore[import-not-found]
    from demucs.audio import AudioFile  # type: ignore[import-not-found]

    t0 = time.monotonic()
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    audio = AudioFile(path).read(
        seek_time=0, streams=0,
        samplerate=model.samplerate,
        channels=model.audio_channels,
    )
    ref = audio.mean(0)
    audio_norm = (audio - ref.mean()) / ref.std()

    # shifts=2: average 2 random-offset passes for better boundary quality
    # (htdemucs_ft default is 1; 2 improves SDR ~0.1-0.3 dB at ~2x cost,
    #  but per-track wall time stays under 60s on MPS which is fine).
    # overlap=0.25 is the default for stable segment transitions.
    with torch.inference_mode():
        sources = apply_model(
            model, audio_norm[None].to(device),
            device=device, shifts=2, overlap=0.25, progress=False,
        )

    sources = sources[0] * ref.std() + ref.mean()
    sources = sources.cpu()

    stems = {}
    for i, name in enumerate(model.sources):
        stem_path = out / f"{name}.flac"
        sf.write(str(stem_path), sources[i].numpy().T, model.samplerate, format="FLAC")
        stems[name] = str(stem_path)

    elapsed = time.monotonic() - t0
    return {"stems": stems, "elapsed_s": round(elapsed, 2)}


def main() -> int:
    model_name = os.environ.get("DEMUCS_MODEL", "htdemucs_ft")
    device = detect_device()

    try:
        model = load_model(model_name, device)
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
    }
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
            result = separate_track(
                model, req["path"], req["output_dir"], device,
            )
            resp = {"id": req_id, "status": "ok", **result}
        except Exception as exc:
            resp = {"id": req_id, "status": "error", "error": str(exc)}

        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
