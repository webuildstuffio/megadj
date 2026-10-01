"""P5b: MAEST genre discrimination — quick cosine-distance check on 10 tracks.

Extracts MAEST middle-layer features from tracks of different families and
compares within-family vs between-family cosine distances. If MAEST
discriminates better than effnet, within-family distances should be smaller.

Usage:
    uv run --python python3.12 --with torch --with 'transformers>=4.45' \
      --with numpy --with librosa --with soundfile \
      python tools/maest_discrimination.py
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import time

import librosa  # type: ignore[import-not-found]
import numpy as np
import torch
from transformers import AutoFeatureExtractor, AutoModel  # type: ignore[import-not-found]

MODEL_ID = "mtg-upf/discogs-maest-30s-pw-129e"
SR = 16000
DURATION = 30.0
N_PER_FAMILY = 2
TARGET_FAMILIES = ["house", "techno", "hiphop", "groove", "trance"]


def load_model() -> tuple:
    print("Loading MAEST...", file=sys.stderr)
    t0 = time.time()
    fe = AutoFeatureExtractor.from_pretrained(MODEL_ID, trust_remote_code=True)
    model = AutoModel.from_pretrained(MODEL_ID, output_hidden_states=True, trust_remote_code=True)
    model.eval()
    print(f"  loaded in {time.time() - t0:.1f}s", file=sys.stderr)
    return model, fe


def extract_stacked(model: torch.nn.Module, fe: object, audio_path: str) -> np.ndarray | None:
    """Extract stacked layers 6+8+10 mean-pooled (2304d)."""
    try:
        y, _ = librosa.load(audio_path, sr=SR, duration=DURATION, mono=True)
    except Exception as e:
        print(f"  SKIP {audio_path}: {e}", file=sys.stderr)
        return None
    inputs = fe(y, sampling_rate=SR, return_tensors="pt")  # type: ignore[operator]
    with torch.no_grad():
        outputs = model(**inputs)
    hs = outputs.hidden_states
    stacked = torch.cat([
        hs[6][:, 1:, :].mean(dim=1),
        hs[8][:, 1:, :].mean(dim=1),
        hs[10][:, 1:, :].mean(dim=1),
    ], dim=-1)
    vec = stacked.squeeze().numpy()
    return vec / (np.linalg.norm(vec) + 1e-8)


def cos_sim(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))


def main() -> None:
    db_path = os.environ.get("MEGADJ_DB", os.path.expanduser("~/.local/state/megadj/archive.db"))
    conn = sqlite3.connect(db_path)

    # Load effnet vecs + pick tracks per family
    classifier_merges = {"edm": "house"}
    umbrella = {"edm", "dance", "electronic", "mainstage edm"}

    tracks: list[dict] = []
    for fam in TARGET_FAMILIES:
        rows = conn.execute("""
            SELECT t.video_id, t.file_path, t.genre, t.title, t.artist, e.vec_json
            FROM tracks t
            JOIN embeddings e ON e.video_id = t.video_id
            WHERE e.model = 'effnet-discogs-1280'
              AND t.status = 'downloaded'
              AND t.file_path IS NOT NULL
              AND t.genre IS NOT NULL AND t.genre != ''
            ORDER BY RANDOM()
            LIMIT 200
        """).fetchall()

        count = 0
        for vid, fp, genre, title, artist, vj in rows:
            if count >= N_PER_FAMILY:
                break
            if not os.path.exists(fp):
                continue
            # Quick family check
            g = genre.lower().split(",")[0].strip()
            if g in umbrella:
                continue
            # Very rough family check
            family_map = {
                "house": ["house", "disco", "garage", "electro", "big room"],
                "techno": ["techno", "melodic", "minimal", "deep tech"],
                "hiphop": ["hip-hop", "hip hop", "rap", "trap"],
                "groove": ["r&b", "soul", "funk", "amapiano", "afro"],
                "trance": ["trance", "psy"],
            }
            matched_fam = None
            for f, keywords in family_map.items():
                if any(k in g for k in keywords):
                    matched_fam = f
                    break
            if matched_fam != fam:
                continue

            effnet_vec = json.loads(vj)
            effnet_vec = np.array(effnet_vec, dtype=np.float32)
            effnet_vec = effnet_vec / (np.linalg.norm(effnet_vec) + 1e-8)

            tracks.append({
                "vid": vid, "path": fp, "genre": genre, "title": title,
                "artist": artist, "family": fam, "effnet": effnet_vec,
            })
            count += 1

    conn.close()

    print(f"\nSelected {len(tracks)} tracks across {len(TARGET_FAMILIES)} families", file=sys.stderr)
    for t in tracks:
        print(f"  {t['family']:>8} | {t['artist']} - {t['title'][:40]}", file=sys.stderr)

    model, fe = load_model()

    # Extract MAEST features
    for t in tracks:
        print(f"  extracting {t['title'][:30]}...", file=sys.stderr)
        t["maest"] = extract_stacked(model, fe, t["path"])

    tracks = [t for t in tracks if t.get("maest") is not None]

    # Compare within vs between family cosine similarities
    print(f"\n{'':>45} {'effnet':>8} {'maest':>8}", file=sys.stderr)
    print("-" * 65, file=sys.stderr)

    within_effnet, between_effnet = [], []
    within_maest, between_maest = [], []

    for i in range(len(tracks)):
        for j in range(i + 1, len(tracks)):
            ti, tj = tracks[i], tracks[j]
            e_sim = cos_sim(ti["effnet"], tj["effnet"])
            m_sim = cos_sim(ti["maest"], tj["maest"])
            same = ti["family"] == tj["family"]
            tag = "SAME" if same else "DIFF"

            if same:
                within_effnet.append(e_sim)
                within_maest.append(m_sim)
            else:
                between_effnet.append(e_sim)
                between_maest.append(m_sim)

            print(f"  {tag:>4} {ti['family']:>8}-{tj['family']:<8} "
                  f"{ti['title'][:15]:>15} vs {tj['title'][:15]:<15} "
                  f"{e_sim:>7.3f}  {m_sim:>7.3f}", file=sys.stderr)

    print(f"\n{'Summary':>25} {'effnet':>8} {'maest':>8}", file=sys.stderr)
    print("-" * 45, file=sys.stderr)
    if within_effnet:
        print(f"  Within-family mean cos:  {np.mean(within_effnet):>7.3f}  {np.mean(within_maest):>7.3f}", file=sys.stderr)
    if between_effnet:
        print(f"  Between-family mean cos: {np.mean(between_effnet):>7.3f}  {np.mean(between_maest):>7.3f}", file=sys.stderr)
    if within_effnet and between_effnet:
        e_gap = np.mean(within_effnet) - np.mean(between_effnet)
        m_gap = np.mean(within_maest) - np.mean(between_maest)
        print(f"  Discrimination gap:      {e_gap:>7.3f}  {m_gap:>7.3f}", file=sys.stderr)
        print(f"  (higher gap = better genre separation)", file=sys.stderr)


if __name__ == "__main__":
    main()
