"""P5c: MAEST probe comparison — extract features for all tracks, run same
5-fold artist-excluded probe as effnet baseline.

This is the FAIR test: same classifier, same evaluation, same corpus.
If MAEST (properly pooled) beats effnet, it's worth the full embed.

Usage:
    uv run --python python3.12 --with torch --with 'transformers>=4.45' \
      --with numpy --with librosa --with soundfile --with scikit-learn \
      python tools/maest_probe_compare.py [--limit N]
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import time
import unicodedata
from collections import Counter
from typing import Any

import librosa  # type: ignore[import-not-found]
import numpy as np
import torch  # type: ignore[import-not-found]
from sklearn.linear_model import LogisticRegression  # type: ignore[import-not-found]
from sklearn.metrics import accuracy_score, f1_score  # type: ignore[import-not-found]
from sklearn.model_selection import GroupKFold  # type: ignore[import-not-found]
from sklearn.preprocessing import LabelEncoder  # type: ignore[import-not-found]
from transformers import AutoFeatureExtractor, AutoModel  # type: ignore[import-not-found]

MODEL_ID = "mtg-upf/discogs-maest-30s-pw-129e"
SR = 16000
DURATION = 30.0

UMBRELLA = {"edm", "dance", "electronic", "mainstage edm"}
JUNK_RE = re.compile(
    r"djsoundtop|dj ?sound|soundcloud|youtube|spotify|apple ?music|"
    r"unknown|various|other|none|general|all music|loop samples|dj tools",
    re.IGNORECASE,
)
FAMILIES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"drum ?and ?bass|jungle|breakbeat|breaks|bass|dubstep|footwork|juke|grime|jersey club|donk|wall slappers", re.I), "bass"),
    (re.compile(r"(?<!bass )(?<!afro )house|disco|garage|boogie|electro|big ?room|future (?!bass)|hardstyle|bounce|eurodance|euro ?dance|nightcore|uptempo|hard dance|hardcore", re.I), "house"),
    (re.compile(r"techno|melodic|minimal(?! \/)|deep tech|hardtekk|softtekk|tekk", re.I), "techno"),
    (re.compile(r"trance|psy(?![a-z])", re.I), "trance"),
    (re.compile(r"hip ?[- ]?hop|rap|trap", re.I), "hiphop"),
    (re.compile(r"pop|rock|indie|alternative|punk|metal|folk|singer|country|top 40|chanson", re.I), "pop"),
    (re.compile(r"r ?& ?b|soul|funk|amapiano|afrobeat|afro ?house|reggaeton|latin|dancehall|reggae", re.I), "groove"),
    (re.compile(r"jazz|blues|ambient|downtempo|lofi|lo ?fi|classical|soundtrack|idm|chillwave|synthwave|world|spoken word|tutorial", re.I), "mood"),
    (re.compile(r"\bgroove\b", re.I), "groove"),
    (re.compile(r"\bdance\b|mainstream club|edm", re.I), "house"),
]


def classifier_family(genre: str) -> str | None:
    base = unicodedata.normalize("NFC", genre).strip().lower()
    base = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), base)
    if not base or re.match(r"^(music|unknown|fixme|other|none)\s*$", base):
        return None
    base = base.split(",")[0].strip()
    if base in UMBRELLA:
        return None
    if JUNK_RE.search(base):
        return None
    for pat, fam in FAMILIES:
        if pat.search(base):
            return fam
    return None


def main() -> None:
    limit = 200  # Default: quick sanity check on 200 tracks
    for i, arg in enumerate(sys.argv[1:]):
        if arg == "--limit" and i + 1 < len(sys.argv[1:]):
            limit = int(sys.argv[i + 2])

    db_path = os.environ.get("MEGADJ_DB", os.path.expanduser("~/.local/state/megadj/archive.db"))
    conn = sqlite3.connect(db_path)
    rows = conn.execute("""
        SELECT e.video_id, e.vec_json, t.genre, t.artist, t.file_path
        FROM embeddings e
        JOIN tracks t ON t.video_id = e.video_id
        WHERE e.model = 'effnet-discogs-1280'
          AND t.genre IS NOT NULL AND t.genre != ''
          AND t.status = 'downloaded'
          AND t.file_path IS NOT NULL
        ORDER BY RANDOM()
    """).fetchall()
    conn.close()

    # Filter to classifier-clean corpus
    corpus: list[dict[str, Any]] = []
    for vid, vj, genre, artist, fp in rows:
        fam = classifier_family(genre)
        if fam is None:
            continue
        if not os.path.exists(fp):
            continue
        effnet_vec = json.loads(vj)
        if not isinstance(effnet_vec, list) or len(effnet_vec) < 10:
            continue
        corpus.append({
            "vid": vid, "path": fp, "genre": genre, "artist": artist or "UNKNOWN",
            "family": fam,
            "effnet": np.array(effnet_vec, dtype=np.float32),
        })
        if len(corpus) >= limit:
            break

    print(f"Corpus: {len(corpus)} tracks, {len(set(c['family'] for c in corpus))} families", file=sys.stderr)
    print(f"  {dict(Counter(c['family'] for c in corpus).most_common())}", file=sys.stderr)

    # Load MAEST
    print("\nLoading MAEST...", file=sys.stderr)
    fe = AutoFeatureExtractor.from_pretrained(MODEL_ID, trust_remote_code=True)
    model = AutoModel.from_pretrained(MODEL_ID, output_hidden_states=True, trust_remote_code=True)
    model.eval()

    # Extract MAEST features
    print(f"Extracting MAEST features for {len(corpus)} tracks...", file=sys.stderr)
    t0 = time.time()
    failed = 0
    for i, c in enumerate(corpus):
        try:
            y, _ = librosa.load(c["path"], sr=SR, duration=DURATION, mono=True)
            inputs = fe(y, sampling_rate=SR, return_tensors="pt")
            with torch.no_grad():
                outputs = model(**inputs)
            hs = outputs.hidden_states
            # Stacked middle layers 6+8+10 (2304d)
            stacked = torch.cat([
                hs[6][:, 1:, :].mean(dim=1),
                hs[8][:, 1:, :].mean(dim=1),
                hs[10][:, 1:, :].mean(dim=1),
            ], dim=-1).squeeze().numpy()
            c["maest"] = stacked
            # Also extract layer 8 mean (768d)
            c["maest_l8"] = hs[8][:, 1:, :].mean(dim=1).squeeze().numpy()
        except Exception as e:
            print(f"  FAIL [{i}] {c['path']}: {e}", file=sys.stderr)
            c["maest"] = None
            c["maest_l8"] = None
            failed += 1

        if (i + 1) % 20 == 0:
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed
            eta = (len(corpus) - i - 1) / rate
            print(f"  [{i+1}/{len(corpus)}] {rate:.1f} tracks/s, ETA {eta:.0f}s", file=sys.stderr)

    # Filter out failures
    corpus = [c for c in corpus if c.get("maest") is not None]
    print(f"\nExtracted {len(corpus)} tracks ({failed} failed), {time.time() - t0:.0f}s total", file=sys.stderr)

    # Prepare feature matrices
    families = [c["family"] for c in corpus]
    artists = [c["artist"] for c in corpus]
    le = LabelEncoder()
    y = le.fit_transform(families).astype(np.int32)
    ln = list(le.classes_)
    ale = LabelEncoder()
    groups = ale.fit_transform(artists).astype(np.int32)

    def l2_norm(X: np.ndarray) -> Any:
        norms = np.linalg.norm(X, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return X / norms

    X_effnet = l2_norm(np.array([c["effnet"] for c in corpus], dtype=np.float32))
    X_maest_stacked = l2_norm(np.array([c["maest"] for c in corpus], dtype=np.float32))
    X_maest_l8 = l2_norm(np.array([c["maest_l8"] for c in corpus], dtype=np.float32))

    # Run probes
    print(f"\n{'Model':<25} {'mF1':>6} {'Acc':>6}  ", end="", file=sys.stderr)
    for name in ln:
        print(f"{name[:6]:>7}", end="", file=sys.stderr)
    print(file=sys.stderr)
    print("─" * (25 + 6 + 6 + 2 + 7 * len(ln)), file=sys.stderr)

    configs = [
        ("effnet-1280 (baseline)", X_effnet),
        ("MAEST stacked 6+8+10", X_maest_stacked),
        ("MAEST layer-8 mean", X_maest_l8),
    ]

    for name, X in configs:
        gkf = GroupKFold(n_splits=5)
        all_true, all_pred = [], []
        for tri, tei in gkf.split(X, y, groups):
            clf = LogisticRegression(max_iter=2000, C=10, solver="lbfgs")
            clf.fit(X[tri], y[tri])
            all_pred.extend(clf.predict(X[tei]).tolist())
            all_true.extend(y[tei].tolist())
        yt = np.array(all_true)
        yp = np.array(all_pred)
        mf1 = f1_score(yt, yp, average="macro")
        acc = accuracy_score(yt, yp)
        print(f"{name:<25} {mf1:>5.1%} {acc:>5.1%}  ", end="", file=sys.stderr)
        for i, _n in enumerate(ln):
            mask = yt == i
            nc = int(mask.sum())
            recall = float((yp[mask] == i).sum() / nc) if nc > 0 else 0
            print(f"{recall:>6.0%}", end=" ", file=sys.stderr)
        print(file=sys.stderr)


if __name__ == "__main__":
    main()
