"""Compute section embeddings with multiple models for bench comparison.

Reads a JSON manifest on stdin:
  {tracks: [{path, sections: [{start, end}]}], models: [...]}

Writes JSON to stdout:
  {model: {path: [[embedding], ...]}}  (one embedding per section)

Models: effnet-discogs-1280, vggish-128, msd-musicnn-200, openl3-music-512, maest-10s-768
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.lib.embedding import (
    chunks,
    emb_effnet,
    emb_musicnn,
    frame_mel,
    normalize,
)

FloatArray = NDArray[np.float32]

MODEL_DIR = Path.home() / ".local/share/fulltags-models"
TMP = Path("/tmp/emb-bench")


def audio_section(path: str, start: float, end: float, rate: int = 16000) -> FloatArray:
    from essentia.standard import MonoLoader  # type: ignore[import-not-found]

    full = np.asarray(
        MonoLoader(filename=path, sampleRate=rate, resampleQuality=4)(),
        dtype=np.float32,
    )
    s = int(start * rate)
    e = int(end * rate)
    section = full[s:e]
    if len(section) < rate:
        return full
    return section


def emb_vggish(a16k: FloatArray, sess: Any) -> FloatArray:
    from essentia.standard import TensorflowInputVGGish

    mel = frame_mel(a16k, TensorflowInputVGGish(), 400, 200)
    batch = chunks(mel, 96).transpose(0, 2, 1)
    out = sess.run(["embeddings"], {"melspectrogram": batch})[0]
    return normalize(
        np.asarray(out, dtype=np.float32).mean(axis=0, keepdims=False).astype(np.float32)
    )


def emb_openl3(path: str, start: float, end: float, sess: Any) -> FloatArray:
    """OpenL3 needs 48kHz audio — loads separately."""
    from essentia.standard import (
        FrameGenerator,
        MelBands,
        MonoLoader,
        Spectrum,
        Windowing,
    )

    full = np.asarray(
        MonoLoader(filename=path, sampleRate=48000, resampleQuality=4)(),
        dtype=np.float32,
    )
    s, e = int(start * 48000), int(end * 48000)
    a = full[s:e] if (e - s) >= 48000 else full

    w = Windowing(size=2048, normalized=False)
    sp = Spectrum(size=2048)
    mb = MelBands(
        highFrequencyBound=24000,
        inputSize=1025,
        log=False,
        lowFrequencyBound=0,
        normalize="unit_tri",
        numberBands=128,
        sampleRate=48000,
        type="magnitude",
        warpingFormula="slaneyMel",
        weighting="linear",
    )

    amin, d_range = 1e-10, 80.0
    patch = 48000
    n = (len(a) // patch) * patch
    mels: list[FloatArray] = []
    for st in range(0, max(1, n - patch + 1), patch):
        frames = [
            mb(sp(w(fr)))
            for fr in FrameGenerator(
                a[st : st + patch], frameSize=2048, hopSize=242, validFrameThresholdRatio=0.5
            )
        ]
        m = np.asarray(frames, dtype=np.float32)
        m = np.asarray(10.0 * np.log10(np.maximum(amin, m)), dtype=np.float32)
        m = np.maximum(m, m.max() - d_range)
        m -= m.max()
        mels.append(m)
    if not mels:
        return np.zeros(512, dtype=np.float32)
    mel = np.vstack(mels)
    patches: list[FloatArray] = []
    x_size = 199
    for i in range(0, max(1, mel.shape[0] - x_size + 1), x_size):
        chunk = mel[i : i + x_size]
        if chunk.shape[0] < x_size:
            chunk = np.pad(chunk, ((0, x_size - chunk.shape[0]), (0, 0)))
        patches.append(chunk.T)
    arr = np.asarray(patches, dtype=np.float32)[..., np.newaxis]
    out = sess.run(["embeddings"], {"melspectrogram": arr})[0]
    return normalize(
        np.asarray(out, dtype=np.float32).mean(axis=0, keepdims=False).astype(np.float32)
    )


def emb_maest(a16k: FloatArray, sess: Any) -> FloatArray:
    """MAEST 10s: 626-frame mel spectrogram @ 16kHz, 768-d token embedding."""
    from essentia.standard import TensorflowInputMusiCNN

    mel = frame_mel(a16k, TensorflowInputMusiCNN(), 512, 256)
    target_frames = 626
    if mel.shape[0] < target_frames:
        mel = np.pad(mel, ((0, target_frames - mel.shape[0]), (0, 0)))
    batch_mels = []
    for i in range(0, max(1, mel.shape[0] - target_frames + 1), target_frames):
        batch_mels.append(mel[i : i + target_frames])
    batch = np.asarray(batch_mels, dtype=np.float32)
    out = sess.run(["layer_11_tokens"], {"melspectrogram": batch})[0]
    tokens = np.asarray(out, dtype=np.float32)
    pooled: FloatArray = tokens.mean(axis=(0, 1)).astype(np.float32)
    return normalize(pooled)


MODELS = {
    "effnet-discogs-1280": (f"{MODEL_DIR}/discogs-effnet-bsdynamic-1.onnx", 1280),
    "vggish-128": (f"{MODEL_DIR}/audioset-vggish-3.onnx", 128),
    "msd-musicnn-200": (f"{TMP}/msd-musicnn.onnx", 200),
    "openl3-music-512": (f"{TMP}/openl3.onnx", 512),
    "maest-10s-768": (f"{TMP}/maest-10s.onnx", 768),
}


def main() -> None:
    manifest = json.load(sys.stdin)
    tracks = manifest["tracks"]
    model_names = manifest.get("models", list(MODELS.keys()))

    import onnxruntime as ort  # type: ignore[import-not-found]

    prov = ["CPUExecutionProvider"]
    result: dict[str, dict[str, list[list[float]]]] = {}

    for model_name in model_names:
        if model_name not in MODELS:
            print(f"[skip] unknown model: {model_name}", file=sys.stderr)
            continue
        model_path, dim = MODELS[model_name]
        if not Path(model_path).exists():
            print(f"[skip] model missing: {model_name} ({model_path})", file=sys.stderr)
            continue

        print(f"[{model_name}] loading...", file=sys.stderr)
        sess = ort.InferenceSession(model_path, providers=prov)
        model_result: dict[str, list[list[float]]] = {}
        t0 = time.time()
        done = 0
        fails = 0

        for track in tracks:
            path = track["path"]
            sections = track["sections"]
            embs: list[list[float]] = []

            for sec in sections:
                try:
                    start, end = sec["start"], sec["end"]
                    if model_name == "openl3-music-512":
                        vec = emb_openl3(path, start, end, sess)
                    else:
                        a16k = audio_section(path, start, end)
                        if model_name == "effnet-discogs-1280":
                            vec = emb_effnet(a16k, sess)
                        elif model_name == "vggish-128":
                            vec = emb_vggish(a16k, sess)
                        elif model_name == "msd-musicnn-200":
                            vec = emb_musicnn(a16k, sess)
                        elif model_name == "maest-10s-768":
                            vec = emb_maest(a16k, sess)
                        else:
                            vec = np.zeros(dim, dtype=np.float32)
                    embs.append(vec.tolist())
                except Exception as exc:
                    fails += 1
                    if fails <= 3:
                        print(f"  [{model_name}] fail: {exc!r:.120}", file=sys.stderr)
                    embs.append([0.0] * dim)

            model_result[path] = embs
            done += 1
            if done % 10 == 0:
                elapsed = time.time() - t0
                print(
                    f"  [{model_name}] {done}/{len(tracks)} ({elapsed:.0f}s, {fails} fails)",
                    file=sys.stderr,
                )

        elapsed = time.time() - t0
        print(
            f"  [{model_name}] done: {done} tracks, {fails} fails, {elapsed:.0f}s",
            file=sys.stderr,
        )
        result[model_name] = model_result
        del sess

    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
