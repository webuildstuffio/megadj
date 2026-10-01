"""Stage A extended: C-sweep, SVM, ensemble, confusion analysis.

Usage:
    uv run --python python3.12 --with scikit-learn --with numpy python tools/probe_bench_ext.py [--db PATH]
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import unicodedata
from typing import Any

import numpy as np
from numpy.typing import NDArray
from sklearn.linear_model import LogisticRegression  # type: ignore[import-not-found]
from sklearn.metrics import (  # type: ignore[import-not-found]
    accuracy_score,
    confusion_matrix,
    f1_score,
)
from sklearn.model_selection import GroupKFold  # type: ignore[import-not-found]
from sklearn.neighbors import KNeighborsClassifier  # type: ignore[import-not-found]
from sklearn.preprocessing import LabelEncoder  # type: ignore[import-not-found]
from sklearn.svm import SVC  # type: ignore[import-not-found]

# ── Genre family mapping (mirrors genre-vocab.ts FAMILIES) ──────────────

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


def normalize_genre(g: str) -> str:
    return unicodedata.normalize("NFC", g).strip().lower()


def family_of(genre: str) -> str | None:
    base = normalize_genre(genre)
    if not base or JUNK_RE.search(base):
        return None
    for pat, fam in FAMILIES:
        if pat.search(base):
            return fam
    return None


def load_corpus(db_path: str) -> tuple[NDArray[np.float32], list[str], list[str]]:
    conn = sqlite3.connect(db_path)
    rows = conn.execute("""
        SELECT e.vec_json, t.genre, t.artist
        FROM embeddings e
        JOIN tracks t ON t.video_id = e.video_id
        WHERE e.model = 'effnet-discogs-1280'
          AND t.genre IS NOT NULL AND t.genre != ''
          AND t.status = 'downloaded'
    """).fetchall()
    conn.close()

    vecs, families, artists = [], [], []
    for vec_json, genre, artist in rows:
        fam = family_of(genre)
        if fam is None:
            continue
        try:
            vec = json.loads(vec_json)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(vec, list) or len(vec) < 10:
            continue
        vecs.append(vec)
        families.append(fam)
        artists.append(artist or "UNKNOWN")

    X = np.array(vecs, dtype=np.float32)
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    X = X / norms
    return X, families, artists


def eval_cv(
    X: NDArray[np.float32],
    y: NDArray[np.int32],
    groups: NDArray[np.int32],
    make_clf: Any,
    n_splits: int = 5,
) -> tuple[float, float, NDArray[np.int32], NDArray[np.int32]]:
    """5-fold artist-excluded CV. Returns (macro_f1, accuracy, y_true, y_pred)."""
    gkf = GroupKFold(n_splits=n_splits)
    all_true, all_pred = [], []
    for train_idx, test_idx in gkf.split(X, y, groups):
        clf = make_clf()
        clf.fit(X[train_idx], y[train_idx])
        pred = clf.predict(X[test_idx])
        all_true.extend(y[test_idx].tolist())
        all_pred.extend(pred.tolist())
    yt = np.array(all_true, dtype=np.int32)
    yp = np.array(all_pred, dtype=np.int32)
    return (
        float(f1_score(yt, yp, average="macro")),
        float(accuracy_score(yt, yp)),
        yt,
        yp,
    )


def main() -> None:
    db_path = os.environ.get("MEGADJ_DB", os.path.expanduser("~/.local/state/megadj/archive.db"))
    X, families, artists = load_corpus(db_path)
    le = LabelEncoder()
    y = le.fit_transform(families).astype(np.int32)
    label_names = list(le.classes_)
    artist_le = LabelEncoder()
    groups = artist_le.fit_transform(artists).astype(np.int32)

    print(f"Corpus: {len(families)} tracks, {len(label_names)} families, {len(set(artists))} artists\n", file=sys.stderr)

    results: list[dict[str, Any]] = []

    # ── C-sweep for logistic probe ──
    print("━━ Logistic Probe C-sweep (balanced) ━━\n", file=sys.stderr)
    best_c, best_f1 = 1.0, 0.0
    for c in [0.001, 0.01, 0.1, 0.5, 1.0, 5.0, 10.0, 50.0]:
        f1, acc, _, _ = eval_cv(
            X, y, groups,
            lambda c=c: LogisticRegression(max_iter=2000, class_weight="balanced", C=c, solver="lbfgs"),
        )
        marker = ""
        if f1 > best_f1:
            best_f1 = f1
            best_c = c
            marker = " ← BEST"
        print(f"  C={c:<6} mF1={f1:.1%}  acc={acc:.1%}{marker}", file=sys.stderr)
    print(f"\n  Best C: {best_c} (mF1={best_f1:.1%})\n", file=sys.stderr)

    # ── kNN k-sweep ──
    print("━━ kNN k-sweep (plain) ━━\n", file=sys.stderr)
    best_k, best_knn_f1 = 5, 0.0
    for k in [3, 5, 7, 11, 15, 21, 31]:
        f1, acc, _, _ = eval_cv(
            X, y, groups,
            lambda k=k: KNeighborsClassifier(n_neighbors=k, metric="cosine"),
        )
        marker = ""
        if f1 > best_knn_f1:
            best_knn_f1 = f1
            best_k = k
            marker = " ← BEST"
        print(f"  k={k:<4} mF1={f1:.1%}  acc={acc:.1%}{marker}", file=sys.stderr)
    print(f"\n  Best k: {best_k} (mF1={best_knn_f1:.1%})\n", file=sys.stderr)

    # ── SVM (RBF, balanced) ──
    print("━━ SVM RBF (balanced) ━━\n", file=sys.stderr)
    for c in [0.1, 1.0, 10.0]:
        f1, acc, _, _ = eval_cv(
            X, y, groups,
            lambda c=c: SVC(kernel="rbf", C=c, class_weight="balanced", gamma="scale"),
        )
        print(f"  C={c:<6} mF1={f1:.1%}  acc={acc:.1%}", file=sys.stderr)

    # ── Final comparison: best of each ──
    print("\n━━ FINAL COMPARISON ━━\n", file=sys.stderr)

    classifiers = {
        f"probe_C{best_c}": lambda: LogisticRegression(max_iter=2000, class_weight="balanced", C=best_c, solver="lbfgs"),
        "probe_unbalanced": lambda: LogisticRegression(max_iter=2000, C=best_c, solver="lbfgs"),
        f"knn_k{best_k}": lambda: KNeighborsClassifier(n_neighbors=best_k, metric="cosine"),
        "svm_rbf_balanced": lambda: SVC(kernel="rbf", C=1.0, class_weight="balanced", gamma="scale"),
    }

    best_method, best_yt, best_yp = "", None, None
    best_final_f1 = 0.0

    print(f"  {'Method':<25} {'mF1':>6} {'Acc':>6}  ", end="", file=sys.stderr)
    for name in label_names:
        print(f"{name[:5]:>6}", end="", file=sys.stderr)
    print(file=sys.stderr)
    print(f"  {'─' * (25 + 6 + 6 + 2 + 6 * len(label_names))}", file=sys.stderr)

    for name, make in classifiers.items():
        f1, acc, yt, yp = eval_cv(X, y, groups, make)
        print(f"  {name:<25} {f1:>5.1%} {acc:>5.1%}  ", end="", file=sys.stderr)
        for i in range(len(label_names)):
            mask = yt == i
            n_cls = int(mask.sum())
            recall = float((yp[mask] == i).sum() / n_cls) if n_cls > 0 else 0.0
            print(f"{recall:>5.0%}", end=" ", file=sys.stderr)
        print(file=sys.stderr)
        results.append({"method": name, "macro_f1": round(f1, 4), "accuracy": round(acc, 4)})
        if f1 > best_final_f1:
            best_final_f1 = f1
            best_method = name
            best_yt, best_yp = yt, yp

    # ── Confusion matrix for best method ──
    if best_yt is not None and best_yp is not None:
        print(f"\n━━ Confusion Matrix ({best_method}, mF1={best_final_f1:.1%}) ━━\n", file=sys.stderr)
        cm = confusion_matrix(best_yt, best_yp)
        # Header
        print(f"  {'true↓ pred→':<10}", end="", file=sys.stderr)
        for name in label_names:
            print(f"{name[:6]:>7}", end="", file=sys.stderr)
        print(f"{'total':>7}", file=sys.stderr)
        # Rows
        for i, name in enumerate(label_names):
            print(f"  {name:<10}", end="", file=sys.stderr)
            for j in range(len(label_names)):
                val = cm[i, j]
                if val == 0:
                    print(f"{'·':>7}", end="", file=sys.stderr)
                elif i == j:
                    print(f"\033[32m{val:>7}\033[0m", end="", file=sys.stderr)
                elif val >= 20:
                    print(f"\033[31m{val:>7}\033[0m", end="", file=sys.stderr)
                else:
                    print(f"{val:>7}", end="", file=sys.stderr)
            print(f"{cm[i].sum():>7}", file=sys.stderr)

        # Top confusions
        print("\n  Top confusion pairs:", file=sys.stderr)
        confusions = []
        for i in range(len(label_names)):
            for j in range(len(label_names)):
                if i != j and cm[i, j] > 0:
                    confusions.append((cm[i, j], label_names[i], label_names[j]))
        confusions.sort(reverse=True)
        for count, true, pred in confusions[:10]:
            pct = count / cm[le.transform([true])[0]].sum() * 100
            print(f"    {true:>8} → {pred:<8}: {count:>4} ({pct:.0f}%)", file=sys.stderr)

    # JSON summary
    json.dump({"results": results, "best": best_method, "best_f1": best_final_f1}, sys.stdout, indent=2)
    print(file=sys.stdout)


if __name__ == "__main__":
    main()
