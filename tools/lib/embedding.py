"""Shared ONNX embedding frontends for tools/ bench + cache scripts.

Dedupe of the five emb_effnet/emb_musicnn copies (#457 target 8, #482):
one MusiCNN-family frontend parameterized by chunk size, with per-model
aliases (effnet chunks 128 frames, musicnn 187).

Numeric contract, identical to the retired copies: 16 kHz mono float32 in;
essentia TensorflowInputMusiCNN mel (frame 512 / hop 256); reshape to
(n, chunk, bands); ONNX "embeddings" output -> float32 -> chunk-mean ->
L2 normalize. Audio shorter than one chunk pads a single zero chunk when
pad_empty (section_model_bench / cache_section_embeddings behavior) or
yields an empty batch that the ONNX session rejects when not
(emb_benchmark behavior; its harness counts a per-file failure).

normalize is v / (|v| + 1e-9) with zero vectors passing through. The
guardless emb_benchmark form is output-identical in every case; the retired
cache copy's v / |v| with a 1e-8 gate differed only within 1 ULP on real
embeddings (norms >> 1e-8), never on zero vectors.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
from numpy.typing import NDArray

FloatArray = NDArray[np.float32]

MUSICNN_FRAME_SIZE = 512
MUSICNN_HOP = 256
EFFNET_CHUNK = 128
MUSICNN_CHUNK = 187  # musicnn trains on ~3s (187 frames @ 16k/256)


def normalize(v: FloatArray) -> FloatArray:
    n = float(np.linalg.norm(v))
    return v / (n + 1e-9) if n > 0 else v


def frame_mel(
    a: FloatArray,
    algo: Callable[[FloatArray], FloatArray],
    frame_size: int,
    hop: int,
) -> FloatArray:
    from essentia.standard import FrameGenerator  # type: ignore[import-not-found]

    return np.asarray(
        [algo(f) for f in FrameGenerator(a, frameSize=frame_size, hopSize=hop)],
        dtype=np.float32,
    )


def chunks(frames: FloatArray, size: int, *, pad_empty: bool = True) -> FloatArray:
    n = (frames.shape[0] // size) * size
    if n == 0 and pad_empty:
        return np.zeros((1, size, frames.shape[1]), dtype=np.float32)
    return frames[:n].reshape(-1, size, frames.shape[1])


def embed_musiconn(
    a16k: FloatArray,
    sess: Any,
    *,
    chunk_size: int,
    pad_empty: bool = True,
) -> FloatArray:
    from essentia.standard import TensorflowInputMusiCNN

    mel = frame_mel(a16k, TensorflowInputMusiCNN(), MUSICNN_FRAME_SIZE, MUSICNN_HOP)
    batch = chunks(mel, chunk_size, pad_empty=pad_empty)
    out = sess.run(["embeddings"], {"melspectrogram": batch})[0]
    return normalize(np.asarray(out, dtype=np.float32).mean(axis=0).astype(np.float32))


def emb_effnet(a16k: FloatArray, sess: Any) -> FloatArray:
    return embed_musiconn(a16k, sess, chunk_size=EFFNET_CHUNK)


def emb_musicnn(a16k: FloatArray, sess: Any) -> FloatArray:
    return embed_musiconn(a16k, sess, chunk_size=MUSICNN_CHUNK)
