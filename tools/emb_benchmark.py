"""Embedding model benchmark harness — Set/FullTags.

Towers (all free, local, ONNX, CPU):
  1. discogs-effnet (incumbent, 1280-d)   ~/.local/share/fulltags-models
  2. openl3-music-mel128-emb512 (512-d)   /tmp/emb-bench/openl3.onnx
  3. msd-musicnn (200-d)                  /tmp/emb-bench/msd-musicnn.onnx
  4. audioset-vggish (128-d)              ~/.local/share/fulltags-models
  5. clap-htsat-unfused (512-d)           /tmp/emb-bench/clap-htsat.onnx

Eval protocol (mirrors docs/fulltags/genre-audit.md SS5b.1 and the
results table in docs/fulltags/embedding-models.md):
  - eval set: tracks per genre family from archive.db (shelf files, human
    genre = label truth-of-record); cached to /tmp/emb-bench/eval_set.json
  - leave-one-out kNN family agreement per tower (cosine)
  - top-k neighbor family coherence (retrieval-quality proxy)
  - wall-clock seconds per track

Usage:
  uv run --with essentia --with onnxruntime --with numpy \
    python tools/emb_benchmark.py --per-family 10 --k 5 \
    --towers msd-musicnn-200,effnet-discogs-1280
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from collections.abc import Callable
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

FloatArray = NDArray[np.float32]

ARCHIVE_DB = Path.home() / ".local/state/megadj/archive.db"
MODEL_DIR = Path.home() / ".local/share/fulltags-models"
TMP = Path("/tmp/emb-bench")

SESS: dict[str, object] = {}
CUR = ""  # session key for the tower currently being benchmarked


def sess() -> object:
    return SESS[CUR]


def load_eval_set(per_family: int) -> dict[str, list[str]]:
    """Load eval set from the cached JSON (files verified to exist)."""
    by_fam: dict[str, list[str]] = json.loads((TMP / "eval_set.json").read_text())
    return {f: v[:per_family] for f, v in by_fam.items()}


def chunks(frames: FloatArray, size: int) -> FloatArray:
    n = (frames.shape[0] // size) * size
    return frames[:n].reshape(-1, size, frames.shape[1])


def audio(path: str, rate: int = 16000) -> FloatArray:
    from essentia.standard import MonoLoader

    return np.asarray(
        MonoLoader(filename=path, sampleRate=rate, resampleQuality=4)(),
        dtype=np.float32,
    )


def frame_mel(
    a: FloatArray,
    algo: Callable[[FloatArray], FloatArray],
    frame_size: int,
    hop: int,
) -> FloatArray:
    from essentia.standard import FrameGenerator

    return np.asarray(
        [algo(f) for f in FrameGenerator(a, frameSize=frame_size, hopSize=hop)],
        dtype=np.float32,
    )


def normalize(v: FloatArray) -> FloatArray:
    return v / (float(np.linalg.norm(v)) + 1e-9)


def embedding_metrics(
    vectors: FloatArray, labels: NDArray[np.str_], k: int
) -> tuple[int, float, float]:
    """Return valid-row count, LOO agreement, and neighbor coherence.

    Failed embeddings are zero rows.  Keep their source indices separate from
    positions in the compact valid-row matrix so self-exclusion stays correct.
    """
    if k < 1:
        raise ValueError("k must be at least 1")
    if vectors.shape[0] != labels.shape[0]:
        raise ValueError("vectors and labels must have the same row count")

    valid = np.linalg.norm(vectors, axis=1) > 0
    source_indices = np.flatnonzero(valid)
    total = int(source_indices.size)
    neighbor_count = min(k, max(0, total - 1))
    if neighbor_count == 0:
        return total, 0.0, 0.0

    compact = vectors[valid]
    agree = 0
    coherence: list[float] = []
    for compact_index, source_index in enumerate(source_indices):
        similarities = compact @ compact[compact_index]
        similarities[compact_index] = -np.inf
        top_positions = np.argsort(-similarities)[:neighbor_count]
        top_sources = source_indices[top_positions]
        votes = Counter(labels[index] for index in top_sources)
        if votes.most_common(1)[0][0] == labels[source_index]:
            agree += 1
        coherence.append(
            float(np.mean([labels[index] == labels[source_index] for index in top_sources]))
        )

    return total, agree / total, float(np.mean(coherence))


def run_embeddings(name: str, batch: FloatArray) -> FloatArray:
    session = sess()
    assert hasattr(session, "run"), "session not initialized"
    out = session.run(["embeddings"], {"melspectrogram": batch})[0]
    result: FloatArray = np.asarray(out, dtype=np.float32)
    return result


# ---- tower adapters: path -> L2-normalized mean embedding --------------


def emb_effnet(path: str) -> FloatArray:
    from essentia.standard import TensorflowInputMusiCNN

    a = audio(path)
    mel = frame_mel(a, TensorflowInputMusiCNN(), 512, 256)
    batch = chunks(mel, 128)
    return normalize(run_embeddings("effnet", batch).mean(axis=0))


def emb_openl3(path: str) -> FloatArray:
    # OpenL3 music mel128: 48kHz, 2048/242 frames, 128 mels, dB range 80
    # (frontend per the official essentia OpenL3 extraction script).
    from essentia.standard import FrameGenerator, MelBands, Spectrum, Windowing

    a = audio(path, 48000)
    w = Windowing(size=2048, normalized=False)
    s = Spectrum(size=2048)
    mb = MelBands(
        highFrequencyBound=48000 / 2,
        inputSize=2048 // 2 + 1,
        log=False,
        lowFrequencyBound=0,
        normalize="unit_tri",
        numberBands=128,
        sampleRate=48000,
        type="magnitude",
        warpingFormula="slaneyMel",
        weighting="linear",
    )

    def mel_of(chunk: FloatArray) -> FloatArray:
        return np.asarray(
            [
                mb(s(w(fr)))
                for fr in FrameGenerator(
                    chunk,
                    frameSize=2048,
                    hopSize=242,
                    validFrameThresholdRatio=0.5,
                )
            ],
            dtype=np.float32,
        )

    amin, d_range, db_ref = 1e-10, 80.0, 1.0
    patch = 48000  # 1s patches
    n = (len(a) // patch) * patch
    mels: list[FloatArray] = []
    for start in range(0, n - patch + 1, patch):
        m = mel_of(a[start : start + patch])
        m = np.asarray(10.0 * np.log10(np.maximum(amin, m)), dtype=np.float32)
        m -= 10.0 * np.log10(np.maximum(amin, db_ref))
        m = np.maximum(m, m.max() - d_range)
        m -= m.max()
        mels.append(m.astype(np.float32))
    if not mels:
        raise ValueError("audio too short for openl3")
    mel = np.vstack(mels)
    patches: list[FloatArray] = []
    x_size = 199
    for i in range(0, max(1, mel.shape[0] - x_size + 1), x_size):
        chunk = mel[i : i + x_size]
        if chunk.shape[0] < x_size:
            chunk = np.pad(chunk, ((0, x_size - chunk.shape[0]), (0, 0)))
        patches.append(chunk.T)  # (128, 199)
    arr: FloatArray = np.asarray(patches, dtype=np.float32)[..., np.newaxis]  # (b,128,199,1)
    return normalize(run_embeddings("openl3", arr).mean(axis=0))


def emb_musicnn(path: str) -> FloatArray:
    from essentia.standard import TensorflowInputMusiCNN

    a = audio(path)
    mel = frame_mel(a, TensorflowInputMusiCNN(), 512, 256)
    batch = chunks(mel, 187)  # musicnn trains on ~3s (187 frames @ 16k/256)
    return normalize(run_embeddings("musicnn", batch).mean(axis=0))


def emb_vggish(path: str) -> FloatArray:
    from essentia.standard import TensorflowInputVGGish

    a = audio(path)
    mel = frame_mel(a, TensorflowInputVGGish(), 400, 200)
    batch = chunks(mel, 96).transpose(0, 2, 1)
    return normalize(run_embeddings("vggish", batch).mean(axis=0))


def emb_clap(path: str) -> FloatArray:
    # CLAP HTSAT unfused: 48kHz, log-mel 64 bands / 1024 fft / 480 hop,
    # exactly 1001 frames; center 10s for speed (CLAP max 10s).
    a = audio(path, 48000)
    center = a[len(a) // 2 - 240000 : len(a) // 2 + 240000]
    if len(center) < 480000:
        center = np.pad(a, (0, 480000 - len(a)))[:480000]
    n_fft, hop, n_mels = 1024, 480, 64
    frames = np.lib.stride_tricks.sliding_window_view(center, n_fft)[::hop]
    if frames.shape[0] < 1001:
        frames = np.pad(frames, ((0, 1001 - frames.shape[0]), (0, 0)))
    frames = frames[:1001]
    win = np.hanning(n_fft).astype(np.float32)
    spec = np.abs(np.fft.rfft(frames * win, axis=1)) ** 2

    def hz2mel(hz: float) -> float:
        return float(2595 * np.log10(1 + hz / 700))

    def mel2hz(m: float) -> float:
        return float(700 * (10.0 ** (m / 2595) - 1))

    mels: FloatArray = np.linspace(hz2mel(0), hz2mel(24000), n_mels + 2, dtype=np.float32)
    freqs = np.fft.rfftfreq(n_fft, 1 / 48000).astype(np.float32)
    fb = np.zeros((n_mels, len(freqs)), dtype=np.float32)
    for i in range(n_mels):
        lo, mid, hi = (
            mel2hz(float(mels[i])),
            mel2hz(float(mels[i + 1])),
            mel2hz(float(mels[i + 2])),
        )
        up = (freqs - lo) / (mid - lo + 1e-9)
        down = (hi - freqs) / (hi - mid + 1e-9)
        fb[i] = np.maximum(0, np.minimum(up, down))
    mel_spec = np.log(spec @ fb.T + 1e-6).astype(np.float32)
    inp = mel_spec[np.newaxis, np.newaxis, :, :]  # (1,1,1001,64)
    session = sess()
    assert hasattr(session, "run"), "session not initialized"
    out = session.run(
        ["embeddings"],
        {"input_features": inp, "is_longer": np.zeros((1, 1), dtype=bool)},
    )[0]
    return normalize(np.asarray(out, dtype=np.float32).flatten())


TOWERS: dict[str, tuple[Callable[[str], FloatArray], str, int]] = {
    "effnet-discogs-1280": (
        emb_effnet,
        f"{MODEL_DIR}/discogs-effnet-bsdynamic-1.onnx",
        1280,
    ),
    "openl3-music-512": (emb_openl3, f"{TMP}/openl3.onnx", 512),
    "msd-musicnn-200": (emb_musicnn, f"{TMP}/msd-musicnn.onnx", 200),
    "vggish-128": (emb_vggish, f"{MODEL_DIR}/audioset-vggish-3.onnx", 128),
    "clap-htsat-512": (emb_clap, f"{TMP}/clap-htsat.onnx", 512),
}


def main() -> None:
    global CUR
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--per-family", type=int, default=10)
    parser.add_argument("--k", type=int, default=5)
    parser.add_argument("--towers", default=",".join(TOWERS))
    args = parser.parse_args()
    if args.per_family < 1:
        parser.error("--per-family must be at least 1")
    if args.k < 1:
        parser.error("--k must be at least 1")

    import onnxruntime as ort

    prov = ["CPUExecutionProvider"]

    eval_set = load_eval_set(args.per_family)
    tracks = [(fam, path) for fam, paths in eval_set.items() for path in paths]
    labels = np.array([fam for fam, _ in tracks])
    print(
        f"eval set: {len(tracks)} tracks across {len(eval_set)} families: {dict(Counter(labels))}",
        file=sys.stderr,
    )

    for name in args.towers.split(","):
        if name not in TOWERS:
            continue
        fn, model_path, dim = TOWERS[name]
        if not Path(model_path).exists():
            print(f"[{name}] model missing, skipped: {model_path}", file=sys.stderr)
            continue
        SESS[name] = ort.InferenceSession(model_path, providers=prov)
        CUR = name
        vecs: list[FloatArray] = []
        t0 = time.time()
        fails = 0
        for _fam, path in tracks:
            try:
                vecs.append(fn(path))
            except Exception as e:  # benchmark must continue on per-file errors
                vecs.append(np.zeros(dim, dtype=np.float32))
                fails += 1
                if fails <= 3:
                    print(f"[{name}] fail {fails}: {e!r:.200}", file=sys.stderr)
        elapsed = time.time() - t0
        X = np.stack(vecs)
        total, loo, coh = embedding_metrics(X, labels, args.k)

        print(
            json.dumps(
                {
                    "tower": name,
                    "dim": dim,
                    "n": total,
                    "fails": fails,
                    "loo_knn_agreement": round(loo, 4),
                    "family_coherence_atk": round(coh, 4),
                    "sec_per_track": round(elapsed / len(tracks), 3),
                }
            ),
            flush=True,
        )
        del SESS[name]


if __name__ == "__main__":
    main()
