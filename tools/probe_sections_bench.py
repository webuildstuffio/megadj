"""Stage A+B: Compare probe on whole-track vs section vs combined embeddings.

Requires section embeddings cached in section_embeddings table
(run cache_section_embeddings.py first).

Usage:
    uv run --python python3.12 --with scikit-learn --with numpy \
      python tools/probe_sections_bench.py [--db PATH]
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import unicodedata
from collections import Counter
from typing import Any

import numpy as np
from numpy.typing import NDArray
from sklearn.linear_model import LogisticRegression  # type: ignore[import-not-found]
from sklearn.metrics import accuracy_score, f1_score  # type: ignore[import-not-found]
from sklearn.model_selection import GroupKFold  # type: ignore[import-not-found]
from sklearn.preprocessing import LabelEncoder  # type: ignore[import-not-found]

# ── Genre family mapping — classifier-clean (umbrella excluded, edm→house) ──

UMBRELLA = {"edm", "dance", "electronic", "mainstage edm"}

JUNK_RE = re.compile(
    r"djsoundtop|dj ?sound|soundcloud|youtube|spotify|apple ?music|"
    r"unknown|various|other|none|general|all music|loop samples|dj tools",
    re.IGNORECASE,
)

FAMILIES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"drum ?and ?bass|jungle|breakbeat|breaks|bass|dubstep|footwork|juke|grime|jersey club|donk|wall slappers", re.I), "bass"),
    (re.compile(r"(?<!bass )(?<!afro )house|disco|garage|boogie", re.I), "house"),
    (re.compile(r"techno|melodic|minimal(?! \/)|deep tech|hardtekk|softtekk|tekk", re.I), "techno"),
    (re.compile(r"trance|psy(?![a-z])", re.I), "trance"),
    (re.compile(r"hip ?[- ]?hop|rap|trap", re.I), "hiphop"),
    (re.compile(r"edm|electro|big ?room|future (?!bass)|hardstyle|bounce|eurodance|euro ?dance|nightcore|uptempo|hard dance|hardcore", re.I), "edm"),
    (re.compile(r"pop|rock|indie|alternative|punk|metal|folk|singer|country|top 40|chanson", re.I), "pop"),
    (re.compile(r"r ?& ?b|soul|funk|amapiano|afrobeat|afro ?house|reggaeton|latin|dancehall|reggae", re.I), "groove"),
    (re.compile(r"jazz|blues|ambient|downtempo|lofi|lo ?fi|classical|soundtrack|idm|chillwave|synthwave|world|spoken word|tutorial", re.I), "mood"),
    (re.compile(r"\bgroove\b", re.I), "groove"),
    (re.compile(r"\bdance\b|mainstream club", re.I), "edm"),
]

CLASSIFIER_MERGES = {"edm": "house"}


def classifier_family(genre: str) -> str | None:
    """Same as classifierFamily() in genre-vocab.ts — umbrella exclusion + merge."""
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
            return CLASSIFIER_MERGES.get(fam, fam)
    return None


def l2_normalize(X: NDArray[np.float32]) -> NDArray[np.float32]:
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return X / norms


def load_all(db_path: str) -> dict[str, Any]:
    """Load whole-track + section embeddings for tracks with both."""
    conn = sqlite3.connect(db_path)

    # Whole-track embeddings
    wt_rows = conn.execute("""
        SELECT e.video_id, e.vec_json, t.genre, t.artist
        FROM embeddings e
        JOIN tracks t ON t.video_id = e.video_id
        WHERE e.model = 'effnet-discogs-1280'
          AND t.genre IS NOT NULL AND t.genre != ''
          AND t.status = 'downloaded'
    """).fetchall()

    wt_map: dict[str, list[float]] = {}
    genre_map: dict[str, str] = {}
    artist_map: dict[str, str] = {}
    for vid, vj, genre, artist in wt_rows:
        fam = classifier_family(genre)
        if fam is None:
            continue
        try:
            vec = json.loads(vj)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(vec, list) or len(vec) < 10:
            continue
        wt_map[vid] = vec
        genre_map[vid] = fam
        artist_map[vid] = artist or "UNKNOWN"

    # Section embeddings
    sec_rows = conn.execute("""
        SELECT video_id, model, vec_json FROM section_embeddings
        WHERE model LIKE 'effnet-discogs-1280-section-%'
        ORDER BY video_id, model
    """).fetchall()
    conn.close()

    sec_map: dict[str, list[list[float]]] = {}
    for vid, _model, vj in sec_rows:
        if vid not in wt_map:
            continue
        try:
            vec = json.loads(vj)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(vec, list) or len(vec) < 10:
            continue
        sec_map.setdefault(vid, []).append(vec)

    # Only keep tracks with both whole-track AND section embeddings
    common_ids = sorted(set(wt_map) & set(sec_map))

    return {
        "ids": common_ids,
        "wt_vecs": [wt_map[v] for v in common_ids],
        "sec_vecs": [sec_map[v] for v in common_ids],
        "families": [genre_map[v] for v in common_ids],
        "artists": [artist_map[v] for v in common_ids],
    }


def eval_probe(
    X: NDArray[np.float32],
    y: NDArray[np.int32],
    groups: NDArray[np.int32],
    label_names: list[str],
    n_splits: int = 5,
    C: float = 10.0,
    balanced: bool = False,
) -> dict[str, Any]:
    gkf = GroupKFold(n_splits=n_splits)
    all_true, all_pred = [], []
    for train_idx, test_idx in gkf.split(X, y, groups):
        clf = LogisticRegression(
            max_iter=2000,
            class_weight="balanced" if balanced else None,
            C=C,
            solver="lbfgs",
        )
        clf.fit(X[train_idx], y[train_idx])
        pred = clf.predict(X[test_idx])
        all_true.extend(y[test_idx].tolist())
        all_pred.extend(pred.tolist())

    yt = np.array(all_true, dtype=np.int32)
    yp = np.array(all_pred, dtype=np.int32)
    mf1 = float(f1_score(yt, yp, average="macro"))
    acc = float(accuracy_score(yt, yp))

    per_class = {}
    for i, name in enumerate(label_names):
        mask = yt == i
        n_cls = int(mask.sum())
        recall = float((yp[mask] == i).sum() / n_cls) if n_cls > 0 else 0.0
        per_class[name] = {"recall": round(recall, 4), "n": n_cls}

    return {"macro_f1": round(mf1, 4), "accuracy": round(acc, 4), "per_class": per_class}


def main() -> None:
    db_path = os.environ.get("MEGADJ_DB", os.path.expanduser("~/.local/state/megadj/archive.db"))
    data = load_all(db_path)

    n = len(data["ids"])
    if n == 0:
        print("No tracks with both whole-track and section embeddings. Run cache_section_embeddings.py first.", file=sys.stderr)
        sys.exit(1)

    le = LabelEncoder()
    y = le.fit_transform(data["families"]).astype(np.int32)
    label_names = list(le.classes_)
    artist_le = LabelEncoder()
    groups = artist_le.fit_transform(data["artists"]).astype(np.int32)

    print(f"Tracks with both whole-track + section: {n}", file=sys.stderr)
    print(f"Families: {dict(Counter(data['families']).most_common())}", file=sys.stderr)
    print(f"Artists: {len(set(data['artists']))}\n", file=sys.stderr)

    # Prepare feature matrices
    X_wt = l2_normalize(np.array(data["wt_vecs"], dtype=np.float32))

    # Section mean: average of all section embeddings per track
    sec_means = []
    for sec_list in data["sec_vecs"]:
        arr = np.array(sec_list, dtype=np.float32)
        sec_means.append(arr.mean(axis=0))
    X_sec_mean = l2_normalize(np.array(sec_means, dtype=np.float32))

    # Combined: concatenate whole-track + section mean (2560d)
    X_combined = l2_normalize(np.hstack([X_wt, X_sec_mean]))

    # Combined: mean+std pooling of sections (2560d)
    sec_meanstd = []
    for sec_list in data["sec_vecs"]:
        arr = np.array(sec_list, dtype=np.float32)
        m = arr.mean(axis=0)
        s = arr.std(axis=0) if arr.shape[0] > 1 else np.zeros_like(m)
        sec_meanstd.append(np.concatenate([m, s]))
    X_sec_meanstd = l2_normalize(np.array(sec_meanstd, dtype=np.float32))

    # All 4 sections concatenated (whole + 3 sections = 5120d)
    all_cat = []
    for i in range(n):
        wt = np.array(data["wt_vecs"][i], dtype=np.float32)
        secs = data["sec_vecs"][i]
        while len(secs) < 3:
            secs.append([0.0] * len(secs[0]) if secs else [0.0] * 1280)
        cat = np.concatenate([wt] + [np.array(s, dtype=np.float32) for s in secs[:3]])
        all_cat.append(cat)
    X_all_cat = l2_normalize(np.array(all_cat, dtype=np.float32))

    # ── Run experiments ──
    strategies = {
        "whole_track_only": X_wt,
        "section_mean_only": X_sec_mean,
        "section_mean+std": X_sec_meanstd,
        "whole+sec_mean (concat)": X_combined,
        "whole+3sec (concat 5120d)": X_all_cat,
    }

    print(f"{'Strategy':<30} {'mF1':>6} {'Acc':>6}  ", end="", file=sys.stderr)
    for name in label_names:
        print(f"{name[:6]:>7}", end="", file=sys.stderr)
    print(file=sys.stderr)
    print(f"{'─' * (30 + 6 + 6 + 2 + 7 * len(label_names))}", file=sys.stderr)

    results = []
    for name, X in strategies.items():
        r = eval_probe(X, y, groups, label_names, C=10.0)
        print(f"{name:<30} {r['macro_f1']:>5.1%} {r['accuracy']:>5.1%}  ", end="", file=sys.stderr)
        for ln in label_names:
            pc = r["per_class"].get(ln, {"recall": 0.0})
            print(f"{pc['recall']:>6.0%}", end=" ", file=sys.stderr)
        print(file=sys.stderr)
        results.append({"strategy": name, **r})

    # Also test balanced probe on best strategy
    print("\n--- Balanced probe on best strategies ---\n", file=sys.stderr)
    for name in ["whole+sec_mean (concat)", "whole+3sec (concat 5120d)"]:
        X = strategies[name]
        r = eval_probe(X, y, groups, label_names, C=10.0, balanced=True)
        print(f"{name + ' [bal]':<30} {r['macro_f1']:>5.1%} {r['accuracy']:>5.1%}  ", end="", file=sys.stderr)
        for ln in label_names:
            pc = r["per_class"].get(ln, {"recall": 0.0})
            print(f"{pc['recall']:>6.0%}", end=" ", file=sys.stderr)
        print(file=sys.stderr)
        results.append({"strategy": name + " [balanced]", **r})

    json.dump({"n": n, "results": results}, sys.stdout, indent=2)
    print(file=sys.stdout)


if __name__ == "__main__":
    main()
