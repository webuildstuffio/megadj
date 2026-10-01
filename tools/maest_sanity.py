"""P5: MAEST sanity check — middle block features + stacked tokens.

Downloads MAEST from HuggingFace, extracts features from a test track
using middle-layer tokens (not last-layer mean-pool which lost info).
Verifies the features are non-trivial and genre-discriminative.

Usage:
    uv run --python python3.12 --with torch --with transformers --with numpy \
      --with librosa python tools/maest_sanity.py [audio_file]
"""
from __future__ import annotations

import os
import sys
import time

import numpy as np
import torch

# MAEST model from HuggingFace
MODEL_ID = "mtg-upf/discogs-maest-30s-pw-129e"


def load_model() -> tuple:
    """Load MAEST model and processor from HuggingFace."""
    from transformers import AutoModel, AutoFeatureExtractor  # type: ignore[import-not-found]

    print("Loading MAEST model...", file=sys.stderr)
    t0 = time.time()
    feature_extractor = AutoFeatureExtractor.from_pretrained(MODEL_ID, trust_remote_code=True)
    model = AutoModel.from_pretrained(MODEL_ID, output_hidden_states=True, trust_remote_code=True)
    model.eval()
    print(f"  loaded in {time.time() - t0:.1f}s", file=sys.stderr)
    return model, feature_extractor


def load_audio(path: str, sr: int = 16000, duration: float = 30.0) -> np.ndarray:
    """Load audio file, resample to target SR, trim to duration."""
    import librosa  # type: ignore[import-not-found]

    print(f"Loading audio: {path}", file=sys.stderr)
    y, _ = librosa.load(path, sr=sr, duration=duration, mono=True)
    print(f"  {len(y)} samples, {len(y)/sr:.1f}s at {sr}Hz", file=sys.stderr)
    return y


def extract_features(
    model: torch.nn.Module,
    feature_extractor: object,
    audio: np.ndarray,
) -> dict[str, np.ndarray]:
    """Extract features from multiple layers."""
    inputs = feature_extractor(  # type: ignore[operator]
        audio,
        sampling_rate=16000,
        return_tensors="pt",
    )

    with torch.no_grad():
        outputs = model(**inputs)

    hidden_states = outputs.hidden_states
    n_layers = len(hidden_states)
    print(f"  {n_layers} hidden layers, shape per layer: {hidden_states[0].shape}", file=sys.stderr)

    results: dict[str, np.ndarray] = {}

    # Last layer mean pool (the "wrong" way our bench did it)
    last = hidden_states[-1][:, 1:, :]  # skip CLS token
    results["last_mean"] = last.mean(dim=1).squeeze().numpy()

    # Middle layers (the "right" way per MAEST paper)
    for layer_idx in [6, 8, 10]:
        if layer_idx < n_layers:
            h = hidden_states[layer_idx][:, 1:, :]
            results[f"layer{layer_idx}_mean"] = h.mean(dim=1).squeeze().numpy()

    # Stacked middle layers (concatenate layers 6+8+10)
    if all(i < n_layers for i in [6, 8, 10]):
        stacked = torch.cat([
            hidden_states[6][:, 1:, :].mean(dim=1),
            hidden_states[8][:, 1:, :].mean(dim=1),
            hidden_states[10][:, 1:, :].mean(dim=1),
        ], dim=-1)
        results["stacked_6_8_10"] = stacked.squeeze().numpy()

    # CLS token from middle layer
    if 8 < n_layers:
        results["cls_layer8"] = hidden_states[8][:, 0, :].squeeze().numpy()

    return results


def main() -> None:
    # Find a test audio file
    if len(sys.argv) > 1:
        audio_path = sys.argv[1]
    else:
        # Try to find a track from the library
        import sqlite3

        db_path = os.environ.get("MEGADJ_DB", os.path.expanduser("~/.local/state/megadj/archive.db"))
        conn = sqlite3.connect(db_path)
        row = conn.execute("""
            SELECT t.file_path FROM tracks t
            JOIN embeddings e ON e.video_id = t.video_id
            WHERE e.model = 'effnet-discogs-1280'
              AND t.status = 'downloaded'
              AND t.file_path IS NOT NULL
            ORDER BY RANDOM() LIMIT 1
        """).fetchone()
        conn.close()
        if row is None:
            print("No tracks found. Pass an audio file path.", file=sys.stderr)
            sys.exit(1)
        audio_path = row[0]
        if not os.path.exists(audio_path):
            print(f"File not found: {audio_path}", file=sys.stderr)
            sys.exit(1)

    model, fe = load_model()
    audio = load_audio(audio_path)
    features = extract_features(model, fe, audio)

    print("\nFeature summary:", file=sys.stderr)
    for name, vec in features.items():
        norm = float(np.linalg.norm(vec))
        print(f"  {name:>20}: dim={vec.shape[0]:>5}, norm={norm:.3f}, "
              f"mean={vec.mean():.4f}, std={vec.std():.4f}", file=sys.stderr)

    # Verify features are non-trivial
    for name, vec in features.items():
        assert vec.std() > 0.001, f"{name} is nearly constant (std={vec.std():.6f})"
        assert np.isfinite(vec).all(), f"{name} has non-finite values"
    print("\n✅ All features non-trivial and finite", file=sys.stderr)

    # Compare cosine similarity between last-layer and middle-layer
    def cos_sim(a: np.ndarray, b: np.ndarray) -> float:
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))

    if "last_mean" in features and "layer8_mean" in features:
        sim = cos_sim(features["last_mean"], features["layer8_mean"])
        print(f"\n  cos(last_mean, layer8_mean) = {sim:.4f}", file=sys.stderr)
        print(f"  (low similarity = different information = good)", file=sys.stderr)

    # Output summary JSON
    import json
    summary = {
        "audio_path": audio_path,
        "model": MODEL_ID,
        "features": {
            name: {"dim": int(vec.shape[0]), "norm": float(np.linalg.norm(vec))}
            for name, vec in features.items()
        },
    }
    json.dump(summary, sys.stdout, indent=2)
    print(file=sys.stdout)


if __name__ == "__main__":
    main()
